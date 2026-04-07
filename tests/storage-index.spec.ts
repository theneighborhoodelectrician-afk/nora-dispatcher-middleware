import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/config.js";
import { ensureStorageSchema, getStorageMode, prepareStorage } from "../src/storage/index.js";

const baseConfig: AppConfig = {
  environment: "test",
  scheduling: {
    timezone: "America/Detroit",
    openingHour: 9,
    closingHour: 18,
    defaultSlotCount: 3,
    maxLookaheadDays: 5,
    minLeadHours: 2,
    bufferMinutes: 30,
  },
  hcp: {
    baseUrl: "https://api.housecallpro.com",
    customerPath: "/customers",
    employeePath: "/public/v1/employees",
    schedulePath: "/public/v1/jobs",
    createJobPath: "/public/v1/jobs",
    createEstimatePath: "/public/v1/estimates",
  },
  ghl: {},
  storage: {
    autoInit: true,
  },
};

describe("storage index", () => {
  it("reports memory mode when Postgres is not configured", async () => {
    expect(getStorageMode(baseConfig)).toBe("memory");
    const result = await ensureStorageSchema(baseConfig);
    expect(result).toEqual({
      mode: "memory",
      schemaReady: false,
    });
  });

  it("reports memory mode as prepared even when auto-init is enabled", async () => {
    const result = await prepareStorage(baseConfig);
    expect(result).toEqual({
      mode: "memory",
      schemaReady: false,
    });
  });
});
