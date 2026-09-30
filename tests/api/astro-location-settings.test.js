jest.mock("stripe", () => jest.fn().mockImplementation(() => ({})));
jest.mock("../../lib/astroLocations", () => ({ getAstroLocationProvider: jest.fn(async () => "geonames") }));
jest.mock("../../lib/requireAuth", () => ({ requireDashboardAccess: jest.fn() }));
jest.mock("../../lib/globalSettings", () => ({ getGlobalSettings: jest.fn(), updateGlobalSettings: jest.fn() }));
jest.mock("../../lib/mobileUpdatePromptSettings", () => ({
  loadMobileUpdateStatus: jest.fn(async () => ({ forceUpdate: false })),
  validateForceUpdateMinVersions: jest.fn(() => ({ ok: true })),
}));
import handler from "../../pages/api/dashboard/settings";
import { getGlobalSettings, updateGlobalSettings } from "../../lib/globalSettings";
import { requireDashboardAccess } from "../../lib/requireAuth";
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() });
beforeEach(() => { jest.clearAllMocks(); requireDashboardAccess.mockImplementation(() => {}); getGlobalSettings.mockResolvedValue({ astroLocationProvider: "geonames" }); });
test.each(["geonames", "google"])("saves %s without touching unrelated settings", async (provider) => {
  const res = response();
  await handler({ method: "POST", body: { astroLocationProvider: provider } }, res);
  expect(updateGlobalSettings).toHaveBeenCalledTimes(1);
  expect(updateGlobalSettings).toHaveBeenCalledWith({ astroLocationProvider: provider }, "dashboard");
  expect(res.status).toHaveBeenCalledWith(200);
});
test("rejects invalid provider values", async () => {
  const res = response();
  await handler({ method: "POST", body: { astroLocationProvider: "invalid" } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(updateGlobalSettings).not.toHaveBeenCalled();
});
test("unauthenticated clients cannot change the provider", async () => {
  requireDashboardAccess.mockImplementation(() => { throw Object.assign(new Error("unauthorized"), { statusCode: 401 }); });
  const res = response();
  await handler({ method: "POST", body: { astroLocationProvider: "google" } }, res);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(updateGlobalSettings).not.toHaveBeenCalled();
});
