import {
  buildStripeTaxAddress,
  resolveCourseCheckoutTaxCustomerFields,
  toStripeCountryCode,
} from "../stripeCourseCheckoutTax";

describe("stripeCourseCheckoutTax", () => {
  describe("toStripeCountryCode", () => {
    test("maps Romania labels to RO", () => {
      expect(toStripeCountryCode("Romania")).toBe("RO");
      expect(toStripeCountryCode("românia")).toBe("RO");
      expect(toStripeCountryCode("RO")).toBe("RO");
    });

    test("accepts country labels used by the app and rejects unknown countries", () => {
      expect(toStripeCountryCode("de")).toBe("DE");
      expect(toStripeCountryCode("Germany")).toBe("DE");
      expect(toStripeCountryCode("unknown")).toBeUndefined();
      expect(toStripeCountryCode("")).toBeUndefined();
    });
  });

  describe("buildStripeTaxAddress", () => {
    test("builds address and omits Expo placeholder postal code", () => {
      expect(
        buildStripeTaxAddress({
          line1: "Strada Test 1",
          city: "Bucuresti",
          state: "Bucuresti",
          postalCode: "000000",
          country: "Romania",
        })
      ).toEqual({
        country: "RO",
        line1: "Strada Test 1",
        city: "Bucuresti",
        state: "Bucuresti",
      });
    });

    test("keeps a real postal code", () => {
      expect(
        buildStripeTaxAddress({
          line1: "Strada Test 1",
          city: "Cluj-Napoca",
          postalCode: "400001",
          country: "RO",
        })
      ).toMatchObject({
        country: "RO",
        postal_code: "400001",
      });
    });

    test("returns null without a usable country", () => {
      expect(buildStripeTaxAddress({ city: "Paris", country: "unknown" })).toBeNull();
    });
  });

  describe("resolveCourseCheckoutTaxCustomerFields", () => {
    const isMobilePlatform = (value) =>
      ["expo", "mobile", "react-native"].includes(String(value || "").toLowerCase());

    test("keeps web on customer_email and does not create a Customer", async () => {
      const customersCreate = jest.fn();
      const result = await resolveCourseCheckoutTaxCustomerFields({
        stripe: { customers: { create: customersCreate } },
        sourcePlatform: "web",
        isMobilePlatform,
        billingDetails: {
          address: { country: "Romania", line1: "Strada 1", city: "Bucuresti" },
        },
        authEmail: "user@example.com",
        uid: "user-1",
      });

      expect(result).toEqual({ customer_email: "user@example.com" });
      expect(customersCreate).not.toHaveBeenCalled();
    });

    test("seeds a one-off Customer for Expo with customer_update", async () => {
      const customersCreate = jest.fn().mockResolvedValue({ id: "cus_course_1" });
      const result = await resolveCourseCheckoutTaxCustomerFields({
        stripe: { customers: { create: customersCreate } },
        sourcePlatform: "expo",
        isMobilePlatform,
        billingDetails: {
          firstName: "Ana",
          lastName: "Pop",
          email: "ana@example.com",
          phone: "+40722111222",
          address: {
            line1: "Strada Test 1",
            city: "Bucuresti",
            state: "Bucuresti",
            postalCode: "000000",
            country: "Romania",
          },
        },
        authEmail: "user@example.com",
        uid: "user-1",
      });

      expect(customersCreate).toHaveBeenCalledWith({
        email: "ana@example.com",
        name: "Ana Pop",
        phone: "+40722111222",
        address: {
          country: "RO",
          line1: "Strada Test 1",
          city: "Bucuresti",
          state: "Bucuresti",
        },
        metadata: {
          uid: "user-1",
          source: "courses_checkout",
        },
      });
      expect(result).toEqual({
        customer: "cus_course_1",
        customer_update: { address: "auto", name: "auto" },
      });
    });

    test("falls back to customer_email when Customer create fails", async () => {
      const customersCreate = jest.fn().mockRejectedValue(new Error("stripe down"));
      const result = await resolveCourseCheckoutTaxCustomerFields({
        stripe: { customers: { create: customersCreate } },
        sourcePlatform: "expo",
        isMobilePlatform,
        billingDetails: {
          address: { country: "Romania", line1: "Strada 1", city: "Bucuresti" },
        },
        authEmail: "user@example.com",
        uid: "user-1",
      });

      expect(result).toEqual({ customer_email: "user@example.com" });
    });
  });
});
