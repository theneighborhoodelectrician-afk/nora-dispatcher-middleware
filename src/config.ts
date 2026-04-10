import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { SchedulingSettings } from "./domain/scheduling.js";

loadEnvFiles();

function readNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export interface AppConfig {
  environment: string;
  scheduling: SchedulingSettings;
  hcp: {
    baseUrl: string;
    token?: string;
    companyId?: string;
    customerPath: string;
    employeePath: string;
    schedulePath: string;
    createJobPath: string;
    createEstimatePath: string;
  };
  ghl: {
    webhookSecret?: string;
  };
  blooio: {
    webhookSecret?: string;
  };
  storage: {
    postgresUrl?: string;
    autoInit: boolean;
  };
}

export function getConfig(): AppConfig {
  return {
    environment: process.env.NODE_ENV ?? "development",
    scheduling: {
      timezone: process.env.DEFAULT_TIMEZONE ?? "America/Detroit",
      openingHour: readNumber("OPENING_HOUR", 9),
      closingHour: readNumber("CLOSING_HOUR", 18),
      defaultSlotCount: readNumber("DEFAULT_SLOT_COUNT", 3),
      maxLookaheadDays: readNumber("MAX_LOOKAHEAD_DAYS", 7),
      minLeadHours: readNumber("MIN_LEAD_HOURS", 2),
      bufferMinutes: readNumber("BUFFER_MINUTES", 30),
    },
    hcp: {
      baseUrl: process.env.HCP_API_BASE_URL ?? "https://api.housecallpro.com",
      token: process.env.HCP_API_TOKEN,
      companyId: process.env.HCP_COMPANY_ID,
      customerPath: process.env.HCP_CUSTOMER_PATH ?? "/customers",
      employeePath: process.env.HCP_EMPLOYEE_PATH ?? "/public/v1/employees",
      schedulePath: process.env.HCP_SCHEDULE_PATH ?? "/jobs",
      createJobPath: process.env.HCP_CREATE_JOB_PATH ?? "/jobs",
      createEstimatePath: process.env.HCP_CREATE_ESTIMATE_PATH ?? "/public/v1/estimates",
    },
    ghl: {
      webhookSecret: process.env.GHL_WEBHOOK_SECRET,
    },
    blooio: {
      webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET,
    },
    storage: {
      postgresUrl: process.env.POSTGRES_URL,
      autoInit: readBoolean("AUTO_INIT_STORAGE", true),
    },
  };
}

function loadEnvFiles(): void {
  const cwd = process.cwd();
  const candidates = [".env", ".env.local"];

  for (const filename of candidates) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      dotenv.config({
        path: filePath,
        override: false,
      });
    }
  }
}
