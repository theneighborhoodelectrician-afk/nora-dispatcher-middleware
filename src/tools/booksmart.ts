import { DEFAULT_BOOKSMART_CONFIG } from "../booksmart/defaultConfig.js";
import { BookSmartConfig, ServiceTypeConfig, ServiceTypeMatch } from "../booksmart/types.js";
import { AppConfig } from "../config.js";
import { CustomerRequest } from "../domain/types.js";
import { BookSmartHcpAdapter } from "../adapters/hcp/client.js";
import { getAvailability } from "../services/availability.js";
import { createBooking } from "../services/booking.js";
import { LeadResponsePayload } from "../domain/types.js";

export function checkServiceArea(
  city: string | undefined,
  config: BookSmartConfig = DEFAULT_BOOKSMART_CONFIG,
): {
  ok: boolean;
  normalizedCity?: string;
  reason?: "outside_service_area";
} {
  const normalizedCity = normalizeCity(city);
  if (!normalizedCity) {
    return {
      ok: false,
      reason: "outside_service_area",
    };
  }

  if (config.serviceAreas.restrictedCities.includes(normalizedCity)) {
    return {
      ok: false,
      normalizedCity,
      reason: "outside_service_area",
    };
  }

  const isAllowed = config.serviceAreas.allowedCities.some(
    (allowed) =>
      allowed.includes(normalizedCity) ||
      normalizedCity.includes(allowed) ||
      levenshtein(allowed, normalizedCity) <= 2,
  );

  return {
    ok: isAllowed,
    normalizedCity,
    reason: isAllowed ? undefined : "outside_service_area",
  };
}

export function classifyServiceType(
  text: string,
  config: BookSmartConfig = DEFAULT_BOOKSMART_CONFIG,
): ServiceTypeMatch {
  const normalized = text.trim().toLowerCase();
  const exactMatch = config.serviceTypes.find((serviceType) =>
    serviceType.classifierPhrases.some((phrase) => normalized.includes(phrase)),
  );

  return {
    matched: Boolean(exactMatch),
    serviceType:
      exactMatch ??
      config.serviceTypes.find((serviceType) => serviceType.id === "troubleshooting_general")!,
  };
}

export function detectUrgency(
  text: string,
  config: BookSmartConfig = DEFAULT_BOOKSMART_CONFIG,
): {
  urgent: boolean;
  matchedKeyword?: string;
} {
  const normalized = text.toLowerCase();
  const matchedKeyword = config.urgencyKeywords.find(({ phrase }) => normalized.includes(phrase))?.phrase;
  return {
    urgent: Boolean(matchedKeyword),
    matchedKeyword,
  };
}

export function requestPhoto(serviceType: ServiceTypeConfig): {
  shouldRequestPhoto: boolean;
  message?: string;
} {
  if (serviceType.photoRequest !== "recommended") {
    return { shouldRequestPhoto: false };
  }

  return {
    shouldRequestPhoto: true,
    message: "If you want, you can send a couple photos too. It helps us prep, but it’s not required.",
  };
}

export function getServiceTypeById(
  serviceTypeId: string | undefined,
  config: BookSmartConfig = DEFAULT_BOOKSMART_CONFIG,
): ServiceTypeConfig | undefined {
  if (!serviceTypeId) {
    return undefined;
  }

  return config.serviceTypes.find((serviceType) => serviceType.id === serviceTypeId);
}

export function handoffToHuman(reason: "urgent" | "outside_service_area" | "fallback"): {
  handoffRequired: true;
  reason: string;
} {
  if (reason === "urgent") {
    return {
      handoffRequired: true,
      reason: "urgent",
    };
  }

  if (reason === "outside_service_area") {
    return {
      handoffRequired: true,
      reason: "outside_service_area",
    };
  }

  return {
    handoffRequired: true,
    reason: "fallback",
  };
}

export async function getAvailabilityTool(
  customerRequest: CustomerRequest,
  runtimeConfig: AppConfig,
  config: BookSmartConfig = DEFAULT_BOOKSMART_CONFIG,
): Promise<Awaited<ReturnType<typeof getAvailability>>> {
  const adapter = new BookSmartHcpAdapter(runtimeConfig.hcp);
  const response = await getAvailability(customerRequest, adapter.rawClient, runtimeConfig);

  if (response.status !== "slots_available" || !customerRequest.preferredWindow) {
    return response;
  }

  const tz = runtimeConfig.scheduling.timezone;
  const n = runtimeConfig.scheduling.defaultSlotCount;
  const prefer = customerRequest.preferredWindow;
  const preferred = response.slots.filter((slot) => matchesPreferredWindow(slot.start, prefer, tz));
  const other = response.slots.filter((slot) => !matchesPreferredWindow(slot.start, prefer, tz));
  const slots = mergeSlotsPreferWindowFirst(preferred, other, n);
  const labels = slots.map((s) => s.label);
  const fullPreference = preferred.length >= n;
  const hasSomePreference = preferred.length > 0;

  const replyText = fullPreference
    ? `I found ${joinOptionLabels(labels)} in the ${prefer}. Do any of those work for you?`
    : hasSomePreference
      ? `I had limited ${prefer} openings, so I included other same-week times so you have ${n} options: ${joinOptionLabels(
          labels,
        )}. Do any of those work?`
      : (response.presentation?.replyText ?? `Here are the next available times. ${joinOptionLabels(labels)}.`);

  return {
    ...response,
    slots,
    presentation: {
      ...response.presentation,
      options: slots.map((slot) => ({
        label: slot.label,
        start: slot.start,
        end: slot.end,
        technician: slot.technician,
        bookingTarget: slot.bookingTarget,
      })),
      replyText,
    },
  };
}

function mergeSlotsPreferWindowFirst<T extends { technician: string; start: string }>(
  inPreferredWindow: T[],
  otherSlots: T[],
  count: number,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const list of [inPreferredWindow, otherSlots]) {
    for (const slot of list) {
      if (out.length >= count) {
        break;
      }
      const key = `${slot.technician}:${slot.start}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(slot);
    }
  }
  return out;
}

export async function findOrCreateCustomerTool(
  customer: CustomerRequest,
  runtimeConfig: AppConfig,
): Promise<{ customerId: string }> {
  const adapter = new BookSmartHcpAdapter(runtimeConfig.hcp);
  return adapter.findOrCreateCustomer({
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    zipCode: customer.zipCode,
  });
}

export async function createBookingTool(
  customerRequest: CustomerRequest,
  selectedSlot: Parameters<typeof createBooking>[1],
  runtimeConfig: AppConfig,
): Promise<Awaited<ReturnType<typeof createBooking>>> {
  const adapter = new BookSmartHcpAdapter(runtimeConfig.hcp);
  return createBooking(customerRequest, selectedSlot, adapter.rawClient, runtimeConfig);
}

export async function createLeadTool(
  customerRequest: CustomerRequest,
  runtimeConfig: AppConfig,
  leadSource = "website",
): Promise<LeadResponsePayload> {
  const adapter = new BookSmartHcpAdapter(runtimeConfig.hcp);
  const result = await adapter.createLead({
    customer: {
      firstName: customerRequest.firstName,
      lastName: customerRequest.lastName,
      phone: customerRequest.phone,
      email: customerRequest.email,
      address: customerRequest.address,
      city: customerRequest.city,
      zipCode: customerRequest.zipCode,
    },
    serviceName: customerRequest.requestedService,
    requestedWindow: customerRequest.preferredWindow,
    leadSource,
    notes: customerRequest.notes,
  });

  return {
    success: true,
    status: "lead_submitted",
    externalId: result.id,
    message: "Lead submitted.",
    presentation: {
      replyText: runtimeConfig.contact.humanHandoffPhone
        ? `I'll get it on the calendar ASAP. If you need me now call ${runtimeConfig.contact.humanHandoffPhone}.`
        : "I'll get it on the calendar ASAP.",
      followUpPrompt:
        "Confirm that the request is in and the team will follow up with the appointment time.",
    },
  };
}

function normalizeCity(city: string | undefined): string | undefined {
  if (!city) {
    return undefined;
  }

  return city.trim().toLowerCase();
}

function matchesPreferredWindow(
  isoStart: string,
  preferredWindow: "morning" | "afternoon",
  timezone: string,
): boolean {
  const formattedHour = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).format(new Date(isoStart));
  const hour = Number(formattedHour);
  return preferredWindow === "morning" ? hour < 12 : hour >= 12;
}

function joinOptionLabels(labels: string[]): string {
  if (labels.length === 0) {
    return "a few openings";
  }

  if (labels.length === 1) {
    return labels[0]!;
  }

  if (labels.length === 2) {
    return `${labels[0]} or ${labels[1]}`;
  }

  return `${labels[0]}, ${labels[1]}, or ${labels[2]}`;
}

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]) as number[][];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i]![j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1]![j - 1]!
          : 1 + Math.min(
            matrix[i - 1]![j - 1]!,
            matrix[i - 1]![j]!,
            matrix[i]![j - 1]!,
          );
    }
  }
  return matrix[b.length]![a.length]!;
}
