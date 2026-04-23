import { AppConfig } from "../config.js";
import { CustomerRequest, ScheduledJob, TechnicianName } from "../domain/types.js";
import { ExternalServiceError } from "../lib/errors.js";
import { buildUrl, readJson } from "../lib/http.js";

export function buildBookSmartHcpJobNotes(payload: {
  serviceName: string;
  notes?: string;
  customer: {
    bookSmartQualifiers?: CustomerRequest["bookSmartQualifiers"];
  };
}): string {
  const q = payload.customer.bookSmartQualifiers;
  const lines: string[] = ["Booked via BookSmart"];
  if (q?.homeAge) {
    lines.push(`Home age: ${q.homeAge}`);
  }
  if (q?.panelBrand) {
    lines.push(`Panel brand: ${q.panelBrand}`);
  }
  if (q?.ceilingHeight) {
    lines.push(`Ceiling height: ${q.ceilingHeight}`);
  }
  if (q?.pets) {
    lines.push(`Pets: ${q.pets}`);
  }
  if (q?.atticAccess) {
    lines.push(`Attic access: ${q.atticAccess}`);
  }
  const freeform = [q?.customerNotes, payload.notes].filter(Boolean).join(" ").trim();
  if (freeform) {
    lines.push(`Customer notes: ${freeform}`);
  }
  if (lines.length === 1) {
    lines.push(`Service: ${payload.serviceName}`);
  }
  return lines.join("\n");
}

export async function lookupCustomerByPhone(
  phone: string,
  config: AppConfig["hcp"],
): Promise<{
  found: boolean;
  firstName?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  email?: string;
}> {
  console.log(`[HCP LOOKUP] searching phone: ${phone}`);

  if (!phone?.trim() || !config.token) {
    const result = { found: false as const };
    console.log(`[HCP LOOKUP] result: ${JSON.stringify(result)}`);
    return result;
  }
  try {
    const client = new HousecallProClient(config);
    const customer = await client.fetchCustomerByPhoneLookup(phone);
    if (!customer) {
      const result = { found: false as const };
      console.log(`[HCP LOOKUP] result: ${JSON.stringify(result)}`);
      return result;
    }
    const result = {
      found: true as const,
      firstName: customer.first_name,
      address: customer.address?.street,
      city: customer.address?.city,
      zipCode: customer.address?.zip,
      email: customer.email,
    };
    console.log(`[HCP LOOKUP] result: ${JSON.stringify(result)}`);
    return result;
  } catch (error) {
    const result = { found: false as const, error: error instanceof Error ? error.message : String(error) };
    console.log(`[HCP LOOKUP] result: ${JSON.stringify(result)}`);
    return { found: false };
  }
}

export interface HousecallJobResponse {
  jobs?: Array<{
    id: string;
    invoice_number?: string;
    start_time?: string;
    end_time?: string;
    employee?: { name?: string };
    address?: { postal_code?: string; zip?: string };
    description?: string;
    customer?: {
      first_name?: string;
      last_name?: string;
      address?: {
        zip?: string;
        street?: string;
        city?: string;
        state?: string;
      };
    };
    schedule?: {
      scheduled_start?: string;
      scheduled_end?: string;
      arrival_window?: number;
    };
    assigned_employees?: Array<{
      id?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
    }>;
  }>;
  data?: Array<{
    id: string;
    invoice_number?: string;
    start_time?: string;
    end_time?: string;
    employee?: { name?: string };
    address?: { postal_code?: string; zip?: string };
    description?: string;
    customer?: {
      first_name?: string;
      last_name?: string;
      address?: {
        zip?: string;
        street?: string;
        city?: string;
        state?: string;
      };
    };
    schedule?: {
      scheduled_start?: string;
      scheduled_end?: string;
      arrival_window?: number;
    };
    assigned_employees?: Array<{
      id?: string;
      first_name?: string;
      last_name?: string;
      email?: string;
    }>;
  }>;
  meta?: {
    next_cursor?: string;
    next_page?: number;
    has_more?: boolean;
  };
}

interface HousecallCustomerResponse {
  customers?: Array<{
    id: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    mobile_number?: string;
    home_number?: string;
    address?: {
      zip?: string;
      street?: string;
      city?: string;
      state?: string;
    };
  }>;
}

export class HousecallProClient {
  constructor(private readonly config: AppConfig["hcp"]) {}

  async fetchScheduledJobs(start: string, end: string): Promise<ScheduledJob[]> {
    if (!this.config.token) {
      return [];
    }

    const pages = await this.fetchSchedulePages(start, end);

    return pages
      .flatMap((body) => body.jobs ?? body.data ?? [])
      .map((job) => ({
        id: job.id,
        technician: normalizeTechnician(
          job.employee?.name ?? employeeName(job.assigned_employees?.[0]),
        ),
        start: job.start_time ?? job.schedule?.scheduled_start ?? "",
        end: job.end_time ?? job.schedule?.scheduled_end ?? "",
        zipCode: job.address?.postal_code ?? job.address?.zip ?? job.customer?.address?.zip ?? "",
        title: job.description ?? job.invoice_number ?? "Scheduled job",
      }))
      .filter((job) => Boolean(job.technician && job.start && job.end && job.zipCode));
  }

  async fetchSchedulePages(start: string, end: string): Promise<HousecallJobResponse[]> {
    if (!this.config.token) {
      return [];
    }

    return this.fetchPaginated<HousecallJobResponse>(this.config.schedulePath, {
      scheduled_start_min: start,
      scheduled_start_max: end,
      page_size: "100",
    });
  }

  async createBooking(payload: {
    customer: {
      firstName: string;
      lastName?: string;
      phone: string;
      email?: string;
      address?: string;
      zipCode: string;
      bookSmartQualifiers?: CustomerRequest["bookSmartQualifiers"];
    };
    serviceName: string;
    notes?: string;
    start: string;
    end: string;
    technician: string;
    target: "job" | "estimate";
  }): Promise<{ id: string }> {
    if (!this.config.token) {
      return { id: `mock-${payload.target}-${Date.now()}` };
    }

    const customerId = await this.findOrCreateCustomer(payload.customer);

    const path =
      payload.target === "estimate" ? this.config.createEstimatePath : this.config.createJobPath;

    const employeeIdMap: Record<string, string> = {
      Nate: "pro_153120bc47f64ceaba850b0377303884",
      Brandon: "pro_1ff90237b2164bf580fe071f0cf72e93",
      Steve: "pro_10ad000c265e4bfe9dc2929918ec2da8",
      Dave: "pro_cb8baab7ea27478d9529ed64f13d39a2",
      Lou: "pro_a8d4ce5f9ea84238b3f725c34d390929",
      Joseph: "pro_8c91c8d7193a4f51912e46493555f1ea",
      Andrew: "pro_45c6e2bbc3ae4f62ba85aa13a6790e9c",
      Brayden: "pro_cdf41554fb9249f5b0d0f7077cd2944e",
    };
    const assignedEmployeeId = employeeIdMap[payload.technician];
    const requestPayload = {
      customer_id: customerId,
      schedule: {
        scheduled_start: payload.start,
        scheduled_end: payload.end,
      },
      assigned_employees: assignedEmployeeId ? [{ id: assignedEmployeeId }] : [],
      description: payload.serviceName,
      notes: buildBookSmartHcpJobNotes(payload),
    };

    const response = await fetch(buildUrl(this.config.baseUrl, path), {
      ...this.requestInit("POST", requestPayload),
    }).catch((error) => {
      throw new ExternalServiceError(`Housecall Pro create ${payload.target} failed: ${String(error)}`);
    });

    if (!response.ok) {
      const errorBody = await safeReadResponseText(response);
      throw new ExternalServiceError(
        `Housecall Pro create ${payload.target} failed with ${response.status}`,
        "That time is no longer available, so Nora should offer fresh options.",
        {
          status: response.status,
          url: buildUrl(this.config.baseUrl, path),
          body: errorBody,
          requestPayload,
        },
      );
    }

    const body = await readJson<{ id?: string }>(response);
    return { id: body.id ?? `hcp-${payload.target}-${Date.now()}` };
  }

  async createLead(payload: {
    customer: {
      firstName: string;
      lastName?: string;
      phone: string;
      email?: string;
      address?: string;
      city?: string;
      zipCode: string;
    };
    serviceName: string;
    requestedWindow?: "morning" | "afternoon";
    leadSource?: string;
    notes?: string;
  }): Promise<{ id: string }> {
    if (!this.config.token) {
      return { id: `mock-lead-${Date.now()}` };
    }

    const customerId = await this.findOrCreateCustomer(payload.customer);
    const requestPayload = {
      customer_id: customerId,
      address: {
        street: payload.customer.address,
        city: payload.customer.city,
        zip: payload.customer.zipCode,
      },
      lead_source: payload.leadSource,
      note: buildLeadNote(payload),
      tags: ["booksmart"],
    };

    const response = await fetch(buildUrl(this.config.baseUrl, this.config.createLeadPath), {
      ...this.requestInit("POST", requestPayload),
    }).catch((error) => {
      throw new ExternalServiceError(`Housecall Pro create lead failed: ${String(error)}`);
    });

    if (!response.ok) {
      const errorBody = await safeReadResponseText(response);
      throw new ExternalServiceError(
        `Housecall Pro create lead failed with ${response.status}`,
        "We couldn't submit this request to dispatch just yet.",
        {
          status: response.status,
          url: buildUrl(this.config.baseUrl, this.config.createLeadPath),
          body: errorBody,
          requestPayload,
        },
      );
    }

    const body = await readJson<{ id?: string }>(response);
    return { id: body.id ?? `hcp-lead-${Date.now()}` };
  }

  async findOrCreateCustomer(customer: {
    firstName: string;
    lastName?: string;
    phone: string;
    email?: string;
    address?: string;
    zipCode: string;
  }): Promise<string> {
    const existing = await this.findCustomer(customer);
    if (existing) {
      return existing.id;
    }

    const response = await fetch(buildUrl(this.config.baseUrl, this.config.customerPath), {
      ...this.requestInit("POST", {
        first_name: customer.firstName,
        last_name: customer.lastName,
        email: customer.email,
        mobile_number: customer.phone,
        address: {
          street: customer.address,
          zip: customer.zipCode,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await safeReadResponseText(response);
      throw new ExternalServiceError(
        `Housecall Pro create customer failed with ${response.status}`,
        "We couldn't create the customer record before booking.",
        {
          status: response.status,
          url: buildUrl(this.config.baseUrl, this.config.customerPath),
          body: errorBody,
        },
      );
    }

    const body = await readJson<{ id?: string; customer?: { id?: string } }>(response);
    const customerId = body.id ?? body.customer?.id;
    if (!customerId) {
      throw new ExternalServiceError(
        "Housecall Pro create customer did not return a customer id",
        "We couldn't create the customer record before booking.",
      );
    }

    return customerId;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Token token="${this.config.token}"`,
      accept: "application/json",
      ...(this.config.companyId ? { "x-company-id": this.config.companyId } : {}),
    };
  }

  private requestInit(method: string, body?: unknown): RequestInit {
    return {
      method,
      headers: {
        ...this.headers(),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    };
  }

  private async fetchPaginated<T extends HousecallJobResponse>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const results: T[] = [];
    let nextCursor: string | undefined;
    let nextPage = 1;

    for (let index = 0; index < 20; index += 1) {
      const pageParams: Record<string, string> = { ...params };
      if (nextCursor) {
        pageParams.cursor = nextCursor;
      } else {
        pageParams.page = String(nextPage);
      }

      const response = await this.fetchWithRetry(buildUrl(this.config.baseUrl, path, pageParams), {
        headers: this.headers(),
      });

      if (!response.ok) {
        const errorBody = await safeReadResponseText(response);
        throw new ExternalServiceError(
          `Housecall Pro paginated fetch failed with ${response.status}`,
          "We hit a scheduling issue. Please try again.",
          {
            status: response.status,
            url: buildUrl(this.config.baseUrl, path, pageParams),
            body: errorBody,
          },
        );
      }

      const body = await readJson<T>(response);
      results.push(body);

      const linkHeader = response.headers.get("link");
      nextCursor = body.meta?.next_cursor;
      const hasMore = body.meta?.has_more;
      const nextPageHeader = body.meta?.next_page;

      if (nextCursor) {
        continue;
      }
      if (typeof nextPageHeader === "number") {
        nextPage = nextPageHeader;
        continue;
      }
      if (hasMore) {
        nextPage += 1;
        continue;
      }
      if (linkHeader?.includes('rel="next"')) {
        nextPage += 1;
        continue;
      }
      break;
    }

    return results;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(url, init);
      if (response.status !== 429 && response.status < 500) {
        return response;
      }

      if (attempt === maxAttempts) {
        return response;
      }

      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const backoffMs = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** (attempt - 1);
      await sleep(backoffMs + Math.round(Math.random() * 150));
    }

    throw new ExternalServiceError("Housecall Pro request retry logic exhausted unexpectedly.");
  }

  async fetchCustomerByPhoneLookup(
    phone: string,
  ): Promise<NonNullable<HousecallCustomerResponse["customers"]>[number] | undefined> {
    if (!this.config.token) {
      return undefined;
    }
    const response = await fetch(
      buildUrl(this.config.baseUrl, this.config.customerPath, {
        page_size: "100",
        search: phone,
      }),
      {
        headers: this.headers(),
      },
    );
    if (!response.ok) {
      return undefined;
    }
    const body = await readJson<HousecallCustomerResponse>(response);
    const normalized = normalizePhone(phone);
    return body.customers?.find((candidate) =>
      [candidate.mobile_number, candidate.home_number]
        .filter(Boolean)
        .some((p) => normalizePhone(p!) === normalized),
    );
  }

  private async findCustomer(customer: {
    firstName: string;
    lastName?: string;
    phone: string;
    email?: string;
    zipCode: string;
  }): Promise<{ id: string } | undefined> {
    const response = await fetch(
      buildUrl(this.config.baseUrl, this.config.customerPath, {
        page_size: "100",
        search: customer.phone,
      }),
      {
        headers: this.headers(),
      },
    );

    if (!response.ok) {
      const errorBody = await safeReadResponseText(response);
      throw new ExternalServiceError(
        `Housecall Pro customer search failed with ${response.status}`,
        "We couldn't verify the customer record before booking.",
        {
          status: response.status,
          url: buildUrl(this.config.baseUrl, this.config.customerPath, {
            page_size: "100",
            search: customer.phone,
          }),
          body: errorBody,
        },
      );
    }

    const body = await readJson<HousecallCustomerResponse>(response);
    return body.customers?.find((candidate) =>
      matchesCustomer(candidate, customer),
    );
  }
}

function buildLeadNote(payload: {
  serviceName: string;
  requestedWindow?: "morning" | "afternoon";
  notes?: string;
}): string {
  return [
    `Service request: ${payload.serviceName}`,
    payload.requestedWindow ? `Preferred window: ${payload.requestedWindow}` : undefined,
    payload.notes,
  ]
    .filter(Boolean)
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function normalizeTechnician(value: string | undefined): TechnicianName {
  const normalized = value?.trim().toLowerCase();
  if (normalized?.includes("nate")) {
    return "Nate";
  }
  if (normalized?.includes("steve")) {
    return "Steve";
  }
  if (normalized?.includes("brandon")) {
    return "Brandon";
  }
  if (normalized?.includes("dave")) {
    return "Dave";
  }
  return "Lou";
}

function employeeName(
  employee:
    | {
        first_name?: string;
        last_name?: string;
      }
    | undefined,
): string | undefined {
  if (!employee) {
    return undefined;
  }
  return [employee.first_name, employee.last_name].filter(Boolean).join(" ").trim() || undefined;
}

function matchesCustomer(
  candidate: {
    id: string;
    email?: string;
    mobile_number?: string;
    home_number?: string;
    address?: { zip?: string };
  },
  customer: {
    phone: string;
    email?: string;
    zipCode: string;
  },
): boolean {
  const normalizedPhone = normalizePhone(customer.phone);
  const phones = [candidate.mobile_number, candidate.home_number]
    .filter(Boolean)
    .map((value) => normalizePhone(value!));

  if (phones.includes(normalizedPhone)) {
    return true;
  }

  if (customer.email && candidate.email && customer.email.toLowerCase() === candidate.email.toLowerCase()) {
    return true;
  }

  return Boolean(candidate.address?.zip && candidate.address.zip === customer.zipCode);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}
