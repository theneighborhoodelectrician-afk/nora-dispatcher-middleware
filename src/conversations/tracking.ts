import type { ChatSessionState } from "../services/chatbot.js";
import type { PresentedSlotOption } from "../domain/types.js";
import {
  ContactRecord,
  ConversationMessageRecord,
  ConversationOutcomeRecord,
  ConversationRecord,
  ConversationStage,
  LeadSourceCode,
  LeadSourceRecord,
  SlotExposureRecord,
  UrgencyLevel,
} from "./types.js";
import { StorageAdapter } from "../storage/types.js";

export function normalizeLeadSource(value: string | undefined): LeadSourceCode {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "website":
    case "blooio":
    case "qr_code":
    case "lsa":
    case "gbp":
    case "after_hours_text":
    case "manual_link":
    case "internal_test":
      return normalized;
    default:
      return "unknown";
  }
}

export function defaultLeadSourceRecord(code: LeadSourceCode): LeadSourceRecord {
  return {
    code,
    displayName: code.replace(/_/g, " "),
    active: true,
  };
}

export function buildContactRecord(state: ChatSessionState, timestamp: number): ContactRecord | undefined {
  const contactId = state.customer.phone ?? state.sessionId;
  if (!contactId) {
    return undefined;
  }

  return {
    contactId,
    phone: state.customer.phone,
    firstName: state.customer.firstName,
    lastName: state.customer.lastName,
    email: state.customer.email,
    address: state.customer.address,
    city: state.customer.city,
    zipCode: state.customer.zipCode,
    updatedAt: timestamp,
  };
}

export function buildConversationRecord(
  state: ChatSessionState,
  leadSource: LeadSourceCode,
  timestamp: number,
): ConversationRecord {
  return {
    conversationId: state.sessionId,
    contactId: state.customer.phone ?? state.sessionId,
    leadSource,
    timestampStarted: state.analytics.timestampStarted,
    timestampLastMessage: timestamp,
    currentStage: currentConversationStage(state),
  };
}

export function buildConversationOutcomeRecord(
  state: ChatSessionState,
  leadSource: LeadSourceCode,
  timestamp: number,
): ConversationOutcomeRecord {
  const slotsShownCount = state.analytics.slotsShownCount;
  const finalBookingStatus =
    state.bookingStatus === "booked"
      ? "booked"
      : state.bookingStatus === "lead_submitted"
        ? "lead_submitted"
      : state.bookingStatus === "handoff"
        ? "handoff"
        : state.bookingStatus ?? "collecting";

  return {
    conversationId: state.sessionId,
    leadSource,
    timestampStarted: state.analytics.timestampStarted,
    timestampLastMessage: timestamp,
    firstCustomerMessage: state.analytics.firstCustomerMessage,
    classifiedServiceType: state.serviceTypeId,
    urgencyLevel: state.urgency ?? "normal",
    urgencyKeywordsDetected: [...state.analytics.urgencyKeywordsDetected],
    addressCollected: Boolean(state.customer.address && state.customer.zipCode),
    phoneCollected: Boolean(state.customer.phone),
    emailCollected: Boolean(state.customer.email),
    photoSent: state.analytics.photoSent,
    availabilityShown: slotsShownCount > 0,
    slotsShownCount,
    slotSelected: Boolean(state.analytics.selectedSlotOptionId),
    bookedYesNo: state.bookingStatus === "booked" || state.bookingStatus === "lead_submitted",
    handoffYesNo: state.bookingStatus === "handoff",
    abandonmentStage:
      state.bookingStatus === "booked" || state.bookingStatus === "handoff"
        ? undefined
        : state.stage,
    finalHcpJobType: state.analytics.finalHcpJobType,
    finalBookingStatus,
    systemSummary: buildSystemSummary(state),
  };
}

export async function syncConversationSnapshot(
  storage: StorageAdapter,
  state: ChatSessionState,
  leadSource: LeadSourceCode,
  timestamp: number,
): Promise<void> {
  await storage.upsertLeadSource(defaultLeadSourceRecord(leadSource));
  const contact = buildContactRecord(state, timestamp);
  if (contact) {
    await storage.upsertContact(contact);
  }
  await storage.upsertConversation(buildConversationRecord(state, leadSource, timestamp));
  await storage.upsertConversationOutcome(buildConversationOutcomeRecord(state, leadSource, timestamp));
}

export async function recordStageOnce(
  storage: StorageAdapter,
  state: ChatSessionState,
  stage: ConversationStage,
  timestamp: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (state.analytics.recordedStages.includes(stage)) {
    return;
  }

  state.analytics.recordedStages.push(stage);
  await storage.appendConversationStage({
    conversationId: state.sessionId,
    stage,
    timestamp,
    metadata,
  });
}

export async function recordMessage(
  storage: StorageAdapter,
  record: ConversationMessageRecord,
): Promise<void> {
  await storage.appendConversationMessage(record);
}

export async function recordSlotExposureSet(
  storage: StorageAdapter,
  state: ChatSessionState,
  options: PresentedSlotOption[],
  timestamp: number,
): Promise<void> {
  state.analytics.slotsShownCount = Math.max(state.analytics.slotsShownCount, options.length);

  for (const [index, option] of options.entries()) {
    const slotOptionId = buildSlotOptionId(option);
    if (!state.analytics.exposedSlotOptionIds.includes(slotOptionId)) {
      state.analytics.exposedSlotOptionIds.push(slotOptionId);
    }

    await storage.upsertSlotExposure({
      conversationId: state.sessionId,
      slotOptionId,
      slotLabel: option.label,
      slotStart: option.start,
      slotEnd: option.end,
      slotOrderPresented: index + 1,
      selectedYesNo: state.analytics.selectedSlotOptionId === slotOptionId,
      timestamp,
    });
  }
}

export async function recordSlotSelection(
  storage: StorageAdapter,
  state: ChatSessionState,
  option: PresentedSlotOption,
  timestamp: number,
): Promise<void> {
  const slotOptionId = buildSlotOptionId(option);
  state.analytics.selectedSlotOptionId = slotOptionId;
  await storage.upsertSlotExposure({
    conversationId: state.sessionId,
    slotOptionId,
    slotLabel: option.label,
    slotStart: option.start,
    slotEnd: option.end,
    slotOrderPresented: 1,
    selectedYesNo: true,
    timestamp,
  });
}

export function buildSlotOptionId(option: PresentedSlotOption): string {
  return `${option.start}__${option.end}__${option.technician}__${option.bookingTarget}`;
}

function buildSystemSummary(state: ChatSessionState): string | undefined {
  if (state.bookingStatus === "booked") {
    return `Booked ${state.serviceTypeId ?? "service"} after presenting ${state.analytics.slotsShownCount} slots.`;
  }
  if (state.bookingStatus === "lead_submitted") {
    return `Lead submitted for ${state.serviceTypeId ?? "service"} with ${state.customer.preferredWindow ?? "unspecified"} preference.`;
  }
  if (state.bookingStatus === "handoff") {
    return state.analytics.lastHandoffReason
      ? `Handed off: ${state.analytics.lastHandoffReason}.`
      : `Handed off during ${state.stage}.`;
  }
  return undefined;
}

function currentConversationStage(state: ChatSessionState): ConversationStage {
  if (state.bookingStatus === "booked") {
    return "booked";
  }
  if (state.bookingStatus === "lead_submitted") {
    return "lead_submitted";
  }
  if (state.bookingStatus === "handoff") {
    return "escalated";
  }
  return stageFromChatState(state);
}

function stageFromChatState(state: ChatSessionState): ConversationStage {
  switch (state.stage) {
    case "collect_service_type":
      return "city_collected";
    case "collect_address":
      return "service_identified";
    case "collect_zip":
      return "address_collected";
    case "collect_name":
      return "started";
    case "collect_phone":
    case "collect_email":
      return "contact_collected";
    case "collect_preferred_window":
    case "collect_job_notes":
      return state.analytics.photoRequested ? "photo_requested" : "contact_collected";
    case "ready_for_availability":
      return "contact_collected";
    case "confirm_returning_address":
      return "city_collected";
    case "lead_submitted":
      return "lead_submitted";
    case "offer_slots":
      return "availability_presented";
    case "booked":
      return "booked";
    case "human_handoff":
      return "escalated";
  }
}

export function createInitialAnalytics(
  timestamp: number,
  firstCustomerMessage: string,
  leadSource: LeadSourceCode,
): ChatSessionState["analytics"] {
  return {
    timestampStarted: timestamp,
    firstCustomerMessage,
    leadSource,
    recordedStages: [],
    urgencyKeywordsDetected: [],
    exposedSlotOptionIds: [],
    slotsShownCount: 0,
    photoRequested: false,
    photoSent: false,
  };
}

export function mergeUrgencyKeywords(
  current: string[],
  nextKeyword: string | undefined,
): string[] {
  if (!nextKeyword || current.includes(nextKeyword)) {
    return current;
  }
  return [...current, nextKeyword];
}

export function inferPhotoSent(input: {
  attachments?: Array<{ type?: string }>;
  mediaUrls?: string[];
}): boolean {
  if (input.mediaUrls?.length) {
    return true;
  }

  return Boolean(input.attachments?.some((attachment) => attachment.type?.startsWith("image/")));
}

export function urgencyFromKeywordPresence(keywords: string[]): UrgencyLevel {
  return keywords.length ? "urgent" : "normal";
}
