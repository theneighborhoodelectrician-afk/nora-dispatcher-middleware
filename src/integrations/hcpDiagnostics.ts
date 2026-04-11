import { AppConfig } from "../config.js";
import { buildUrl } from "../lib/http.js";

const SCHEDULE_PATHS = [
  "/jobs",
  "/public/v1/jobs",
  "/v1/jobs",
  "/api/v1/jobs",
  "/public/jobs",
];

const CUSTOMER_PATHS = [
  "/customers",
  "/customer",
  "/public/v1/customers",
  "/v1/customers",
  "/api/v1/customers",
];

const EMPLOYEE_PATHS = [
  "/public/v1/employees",
  "/employees",
  "/v1/employees",
];

export interface HcpEndpointProbeResult {
  path: string;
  status: number | "request_failed";
  ok: boolean;
  url: string;
  bodySnippet: string;
}

export interface HcpDiagnosticsResult {
  success: boolean;
  baseUrl: string;
  configuredPaths: {
    customerPath: string;
    employeePath: string;
    schedulePath: string;
    createJobPath: string;
    createEstimatePath: string;
  };
  auth: {
    tokenConfigured: boolean;
    companyIdConfigured: boolean;
  };
  probes: {
    schedule: HcpEndpointProbeResult[];
    customers: HcpEndpointProbeResult[];
    employees: HcpEndpointProbeResult[];
  };
  interpretation: {
    readableScheduleEndpoint: string | null;
    readableCustomerEndpoint: string | null;
    readableEmployeeEndpoint: string | null;
    likelySupportsTrueSlotApi: boolean;
    notes: string[];
  };
}

export async function runHcpDiagnostics(config: AppConfig): Promise<HcpDiagnosticsResult> {
  const authHeaders = {
    authorization: `Bearer ${config.hcp.token ?? ""}`,
    accept: "application/json",
    ...(config.hcp.companyId ? { "x-company-id": config.hcp.companyId } : {}),
  };

  const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [schedule, customers, employees] = await Promise.all([
    probePaths(
      config.hcp.baseUrl,
      SCHEDULE_PATHS,
      {
        scheduled_start_min: start,
        scheduled_start_max: end,
        page_size: "1",
        page: "1",
      },
      authHeaders,
    ),
    probePaths(
      config.hcp.baseUrl,
      CUSTOMER_PATHS,
      {
        page_size: "1",
      },
      authHeaders,
    ),
    probePaths(
      config.hcp.baseUrl,
      EMPLOYEE_PATHS,
      {
        page_size: "1",
      },
      authHeaders,
    ),
  ]);

  const readableScheduleEndpoint = firstReadablePath(schedule);
  const readableCustomerEndpoint = firstReadablePath(customers);
  const readableEmployeeEndpoint = firstReadablePath(employees);

  const notes: string[] = [];
  if (!config.hcp.token) {
    notes.push("HCP_API_TOKEN is missing.");
  }
  if (readableScheduleEndpoint) {
    notes.push(`Readable schedule endpoint found at ${readableScheduleEndpoint}.`);
  } else {
    notes.push("No readable schedule endpoint was found with the current credentials.");
  }
  if (schedule.some((probe) => probe.status === 401)) {
    notes.push("At least one schedule endpoint returned 401 Unauthorized.");
  }
  if (!readableCustomerEndpoint) {
    notes.push("No readable customer endpoint was found with the current credentials.");
  }
  notes.push(
    "These probes verify existing-resource access. They do not prove that Housecall Pro exposes a true open-slot availability API.",
  );

  return {
    success: true,
    baseUrl: config.hcp.baseUrl,
    configuredPaths: {
      customerPath: config.hcp.customerPath,
      employeePath: config.hcp.employeePath,
      schedulePath: config.hcp.schedulePath,
      createJobPath: config.hcp.createJobPath,
      createEstimatePath: config.hcp.createEstimatePath,
    },
    auth: {
      tokenConfigured: Boolean(config.hcp.token),
      companyIdConfigured: Boolean(config.hcp.companyId),
    },
    probes: {
      schedule,
      customers,
      employees,
    },
    interpretation: {
      readableScheduleEndpoint,
      readableCustomerEndpoint,
      readableEmployeeEndpoint,
      likelySupportsTrueSlotApi: false,
      notes,
    },
  };
}

async function probePaths(
  baseUrl: string,
  paths: string[],
  params: Record<string, string>,
  headers: Record<string, string>,
): Promise<HcpEndpointProbeResult[]> {
  const results: HcpEndpointProbeResult[] = [];

  for (const path of paths) {
    const url = buildUrl(baseUrl, path, params);
    try {
      const response = await fetch(url, {
        headers,
      });
      const body = await response.text();
      results.push({
        path,
        status: response.status,
        ok: response.ok,
        url,
        bodySnippet: truncate(body),
      });
    } catch (error) {
      results.push({
        path,
        status: "request_failed",
        ok: false,
        url,
        bodySnippet: truncate(String(error)),
      });
    }
  }

  return results;
}

function firstReadablePath(results: HcpEndpointProbeResult[]): string | null {
  return results.find((result) => result.ok)?.path ?? null;
}

function truncate(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}
