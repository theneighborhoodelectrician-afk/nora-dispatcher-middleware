import { AppError } from "./errors.js";
import { bookingWebhookSchema, availabilityWebhookSchema } from "../schemas/webhooks.js";
import { CandidateSlot, CustomerRequest } from "../domain/types.js";

function normalizeBasePayload(body: unknown) {
  const parsed = availabilityWebhookSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("Invalid availability webhook payload", 400, "Nora sent an invalid request.");
  }

  const data = parsed.data.data ?? {};
  const contact = parsed.data.contact ?? {};
  const customer = parsed.data.customer ?? {};

  const request: CustomerRequest = {
    firstName:
      parsed.data.firstName ??
      customer.firstName ??
      contact.firstName ??
      getNestedString(data, "firstName") ??
      "Customer",
    lastName:
      parsed.data.lastName ??
      customer.lastName ??
      contact.lastName ??
      getNestedString(data, "lastName"),
    phone:
      parsed.data.phone ??
      customer.phone ??
      contact.phone ??
      getNestedString(data, "phone") ??
      "",
    email:
      parsed.data.email ??
      customer.email ??
      contact.email ??
      getNestedString(data, "email"),
    address:
      parsed.data.address ??
      customer.address ??
      contact.address1 ??
      getNestedString(data, "address"),
    city:
      parsed.data.city ??
      customer.city ??
      contact.city ??
      getNestedString(data, "city"),
    zipCode:
      parsed.data.zipCode ??
      customer.zipCode ??
      contact.postalCode ??
      getNestedString(data, "zipCode") ??
      "",
    requestedService:
      parsed.data.requestedService ??
      parsed.data.service ??
      getNestedString(data, "requestedService") ??
      getNestedString(data, "service") ??
      "",
    notes: parsed.data.notes ?? getNestedString(data, "notes"),
    sameDayRequested:
      parsed.data.sameDayRequested ??
      getNestedBoolean(data, "sameDayRequested") ??
      false,
  };

  if (!request.phone || !request.zipCode || !request.requestedService) {
    throw new AppError(
      "Missing required availability fields",
      400,
      "Nora needs the customer phone number, zip code, and requested service before checking availability.",
    );
  }

  return {
    request,
    conversationId:
      parsed.data.conversationId ??
      getNestedString(data, "conversationId") ??
      parsed.data.webhookId ??
      getNestedString(data, "webhookId") ??
      request.phone,
    leadSource:
      parsed.data.leadSource ??
      parsed.data.source ??
      getNestedString(data, "leadSource") ??
      getNestedString(data, "source"),
    webhookId: parsed.data.webhookId ?? getNestedString(data, "webhookId") ?? request.phone,
  };
}

export function parseAvailabilityRequest(body: unknown): {
  request: CustomerRequest;
  conversationId: string;
  leadSource?: string;
  webhookId: string;
} {
  return normalizeBasePayload(body);
}

export function parseBookingRequest(body: unknown): {
  request: CustomerRequest;
  selectedSlot: CandidateSlot;
  conversationId: string;
  leadSource?: string;
  webhookId: string;
} {
  const parsed = bookingWebhookSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("Invalid booking webhook payload", 400, "Nora sent an invalid booking request.");
  }

  const base = normalizeBasePayload(body);
  return {
    ...base,
    selectedSlot: {
      technician: parsed.data.selectedSlot.technician as CandidateSlot["technician"],
      start: parsed.data.selectedSlot.start,
      end: parsed.data.selectedSlot.end ?? parsed.data.selectedSlot.start,
      score: 0,
      label: parsed.data.selectedSlot.start,
      reason: "Confirmed by customer",
      driveMinutes: 0,
      serviceCategory: "generic-electrical",
      bookingTarget: parsed.data.selectedSlot.bookingTarget ?? "job",
    },
  };
}

function getNestedString(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" ? value : undefined;
}

function getNestedBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  const value = data[key];
  return typeof value === "boolean" ? value : undefined;
}
