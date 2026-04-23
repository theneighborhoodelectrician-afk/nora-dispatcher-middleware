import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/config.js";
import { ensureStorageSchema, getStorageMode, prepareStorage } from "../src/storage/index.js";

const baseConfig: AppConfig = {
  environment: "test",
  contact: {},
  scheduling: {
    timezone: "America/Detroit",
    openingHour: 9,
    closingHour: 18,
    defaultSlotCount: 3,
    maxLookaheadDays: 5,
    maxLookaheadTotalDays: 60,
    minLeadHours: 2,
    bufferMinutes: 30,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    enabled: false,
  },
  hcp: {
    baseUrl: "https://api.housecallpro.com",
    customerPath: "/customers",
    employeePath: "/employees",
    schedulePath: "/jobs",
    createJobPath: "/jobs",
    createEstimatePath: "/public/v1/estimates",
    createLeadPath: "/leads",
  },
  ghl: {},
  blooio: {
    baseUrl: "https://backend.blooio.com/v2/api",
  },
  admin: {},
  storage: {
    autoInit: true,
  },
  booking: {},
  leadOnlyLaunch: false,
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
