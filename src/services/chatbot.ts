import { DEFAULT_BOOKSMART_CONFIG } from "../booksmart/defaultConfig.js";
import { loadBookSmartConfig } from "../booksmart/storage.js";
import { BookSmartServiceTypeId } from "../booksmart/types.js";
import { normalizeBlooioInboundPayload } from "../channels/blooio/normalize.js";
import { AppConfig } from "../config.js";
import {
  createInitialAnalytics,
  inferPhotoSent,
  mergeUrgencyKeywords,
  normalizeLeadSource,
  recordMessage,
  recordSlotExposureSet,
  recordSlotSelection,
  recordStageOnce,
  syncConversationSnapshot,
} from "../conversations/tracking.js";
import { ConversationStage, LeadSourceCode } from "../conversations/types.js";
import { CustomerRequest, PresentedSlotOption } from "../domain/types.js";
import { AppError } from "../lib/errors.js";
import { chatWebhookSchema } from "../schemas/chat.js";
import { StorageAdapter } from "../storage/types.js";
import {
  checkServiceArea,
  classifyServiceType,
  createBookingTool,
  detectUrgency,
  getServiceTypeById,
  getAvailabilityTool,
  handoffToHuman,
  requestPhoto,
} from "../tools/booksmart.js";

type ChatStage =
  | "collect_city"
  | "collect_service_type"
  | "collect_address"
  | "collect_zip"
  | "collect_name"
  | "collect_phone"
  | "collect_preferred_window"
  | "offer_slots"
  | "booked"
  | "human_handoff";

interface ChatTranscriptEntry {
  direction: "inbound" | "outbound";
  text: string;
  createdAt: number;
}

interface ChatAnalyticsState {
  timestampStarted: number;
  firstCustomerMessage: string;
  leadSource: LeadSourceCode;
  recordedStages: ConversationStage[];
  urgencyKeywordsDetected: string[];
  exposedSlotOptionIds: string[];
  selectedSlotOptionId?: string;
  slotsShownCount: number;
  photoRequested: boolean;
  photoSent: boolean;
  finalHcpJobType?: string;
}

export interface ChatSessionState {
  sessionId: string;
  stage: ChatStage;
  customer: Partial<CustomerRequest>;
  bookingStatus?: "collecting" | "ready_for_availability" | "offered" | "booked" | "handoff";
  serviceTypeId?: BookSmartServiceTypeId;
  urgency?: "normal" | "urgent";
  lastOfferedOptions?: PresentedSlotOption[];
  transcript: ChatTranscriptEntry[];
  analytics: ChatAnalyticsState;
}

export interface ChatReplyPayload {
  success: boolean;
  sessionId: string;
  replyText: string;
  stage: ChatStage;
  options?: PresentedSlotOption[];
  bookingId?: string;
  handoffRequired?: boolean;
}

export async function handleChatMessage(
  body: unknown,
  storage: StorageAdapter,
  config: AppConfig,
): Promise<ChatReplyPayload> {
  const parsed = chatWebhookSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("Invalid chat payload", 400, "The chat message payload was invalid.");
  }

  const normalized = normalizeBlooioInboundPayload(parsed.data);
  const sessionId = normalized.sessionId;
  if (!sessionId) {
    throw new AppError("Missing chat session id", 400, "A chat session id is required.");
  }

  const messageText = normalizeText(normalized.text);
  if (!messageText) {
    throw new AppError("Missing chat message text", 400, "The chat message was empty.");
  }

  const now = Date.now();
  const leadSource = normalizeLeadSource(normalized.leadSource);
  const existing = await storage.getChatSession<ChatSessionState>(sessionId);
  const state = mergeState(existing?.payload, sessionId, normalized, messageText, now, leadSource);
  const photoReceivedThisTurn = inferPhotoSent(normalized);
  state.analytics.photoSent = state.analytics.photoSent || photoReceivedThisTurn;
  const bookSmartConfig = await loadBookSmartConfig(storage);
  appendTranscript(state, "inbound", messageText);
  await syncConversationSnapshot(storage, state, leadSource, now);
  await recordStageOnce(storage, state, "started", now, { leadSource });
  if (photoReceivedThisTurn) {
    await recordStageOnce(storage, state, "photo_received", now);
  }
  await recordMessage(storage, {
    conversationId: state.sessionId,
    direction: "inbound",
    text: messageText,
    timestamp: now,
    metadata: {
      messageId: normalized.messageId,
    },
  });

  if (state.stage === "offer_slots" && state.lastOfferedOptions?.length) {
    const selectedOption = matchOptionSelection(messageText, state.lastOfferedOptions);
    if (selectedOption) {
      await recordSlotSelection(storage, state, selectedOption, now);
      await recordStageOnce(storage, state, "slot_selected", now, {
        slotLabel: selectedOption.label,
      });
      await recordMessage(storage, {
        conversationId: state.sessionId,
        direction: "tool",
        timestamp: now,
        toolName: "create_booking",
        toolCallSummary: `Booking requested for ${selectedOption.label}.`,
      });
      const booking = await createBookingTool(
        toCustomerRequest(state.customer),
        {
          technician: selectedOption.technician,
          start: selectedOption.start,
          end: selectedOption.end,
          bookingTarget: selectedOption.bookingTarget,
          label: selectedOption.label,
          driveMinutes: 0,
          reason: "Selected in BookSmart chat",
          score: 0,
          serviceCategory: "generic-electrical",
        },
        config,
      );

      if (booking.status === "booked") {
        state.stage = "booked";
        state.bookingStatus = "booked";
        state.analytics.finalHcpJobType = selectedOption.bookingTarget;
        await storage.appendBookingEvent({
          conversationId: state.sessionId,
          bookingExternalId: booking.externalId,
          finalHcpJobType: selectedOption.bookingTarget,
          bookingStatus: booking.status,
          timestamp: now,
          metadata: {
            slotLabel: selectedOption.label,
          },
        });
        await recordStageOnce(storage, state, "booked", now, {
          bookingId: booking.externalId,
        });
        const reply = `${booking.presentation.replyText} You’re booked for ${selectedOption.label}.`;
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: reply,
          stage: state.stage,
          bookingId: booking.externalId,
        }, now);
      }

      if (booking.presentation.options?.length) {
        state.lastOfferedOptions = booking.presentation.options;
        state.stage = "offer_slots";
        state.bookingStatus = "offered";
        await recordSlotExposureSet(storage, state, booking.presentation.options, now);
        await recordStageOnce(storage, state, "availability_presented", now, {
          slotCount: booking.presentation.options.length,
        });
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: booking.presentation.replyText,
          stage: state.stage,
          options: state.lastOfferedOptions,
        }, now);
      }

      state.stage = "human_handoff";
      state.bookingStatus = "handoff";
      await storage.appendBookingEvent({
        conversationId: state.sessionId,
        finalHcpJobType: selectedOption.bookingTarget,
        bookingStatus: booking.status,
        timestamp: now,
      });
      await storage.appendHandoffEvent({
        conversationId: state.sessionId,
        reason: "booking_fallback",
        timestamp: now,
        metadata: {
          bookingStatus: booking.status,
        },
      });
      await recordStageOnce(storage, state, "escalated", now, {
        reason: "booking_fallback",
      });
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: booking.presentation.replyText,
        stage: state.stage,
        handoffRequired: true,
      }, now);
    }
  }

  if (shouldHandOff(messageText)) {
    state.stage = "human_handoff";
    state.bookingStatus = "handoff";
    await storage.appendHandoffEvent({
      conversationId: state.sessionId,
      reason: "human_requested",
      timestamp: now,
    });
    await recordStageOnce(storage, state, "escalated", now, {
      reason: "human_requested",
    });
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: bookSmartConfig.conversation.handoffMessage,
      stage: state.stage,
      handoffRequired: true,
    }, now);
  }

  if (state.stage === "collect_city" && state.transcript.length > 1) {
    state.customer.city = messageText;
    await recordStageOnce(storage, state, "city_collected", now, {
      city: state.customer.city,
    });
  }

  if (!state.customer.city) {
    state.stage = "collect_city";
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: bookSmartConfig.conversation.openingQuestion,
      stage: state.stage,
    }, now);
  }

  const areaDecision = checkServiceArea(state.customer.city, bookSmartConfig);
  await recordMessage(storage, {
    conversationId: state.sessionId,
    direction: "tool",
    timestamp: now,
    toolName: "check_service_area",
    toolCallSummary: `Checked service area for ${state.customer.city ?? "unknown city"}.`,
    metadata: {
      ok: areaDecision.ok,
    },
  });
  if (!areaDecision.ok) {
    handoffToHuman("outside_service_area");
    state.stage = "human_handoff";
    state.bookingStatus = "handoff";
    await storage.appendHandoffEvent({
      conversationId: state.sessionId,
      reason: "outside_service_area",
      timestamp: now,
      metadata: {
        city: state.customer.city,
      },
    });
    await recordStageOnce(storage, state, "escalated", now, {
      reason: "outside_service_area",
    });
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: "Thanks. That area needs a quick manual review from our team before we book it.",
      stage: state.stage,
      handoffRequired: true,
    }, now);
  }

  if (!state.customer.requestedService) {
    if (state.stage === "collect_service_type") {
      await recordMessage(storage, {
        conversationId: state.sessionId,
        direction: "tool",
        timestamp: now,
        toolName: "classify_service_type",
        toolCallSummary: `Classifying service type from customer message.`,
      });
      setServiceDetails(state, messageText, bookSmartConfig);
      await recordStageOnce(storage, state, "service_identified", now, {
        serviceTypeId: state.serviceTypeId,
      });
      if (state.urgency === "urgent") {
        handoffToHuman("urgent");
        state.stage = "human_handoff";
        state.bookingStatus = "handoff";
        await persistUrgencyHits(storage, state, now);
        await storage.appendHandoffEvent({
          conversationId: state.sessionId,
          reason: "urgent",
          timestamp: now,
          metadata: {
            keywords: state.analytics.urgencyKeywordsDetected,
          },
        });
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp: now,
          toolName: "handoff_to_human",
          toolCallSummary: `Escalating urgent request to a human.`,
        });
        await recordStageOnce(storage, state, "escalated", now, {
          reason: "urgent",
        });
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: "This sounds urgent, so I’m having our team review it right away instead of continuing with normal booking.",
          stage: state.stage,
          handoffRequired: true,
        }, now);
      }

      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What’s the service address?",
        stage: state.stage,
      }, now);
    } else {
      state.stage = "collect_service_type";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What kind of electrical project do you need help with?",
        stage: state.stage,
      }, now);
    }
  }

  if (!state.customer.requestedService) {
    setServiceDetails(state, messageText, bookSmartConfig);
  }

  if (state.urgency === "urgent") {
    handoffToHuman("urgent");
    state.stage = "human_handoff";
    state.bookingStatus = "handoff";
    await persistUrgencyHits(storage, state, now);
    await storage.appendHandoffEvent({
      conversationId: state.sessionId,
      reason: "urgent",
      timestamp: now,
      metadata: {
        keywords: state.analytics.urgencyKeywordsDetected,
      },
    });
    await recordMessage(storage, {
      conversationId: state.sessionId,
      direction: "tool",
      timestamp: now,
      toolName: "handoff_to_human",
      toolCallSummary: `Escalating urgent request to a human.`,
    });
    await recordStageOnce(storage, state, "escalated", now, {
      reason: "urgent",
    });
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: "This sounds urgent, so I’m having our team review it right away instead of continuing with normal booking.",
      stage: state.stage,
      handoffRequired: true,
    }, now);
  }

  if (!state.customer.address) {
    if (state.stage === "collect_address") {
      state.customer.address = messageText;
      state.customer.zipCode = state.customer.zipCode ?? extractZipCode(messageText);
      await recordStageOnce(storage, state, "address_collected", now, {
        zipCode: state.customer.zipCode,
      });
      if (!state.customer.zipCode) {
        state.stage = "collect_zip";
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: "What zip code is the project in?",
          stage: state.stage,
        }, now);
      }

      state.stage = "collect_name";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What’s your first name?",
        stage: state.stage,
      }, now);
    } else {
      state.stage = "collect_address";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What’s the service address?",
        stage: state.stage,
      }, now);
    }
  }

  if (!state.customer.zipCode) {
    const zip = extractZipCode(messageText);
    state.stage = "collect_zip";
    if (!zip) {
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What zip code is the project in?",
        stage: state.stage,
      }, now);
    }
    state.customer.zipCode = zip;
    await recordStageOnce(storage, state, "address_collected", now, {
      zipCode: zip,
    });
    state.stage = "collect_name";
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: "What’s your first name?",
      stage: state.stage,
    }, now);
  }

  if (!state.customer.firstName) {
    if (state.stage === "collect_name") {
      state.customer.firstName = inferFirstName(messageText);
      if (!state.customer.phone) {
        state.stage = "collect_phone";
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: "What’s the best phone number for the booking?",
          stage: state.stage,
        }, now);
      }

      await recordStageOnce(storage, state, "contact_collected", now, {
        firstName: state.customer.firstName,
      });
      state.stage = "collect_preferred_window";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "Do you prefer a morning or afternoon appointment?",
        stage: state.stage,
      }, now);
    } else {
      state.stage = "collect_name";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What’s your first name?",
        stage: state.stage,
      }, now);
    }
  }

  if (!state.customer.phone) {
    const phone = extractPhoneNumber(messageText);
    state.stage = "collect_phone";
    if (!phone) {
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "What’s the best phone number for the booking?",
        stage: state.stage,
      }, now);
    }
    state.customer.phone = phone;
    await recordStageOnce(storage, state, "contact_collected", now, {
      phone,
    });
    state.stage = "collect_preferred_window";
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: "Do you prefer a morning or afternoon appointment?",
      stage: state.stage,
    }, now);
  }

  if (!state.customer.preferredWindow) {
    const preferredWindow = inferPreferredWindow(messageText);
    state.stage = "collect_preferred_window";
    if (!preferredWindow) {
      const photoPrompt = state.serviceTypeId
        ? requestPhoto(getServiceTypeById(state.serviceTypeId, bookSmartConfig)!).message
        : undefined;
      if (photoPrompt) {
        state.analytics.photoRequested = true;
        await recordStageOnce(storage, state, "photo_requested", now, {
          serviceTypeId: state.serviceTypeId,
        });
      }
      const reply = photoPrompt
        ? `Do you prefer a morning or afternoon appointment? ${photoPrompt}`
        : "Do you prefer a morning or afternoon appointment?";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: reply,
        stage: state.stage,
      }, now);
    }
    state.customer.preferredWindow = preferredWindow;
  }

  await recordMessage(storage, {
    conversationId: state.sessionId,
    direction: "tool",
    timestamp: now,
    toolName: "get_availability",
    toolCallSummary: `Checking live availability for ${state.customer.requestedService}.`,
  });
  const availability = await getAvailabilityTool(toCustomerRequest(state.customer), config, bookSmartConfig);
  state.lastOfferedOptions = availability.presentation.options;

  if (availability.status === "slots_available" && availability.presentation.options?.length) {
    state.stage = "offer_slots";
    state.bookingStatus = "offered";
    await recordSlotExposureSet(storage, state, availability.presentation.options, now);
    await recordStageOnce(storage, state, "availability_presented", now, {
      slotCount: availability.presentation.options.length,
    });
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: availability.presentation.replyText,
      stage: state.stage,
      options: availability.presentation.options,
    }, now);
  }

  state.stage = "human_handoff";
  state.bookingStatus = "handoff";
  await storage.appendHandoffEvent({
    conversationId: state.sessionId,
    reason: availability.status,
    timestamp: now,
  });
  await recordStageOnce(storage, state, "escalated", now, {
    reason: availability.status,
  });
  return persistReply(storage, state, {
    success: true,
    sessionId,
    replyText: availability.presentation.replyText,
    stage: state.stage,
    handoffRequired: true,
  }, now);
}

function mergeState(
  current: ChatSessionState | undefined,
  sessionId: string,
  normalized: ReturnType<typeof normalizeBlooioInboundPayload>,
  messageText: string,
  timestamp: number,
  leadSource: LeadSourceCode,
): ChatSessionState {
  const next: ChatSessionState = current ?? {
    sessionId,
    stage: "collect_city",
    customer: {},
    bookingStatus: "collecting",
    transcript: [],
    analytics: createInitialAnalytics(timestamp, messageText, leadSource),
  };

  next.customer.phone = normalized.customer?.phone ?? normalized.contact?.phone ?? next.customer.phone;
  next.customer.email = normalized.customer?.email ?? normalized.contact?.email ?? next.customer.email;
  next.customer.address = normalized.customer?.address ?? normalized.contact?.address1 ?? next.customer.address;
  next.customer.city = normalized.customer?.city ?? normalized.contact?.city ?? next.customer.city;
  next.customer.zipCode = normalized.customer?.zipCode ?? normalized.contact?.postalCode ?? next.customer.zipCode;
  next.customer.firstName = normalized.customer?.firstName ?? normalized.contact?.firstName ?? next.customer.firstName;
  next.customer.lastName = normalized.customer?.lastName ?? normalized.contact?.lastName ?? next.customer.lastName;

  if (!next.customer.phone && !current) {
    const phoneFromText = extractPhoneNumber(messageText);
    if (phoneFromText) {
      next.customer.phone = phoneFromText;
    }
  }

  return next;
}

function setServiceDetails(
  state: ChatSessionState,
  messageText: string,
  config = DEFAULT_BOOKSMART_CONFIG,
): void {
  const serviceMatch = classifyServiceType(messageText, config);
  state.customer.requestedService = serviceMatch.serviceType.requestedServiceLabel;
  state.serviceTypeId = serviceMatch.serviceType.id;
  state.stage = "collect_address";

  const urgency = detectUrgency(messageText, config);
  state.analytics.urgencyKeywordsDetected = mergeUrgencyKeywords(
    state.analytics.urgencyKeywordsDetected,
    urgency.matchedKeyword,
  );
  if (urgency.urgent || serviceMatch.serviceType.category === "urgent") {
    state.urgency = "urgent";
    return;
  }

  state.urgency = "normal";
}

function toCustomerRequest(customer: Partial<CustomerRequest>): CustomerRequest {
  if (!customer.requestedService || !customer.zipCode || !customer.phone) {
    throw new AppError(
      "Chat session missing required scheduling fields",
      400,
      "I still need the service details, zip code, and phone number before I can check the schedule.",
    );
  }

  return {
    firstName: customer.firstName ?? "Neighbor",
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    city: customer.city,
    address: customer.address,
    zipCode: customer.zipCode,
    requestedService: customer.requestedService,
    notes: customer.notes,
    sameDayRequested: customer.sameDayRequested,
    preferredWindow: customer.preferredWindow,
  };
}

async function persistReply(
  storage: StorageAdapter,
  state: ChatSessionState,
  payload: ChatReplyPayload,
  timestamp = Date.now(),
): Promise<ChatReplyPayload> {
  appendTranscript(state, "outbound", payload.replyText);
  await recordMessage(storage, {
    conversationId: state.sessionId,
    direction: "outbound",
    text: payload.replyText,
    timestamp,
    metadata: {
      stage: payload.stage,
      handoffRequired: payload.handoffRequired,
      bookingId: payload.bookingId,
    },
  });
  await syncConversationSnapshot(storage, state, state.analytics.leadSource, timestamp);
  await storage.storeChatSession(state.sessionId, state);
  return payload;
}

function appendTranscript(state: ChatSessionState, direction: "inbound" | "outbound", text: string): void {
  state.transcript.push({
    direction,
    text,
    createdAt: Date.now(),
  });

  if (state.transcript.length > 30) {
    state.transcript = state.transcript.slice(-30);
  }
}

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function extractZipCode(text: string): string | undefined {
  return text.match(/\b\d{5}\b/)?.[0];
}

function extractPhoneNumber(text: string): string | undefined {
  const digits = text.replace(/\D/g, "");
  if (digits.length < 10) {
    return undefined;
  }

  const normalized = digits.slice(-10);
  return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
}

function inferFirstName(text: string): string {
  const cleaned = text.replace(/[^a-zA-Z\s'-]/g, " ").trim();
  const firstWord = cleaned.split(/\s+/).find(Boolean);
  return firstWord ? capitalize(firstWord) : "Neighbor";
}

function inferPreferredWindow(text: string): "morning" | "afternoon" | undefined {
  const normalized = text.toLowerCase();
  if (/\b(morning|am|earlier|first half)\b/.test(normalized)) {
    return "morning";
  }
  if (/\b(afternoon|pm|later|second half)\b/.test(normalized)) {
    return "afternoon";
  }
  return undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function shouldHandOff(text: string): boolean {
  return /\b(human|person|manager|dispatcher|call me)\b/i.test(text);
}

function matchOptionSelection(
  text: string,
  options: PresentedSlotOption[],
): PresentedSlotOption | undefined {
  const normalized = text.toLowerCase();
  const ordinalMap: Array<{ pattern: RegExp; index: number }> = [
    { pattern: /\b(1|one|first|earliest)\b/, index: 0 },
    { pattern: /\b(2|two|second)\b/, index: 1 },
    { pattern: /\b(3|three|third|last)\b/, index: 2 },
  ];

  for (const entry of ordinalMap) {
    if (entry.pattern.test(normalized)) {
      return options[entry.index];
    }
  }

  return options.find((option) => normalized.includes(option.label.toLowerCase()));
}

async function persistUrgencyHits(
  storage: StorageAdapter,
  state: ChatSessionState,
  timestamp: number,
): Promise<void> {
  for (const keyword of state.analytics.urgencyKeywordsDetected) {
    const existing = await storage.listUrgencyKeywordHits(state.sessionId);
    if (existing.some((hit) => hit.keywordDetected === keyword)) {
      continue;
    }
    await storage.appendUrgencyKeywordHit({
      conversationId: state.sessionId,
      keywordDetected: keyword,
      mappedUrgencyLevel: "urgent",
      timestamp,
    });
  }
}
