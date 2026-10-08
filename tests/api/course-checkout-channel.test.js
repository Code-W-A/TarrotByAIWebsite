jest.mock("../../lib/stripePurchaseCustomer", () => ({ purchaseCustomer: jest.fn(async () => "cus_expo_course") }));
import { purchaseCustomer } from "../../lib/stripePurchaseCustomer";
jest.mock("stripe", () => {
  const create = jest.fn();
  const customersCreate = jest.fn();
  const taxRateRetrieve = jest.fn();
  const StripeMock = jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create } },
    customers: { create: customersCreate },
    taxRates: { retrieve: taxRateRetrieve },
  }));
  StripeMock.mockSessionCreate = create;
  StripeMock.mockCustomersCreate = customersCreate;
  StripeMock.mockTaxRateRetrieve = taxRateRetrieve;
  return StripeMock;
});

jest.mock("../../lib/firebaseAdmin", () => ({
  getAdminDb: jest.fn(),
}));

jest.mock("../../lib/requireAuth", () => ({
  requireAuth: jest.fn().mockResolvedValue({ uid: "user-1", email: "user@example.com" }),
}));

jest.mock("../../lib/globalSettings", () => ({
  getGlobalSettings: jest.fn(async () => ({ iosCoursesHidden: false })),
  getVatPercentage: jest.fn(async () => 21),
}));

jest.mock("../../lib/courseSubscriptionAccess", () => ({
  isCourseFreeFullAccess: jest.fn(() => false),
  resolveCourseEntitlement: jest.fn().mockResolvedValue({
    hasAccess: false,
    accessSource: null,
  }),
}));

jest.mock("../../utils/billingAudit.mjs", () => ({
  normalizeBillingContext: jest.fn(() => ({
    validation: { ok: true, blockingErrors: [] },
    normalizedClient: { deliveryInRomania: true, eligibleForEInvoice: false },
  })),
  buildInvoiceDecision: jest.fn(() => ({ sendEInvoice: false })),
  logBillingAudit: jest.fn(),
}));

jest.mock("../../lib/stripeBillingDetails", () => ({
  normalizeBillingDetails: jest.fn(() => ({
    billingType: "individual",
    firstName: "Test",
    lastName: "User",
    email: "user@example.com",
    address: {
      line1: "Strada Test 1",
      city: "Bucuresti",
      state: "Bucuresti",
      postalCode: "000000",
      country: "Romania",
    },
    invoicePreferences: { sendEmail: true },
  })),
  buildBillingContextInput: jest.fn(() => ({})),
}));

import { getAdminDb } from "../../lib/firebaseAdmin";
import { getGlobalSettings } from "../../lib/globalSettings";
import Stripe from "stripe";
import checkoutHandler from "../../pages/api/stripe/courses/create-checkout-session";

const mockStripeCreate = Stripe.mockSessionCreate;
const mockCustomersCreate = Stripe.mockCustomersCreate;
const mockTaxRateRetrieve = Stripe.mockTaxRateRetrieve;

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createDb(course) {
  const checkoutWrites = [];
  return {
    checkoutWrites,
    collection(name) {
      return {
        doc(id) {
          if (name === "courses") {
            return {
              id,
              async get() {
                return { exists: true, data: () => course };
              },
            };
          }
          if (name === "courseCheckoutSessions") {
            return {
              id,
              async set(payload) {
                checkoutWrites.push(payload);
              },
            };
          }
          throw new Error(`Unexpected collection ${name}`);
        },
      };
    },
  };
}

function requestFor(platform) {
  return {
    method: "POST",
    headers: { host: "localhost:3000" },
    body: {
      courseId: "course-web",
      platform,
      billingDetails: {},
    },
  };
}

function createBundleDb(bundle, courses) {
  const checkoutWrites = [];
  return {
    checkoutWrites,
    collection(name) {
      if (name === "courseBundles") {
        return {
          doc(id) {
            return { id, get: async () => ({ exists: true, data: () => bundle }) };
          },
        };
      }
      if (name === "courses") {
        return {
          doc(id) {
            const course = courses[id];
            return {
              id,
              get: async () => ({ exists: Boolean(course), data: () => course }),
            };
          },
        };
      }
      if (name === "users") {
        return {
          doc() {
            return {
              collection() {
                return {
                  doc(id) {
                    return {
                      id,
                      get: async () => ({ exists: false, data: () => undefined }),
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === "courseCheckoutSessions") {
        return {
          doc(id) {
            return {
              id,
              async set(payload) {
                checkoutWrites.push(payload);
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
  };
}

function bundleRequestFor(platform) {
  return {
    method: "POST",
    headers: { host: "localhost:3000" },
    body: {
      purchaseType: "bundle",
      bundleId: "bundle-web",
      platform,
      billingDetails: {},
    },
  };
}

describe("course checkout channel enforcement", () => {
  const websiteOnlyCourse = {
    title: "Curs Website",
    status: "published",
    price: 5,
    currency: "EUR",
    availableOnWebsite: true,
    availableOnMobile: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getGlobalSettings.mockResolvedValue({ iosCoursesHidden: false });
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.STRIPE_FIXED_VAT_TAX_RATE_ID = "txr_fixed_21";
    mockTaxRateRetrieve.mockResolvedValue({
      id: "txr_fixed_21",
      active: true,
      inclusive: false,
      percentage: 21,
    });
  });

  test("blocks Expo checkout for a website-only course", async () => {
    getAdminDb.mockReturnValue(createDb(websiteOnlyCourse));
    const res = createResponse();

    await checkoutHandler(requestFor("expo"), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Course not available for purchase");
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test("creates a Stripe session for the same course on website", async () => {
    const db = createDb(websiteOnlyCourse);
    getAdminDb.mockReturnValue(db);
    mockStripeCreate.mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.test/cs_test_1",
    });
    const res = createResponse();

    await checkoutHandler(requestFor("web"), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      url: "https://checkout.stripe.test/cs_test_1",
      sessionId: "cs_test_1",
    });
    expect(mockCustomersCreate).not.toHaveBeenCalled();
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);
    expect(mockStripeCreate.mock.calls[0][0]).toMatchObject({
      mode: "payment",
      customer_email: "user@example.com",
      metadata: {
        uid: "user-1",
        courseId: "course-web",
        expectedAmount: "500",
        expectedCurrency: "EUR",
        sourcePlatform: "web",
      },
      line_items: [
        {
          price_data: expect.objectContaining({
            unit_amount: 500,
            tax_behavior: "exclusive",
          }),
          quantity: 1,
          tax_rates: ["txr_fixed_21"],
        },
      ],
    });
    expect(mockStripeCreate.mock.calls[0][0].customer).toBeUndefined();
    expect(db.checkoutWrites).toHaveLength(1);
  });

  test("seeds a tax Customer for Expo without changing web customer_email flow", async () => {
    const mobileCourse = {
      title: "Curs Mobile",
      status: "published",
      price: 99,
      currency: "RON",
      availableOnWebsite: true,
      availableOnMobile: true,
    };
    getAdminDb.mockReturnValue(createDb(mobileCourse));
    mockCustomersCreate.mockResolvedValue({ id: "cus_expo_course" });
    mockStripeCreate.mockResolvedValue({
      id: "cs_expo_1",
      url: "https://checkout.stripe.test/cs_expo_1",
    });
    const res = createResponse();

    await checkoutHandler(requestFor("expo"), res);

    expect(res.statusCode).toBe(200);
    expect(purchaseCustomer).toHaveBeenCalledTimes(1);
    expect(purchaseCustomer.mock.calls[0][2]).toBe("user-1");
    expect(purchaseCustomer.mock.calls[0][3]).toMatchObject({
      address: { country: "RO", line1: "Strada Test 1", city: "Bucuresti" },
    });
    expect(purchaseCustomer.mock.calls[0][3].address.postal_code).toBe("");
    expect(mockStripeCreate.mock.calls[0][0]).toMatchObject({
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      customer: "cus_expo_course",
      customer_update: { address: "auto", name: "auto" },
      metadata: { sourcePlatform: "expo" },
      line_items: [
        expect.objectContaining({ tax_rates: ["txr_fixed_21"] }),
      ],
    });
    expect(mockStripeCreate.mock.calls[0][0].customer_email).toBeUndefined();
  });

  test("enforces the bundle channel independently of its included courses", async () => {
    const courses = {
      a: { title: "A", status: "published", availableOnWebsite: true, availableOnMobile: true },
      b: { title: "B", status: "published", availableOnWebsite: true, availableOnMobile: true },
    };
    const bundle = {
      title: "Pachet Website",
      status: "published",
      price: 25,
      currency: "EUR",
      courseIds: ["a", "b"],
      availableOnWebsite: true,
      availableOnMobile: false,
    };
    getAdminDb.mockReturnValue(createBundleDb(bundle, courses));
    const mobileRes = createResponse();

    await checkoutHandler(bundleRequestFor("expo"), mobileRes);

    expect(mobileRes.statusCode).toBe(400);
    expect(mobileRes.body.error).toBe("Course bundle not available for purchase");
    expect(mockStripeCreate).not.toHaveBeenCalled();

    mockStripeCreate.mockResolvedValue({
      id: "cs_bundle_website",
      url: "https://checkout.stripe.test/cs_bundle_website",
    });
    const websiteRes = createResponse();
    await checkoutHandler(bundleRequestFor("web"), websiteRes);

    expect(websiteRes.statusCode).toBe(200);
    expect(mockStripeCreate).toHaveBeenCalledTimes(1);
    expect(mockStripeCreate.mock.calls[0][0].metadata).toMatchObject({
      purchaseType: "bundle",
      bundleId: "bundle-web",
      expectedAmount: "2500",
      expectedCurrency: "EUR",
      sourcePlatform: "web",
    });
    expect(mockStripeCreate.mock.calls[0][0].line_items[0]).toMatchObject({
      price_data: {
        unit_amount: 2500,
        tax_behavior: "exclusive",
      },
      tax_rates: ["txr_fixed_21"],
    });
  });

  test("blocks bundle checkout when an included course is unavailable on that platform", async () => {
    const courses = {
      a: { title: "A", status: "published", availableOnWebsite: true, availableOnMobile: true },
      b: { title: "B", status: "published", availableOnWebsite: false, availableOnMobile: true },
    };
    const bundle = {
      title: "Pachet mixt",
      status: "published",
      price: 149,
      currency: "RON",
      courseIds: ["a", "b"],
      availableOnWebsite: true,
      availableOnMobile: true,
    };
    getAdminDb.mockReturnValue(createBundleDb(bundle, courses));
    const res = createResponse();

    await checkoutHandler(bundleRequestFor("web"), res);

    expect(res.statusCode).toBe(400);
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test("blocks iOS checkout when course catalog hiding is enabled", async () => {
    getGlobalSettings.mockResolvedValue({ iosCoursesHidden: true });
    const res = createResponse();

    await checkoutHandler(requestFor("ios"), res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ios_courses_unavailable");
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });

  test("blocks Expo checkout with an iOS client header when hiding is enabled", async () => {
    getGlobalSettings.mockResolvedValue({ iosCoursesHidden: true });
    const req = requestFor("expo");
    req.headers["x-app-platform"] = "ios";
    const res = createResponse();

    await checkoutHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("ios_courses_unavailable");
    expect(mockStripeCreate).not.toHaveBeenCalled();
  });
});
