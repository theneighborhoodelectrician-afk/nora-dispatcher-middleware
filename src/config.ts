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

function resolveDefaultTimezone(value: string | undefined): string {
  const v = value?.trim();
  if (!v || v === "UTC" || v === "America/New_York") {
    return "America/Detroit";
  }
  return v;
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
  contact: {
    humanHandoffPhone?: string;
    humanHandoffHref?: string;
    humanHandoffCallHref?: string;
    humanHandoffSmsHref?: string;
  };
  scheduling: SchedulingSettings;
  openai: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    enabled: boolean;
  };
  hcp: {
    baseUrl: string;
    token?: string;
    companyId?: string;
    customerPath: string;
    employeePath: string;
    schedulePath: string;
    createJobPath: string;
    createEstimatePath: string;
    createLeadPath: string;
  };
  ghl: {
    webhookSecret?: string;
  };
  blooio: {
    webhookSecret?: string;
    apiKey?: string;
    baseUrl: string;
    fromNumber?: string;
  };
  admin: {
    secret?: string;
  };
  storage: {
    postgresUrl?: string;
    autoInit: boolean;
  };
  booking: {
    hcpServiceLineId?: string;
    hcpServiceLineName?: string;
  };
  leadOnlyLaunch: boolean;
}

export function getConfig(): AppConfig {
  const humanHandoffPhone = normalizeDisplayPhone(process.env.HUMAN_HANDOFF_PHONE);

  return {
    environment: process.env.NODE_ENV ?? "development",
    contact: {
      humanHandoffPhone,
      humanHandoffHref: humanHandoffPhone ? toSmsHref(humanHandoffPhone) : undefined,
      humanHandoffCallHref: humanHandoffPhone ? toTelHref(humanHandoffPhone) : undefined,
      humanHandoffSmsHref: humanHandoffPhone ? toSmsHref(humanHandoffPhone) : undefined,
    },
    scheduling: {
      timezone: resolveDefaultTimezone(process.env.DEFAULT_TIMEZONE),
      openingHour: readNumber("OPENING_HOUR", 8),
      closingHour: readNumber("CLOSING_HOUR", 17),
      defaultSlotCount: readNumber("DEFAULT_SLOT_COUNT", 3),
      maxLookaheadDays: readNumber("INITIAL_LOOKAHEAD_DAYS", 7),
      maxLookaheadTotalDays: readNumber("MAX_LOOKAHEAD_DAYS", 60),
      minLeadHours: readNumber("MIN_LEAD_HOURS", 2),
      bufferMinutes: readNumber("BUFFER_MINUTES", 30),
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      enabled: readBoolean("OPENAI_RESPONSES_ENABLED", false),
    },
    hcp: {
      baseUrl: process.env.HCP_API_BASE_URL ?? "https://api.housecallpro.com",
      token: process.env.HCP_API_TOKEN,
      companyId: process.env.HCP_COMPANY_ID,
      customerPath: process.env.HCP_CUSTOMER_PATH ?? "/customers",
      employeePath: process.env.HCP_EMPLOYEE_PATH ?? "/employees",
      schedulePath: process.env.HCP_SCHEDULE_PATH ?? "/jobs",
      createJobPath: process.env.HCP_CREATE_JOB_PATH ?? "/jobs",
      createEstimatePath: process.env.HCP_CREATE_ESTIMATE_PATH ?? "/public/v1/estimates",
      createLeadPath: process.env.HCP_CREATE_LEAD_PATH ?? "/leads",
    },
    ghl: {
      webhookSecret: process.env.GHL_WEBHOOK_SECRET,
    },
    blooio: {
      webhookSecret: process.env.BLOOIO_WEBHOOK_SECRET,
      apiKey: process.env.BLOOIO_API_KEY,
      baseUrl: process.env.BLOOIO_API_BASE_URL ?? "https://backend.blooio.com/v2/api",
      fromNumber: normalizeE164Phone(process.env.BLOOIO_FROM_NUMBER),
    },
    admin: {
      secret: process.env.ADMIN_SECRET,
    },
    storage: {
      postgresUrl: process.env.POSTGRES_URL,
      autoInit: readBoolean("AUTO_INIT_STORAGE", true),
    },
    booking: {
      hcpServiceLineId: process.env.HCP_SERVICE_LINE_ID,
      hcpServiceLineName: process.env.HCP_SERVICE_LINE_NAME,
    },
    leadOnlyLaunch: readBoolean("LEAD_ONLY_LAUNCH", false),
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

function normalizeDisplayPhone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return undefined;
  }

  const normalized = digits.slice(-10);
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function toTelHref(value: string): string {
  return `tel:+1${value.replace(/\D/g, "")}`;
}

function toSmsHref(value: string): string {
  return `sms:+1${value.replace(/\D/g, "")}`;
}

function normalizeE164Phone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return undefined;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  return `+${digits}`;
}
