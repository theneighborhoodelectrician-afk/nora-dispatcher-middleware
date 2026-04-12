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

  return {
    ok: config.serviceAreas.allowedCities.includes(normalizedCity),
    normalizedCity,
    reason: config.serviceAreas.allowedCities.includes(normalizedCity)
      ? undefined
      : "outside_service_area",
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

  const filtered = response.slots.filter((slot) =>
    matchesPreferredWindow(slot.start, customerRequest.preferredWindow!, runtimeConfig.scheduling.timezone),
  );
  const slots = filtered.length ? filtered.slice(0, runtimeConfig.scheduling.defaultSlotCount) : response.slots;

  return {
    ...response,
    slots,
    presentation: {
      ...response.presentation,
      options: slots.slice(0, runtimeConfig.scheduling.defaultSlotCount).map((slot) => ({
        label: slot.label,
        start: slot.start,
        end: slot.end,
        technician: slot.technician,
        bookingTarget: slot.bookingTarget,
      })),
      replyText: filtered.length
        ? `I found ${joinOptionLabels(slots.map((slot) => slot.label))} in the ${customerRequest.preferredWindow}. Do any of those work for you?`
        : response.presentation.replyText,
    },
  };
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
