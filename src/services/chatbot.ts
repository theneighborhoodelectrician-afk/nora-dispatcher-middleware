import { DEFAULT_BOOKSMART_CONFIG } from "../booksmart/defaultConfig.js";
import { loadBookSmartConfig } from "../booksmart/storage.js";
import { BookSmartServiceTypeId } from "../booksmart/types.js";
import { normalizeBlooioInboundPayload } from "../channels/blooio/normalize.js";
import { AppConfig } from "../config.js";
import {
  buildSlotOptionId,
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
import { buildBookSmartSystemPrompt } from "../prompts/booksmartSystemPrompt.js";
import { chatWebhookSchema } from "../schemas/chat.js";
import { StorageAdapter } from "../storage/types.js";
import {
  checkServiceArea,
  classifyServiceType,
  createBookingTool,
  createLeadTool,
  detectUrgency,
  findOrCreateCustomerTool,
  getServiceTypeById,
  getAvailabilityTool,
  handoffToHuman,
  requestPhoto,
} from "../tools/booksmart.js";
import { OpenAiFunctionTool, runOpenAiResponses } from "./openaiResponses.js";

type ChatStage =
  | "collect_city"
  | "collect_service_type"
  | "collect_address"
  | "collect_zip"
  | "collect_name"
  | "collect_phone"
  | "collect_preferred_window"
  | "lead_submitted"
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
  lastBookingId?: string;
  lastHandoffReason?: string;
}

export interface ChatSessionState {
  sessionId: string;
  stage: ChatStage;
  customer: Partial<CustomerRequest>;
  bookingStatus?: "collecting" | "ready_for_availability" | "offered" | "booked" | "handoff" | "lead_submitted";
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
  leadId?: string;
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

  if (config.openai.enabled && config.openai.apiKey) {
    const aiReply = await tryHandleChatMessageWithOpenAi(
      storage,
      config,
      bookSmartConfig,
      state,
      messageText,
      sessionId,
      now,
    );
    if (aiReply) {
      return aiReply;
    }
  }

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
      state.analytics.lastHandoffReason = "booking_fallback";
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
    state.analytics.lastHandoffReason = "human_requested";
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
    state.analytics.lastHandoffReason = "outside_service_area";
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
        state.analytics.lastHandoffReason = "urgent";
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
    state.analytics.lastHandoffReason = "urgent";
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
    toolName: "create_lead",
    toolCallSummary: `Submitting HCP lead for ${state.customer.requestedService}.`,
  });
  const lead = await createLeadTool(
    toCustomerRequest(state.customer),
    config,
    state.analytics.leadSource,
  );
  state.stage = "lead_submitted";
  state.bookingStatus = "lead_submitted";
  state.analytics.lastBookingId = lead.externalId;
  await storage.appendBookingEvent({
    conversationId: state.sessionId,
    bookingExternalId: lead.externalId,
    bookingStatus: lead.status,
    timestamp: now,
    metadata: {
      requestedWindow: state.customer.preferredWindow,
      requestedService: state.customer.requestedService,
      source: "lead_first_launch_flow",
    },
  });
  await recordStageOnce(storage, state, "lead_submitted", now, {
    leadId: lead.externalId,
  });
  return persistReply(
    storage,
    state,
    {
      success: true,
      sessionId,
      replyText: lead.presentation.replyText,
      stage: state.stage,
      leadId: lead.externalId,
    },
    now,
  );
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
      leadId: payload.leadId,
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
  return text.match(/\b\d{5}(?:-\d{4})?\b\s*$/)?.[0]?.slice(0, 5);
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

async function tryHandleChatMessageWithOpenAi(
  storage: StorageAdapter,
  config: AppConfig,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  state: ChatSessionState,
  messageText: string,
  sessionId: string,
  timestamp: number,
): Promise<ChatReplyPayload | undefined> {
  try {
    const tools = createOpenAiTools(storage, config, bookSmartConfig, state, messageText, timestamp);
    const result = await runOpenAiResponses({
      apiKey: config.openai.apiKey!,
      baseUrl: config.openai.baseUrl,
      model: config.openai.model,
      systemPrompt: buildBookSmartSystemPrompt(bookSmartConfig),
      inputText: buildOpenAiInput(state, messageText, bookSmartConfig),
      tools,
    });

    await recordMessage(storage, {
      conversationId: state.sessionId,
      direction: "tool",
      timestamp,
      toolName: "openai_decision_trace",
      toolCallSummary: summarizeOpenAiDecisionTrace(result.toolCalls),
      metadata: {
        model: config.openai.model,
        toolCalls: result.toolCalls,
        trace: result.trace,
        outputText: result.outputText,
      },
    });

    const enforcedReply = await enforceBookSmartGuards(storage, state, bookSmartConfig, sessionId, timestamp);
    if (enforcedReply) {
      return enforcedReply;
    }

    if (!result.outputText) {
      return undefined;
    }

    state.stage = deriveStageFromState(state);
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: result.outputText,
      stage: state.stage,
      options: state.stage === "offer_slots" ? state.lastOfferedOptions : undefined,
      bookingId: state.stage === "booked" ? state.analytics.lastBookingId : undefined,
      leadId: state.stage === "lead_submitted" ? state.analytics.lastBookingId : undefined,
      handoffRequired: state.stage === "human_handoff" ? true : undefined,
    }, timestamp);
  } catch (error) {
    console.warn("BookSmart OpenAI orchestration failed, falling back to deterministic flow.", error);
    return undefined;
  }
}

function createOpenAiTools(
  storage: StorageAdapter,
  config: AppConfig,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  state: ChatSessionState,
  messageText: string,
  timestamp: number,
): OpenAiFunctionTool[] {
  return [
    {
      name: "update_conversation_state",
      description: "Store structured customer details extracted from the latest message without guessing missing values.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          address: { type: "string" },
          zipCode: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          preferredWindow: {
            type: "string",
            enum: ["morning", "afternoon"],
          },
          notes: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const updates = readStateUpdateArgs(args);
        const applied = applyStructuredConversationUpdates(state, updates);

        if (applied.city) {
          await recordStageOnce(storage, state, "city_collected", timestamp, { city: state.customer.city });
        }
        if (applied.address || applied.zipCode) {
          await recordStageOnce(storage, state, "address_collected", timestamp, {
            zipCode: state.customer.zipCode,
          });
        }
        if (applied.firstName || applied.phone || applied.email) {
          await recordStageOnce(storage, state, "contact_collected", timestamp, {
            firstName: state.customer.firstName,
            phone: state.customer.phone,
            email: state.customer.email,
          });
        }

        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "update_conversation_state",
          toolCallSummary: `Stored structured conversation fields: ${Object.keys(applied).join(", ") || "none"}.`,
        });

        return {
          ok: true,
          applied,
          customer: state.customer,
          nextStage: deriveStageFromState(state),
        };
      },
    },
    {
      name: "check_service_area",
      description: "Validate whether a city is inside the configured service area.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Customer project city.",
          },
        },
        required: ["city"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const city = readStringArg(args, "city") ?? state.customer.city;
        if (city) {
          state.customer.city = city;
          await recordStageOnce(storage, state, "city_collected", timestamp, { city });
        }

        const decision = checkServiceArea(city, bookSmartConfig);
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "check_service_area",
          toolCallSummary: `Checked service area for ${city ?? "unknown city"}.`,
          metadata: {
            ok: decision.ok,
          },
        });
        return decision;
      },
    },
    {
      name: "classify_service_type",
      description: "Classify the customer's service need into a configured service type and detect urgency.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Customer text describing the electrical issue or project.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const text = readStringArg(args, "text") ?? messageText;
        const serviceMatch = classifyServiceType(text, bookSmartConfig);
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "classify_service_type",
          toolCallSummary: "Classifying service type from customer message.",
        });
        setServiceDetails(state, text, bookSmartConfig);
        await recordStageOnce(storage, state, "service_identified", timestamp, {
          serviceTypeId: serviceMatch.serviceType.id,
        });
        return {
          matched: serviceMatch.matched,
          serviceTypeId: serviceMatch.serviceType.id,
          displayName: serviceMatch.serviceType.displayName,
          category: serviceMatch.serviceType.category,
          urgency: state.urgency ?? "normal",
        };
      },
    },
    {
      name: "request_photo",
      description: "Check whether a photo should be requested for the current service type.",
      parameters: {
        type: "object",
        properties: {
          serviceTypeId: {
            type: "string",
            description: "Configured BookSmart service type id.",
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const serviceTypeId = readStringArg(args, "serviceTypeId") ?? state.serviceTypeId;
        const serviceType = getServiceTypeById(serviceTypeId, bookSmartConfig);
        if (!serviceType) {
          return {
            shouldRequestPhoto: false,
          };
        }

        const response = requestPhoto(serviceType);
        if (response.shouldRequestPhoto) {
          state.analytics.photoRequested = true;
          await recordStageOnce(storage, state, "photo_requested", timestamp, {
            serviceTypeId: serviceType.id,
          });
        }
        return response;
      },
    },
    {
      name: "find_or_create_customer",
      description: "Find or create the customer record in Housecall Pro using known contact details.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const customer = toCustomerRequest(state.customer);
        const result = await findOrCreateCustomerTool(customer, config);
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "find_or_create_customer",
          toolCallSummary: `Synced customer for ${customer.phone}.`,
        });
        return result;
      },
    },
    {
      name: "get_availability",
      description: "Check real availability in Housecall Pro using the current customer and job details.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "get_availability",
          toolCallSummary: `Checking live availability for ${state.customer.requestedService ?? "unknown service"}.`,
        });
        const availability = await getAvailabilityTool(toCustomerRequest(state.customer), config, bookSmartConfig);
        state.lastOfferedOptions = availability.presentation.options;

        if (availability.status === "slots_available" && availability.presentation.options?.length) {
          state.stage = "offer_slots";
          state.bookingStatus = "offered";
          await recordSlotExposureSet(storage, state, availability.presentation.options, timestamp);
          await recordStageOnce(storage, state, "availability_presented", timestamp, {
            slotCount: availability.presentation.options.length,
          });
        } else {
          state.stage = "human_handoff";
          state.bookingStatus = "handoff";
          state.analytics.lastHandoffReason = availability.status;
          await storage.appendHandoffEvent({
            conversationId: state.sessionId,
            reason: availability.status,
            timestamp,
          });
          await recordStageOnce(storage, state, "escalated", timestamp, {
            reason: availability.status,
          });
        }

        return {
          status: availability.status,
          replyText: availability.presentation.replyText,
          options: availability.presentation.options?.map((option) => ({
            slotOptionId: buildSlotOptionId(option),
            label: option.label,
            start: option.start,
            end: option.end,
            technician: option.technician,
          })),
        };
      },
    },
    {
      name: "resolve_slot_selection",
      description: "Resolve which previously offered slot the customer selected from ordinal or natural-language wording.",
      parameters: {
        type: "object",
        properties: {
          customerText: {
            type: "string",
            description: "The latest customer message about which slot they want.",
          },
          slotOptionId: {
            type: "string",
            description: "Optional explicit slot option id when the model already knows the chosen slot.",
          },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const explicitSlotOptionId = readStringArg(args, "slotOptionId");
        const customerText = readStringArg(args, "customerText") ?? messageText;
        const selectedOption = explicitSlotOptionId
          ? selectSlotById(explicitSlotOptionId, state.lastOfferedOptions)
          : matchOptionSelection(customerText, state.lastOfferedOptions ?? []);

        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "resolve_slot_selection",
          toolCallSummary: selectedOption
            ? `Resolved customer selection to ${selectedOption.label}.`
            : "Could not resolve customer slot selection.",
        });

        if (!selectedOption) {
          return {
            ok: false,
            error: "No matching offered slot could be resolved.",
            availableOptions: (state.lastOfferedOptions ?? []).map((option) => ({
              slotOptionId: buildSlotOptionId(option),
              label: option.label,
            })),
          };
        }

        return {
          ok: true,
          slotOptionId: buildSlotOptionId(selectedOption),
          label: selectedOption.label,
          start: selectedOption.start,
          end: selectedOption.end,
          technician: selectedOption.technician,
        };
      },
    },
    {
      name: "create_booking",
      description: "Book one of the previously offered live slots in Housecall Pro.",
      parameters: {
        type: "object",
        properties: {
          slotOptionId: {
            type: "string",
            description: "The slotOptionId of the offered slot to book.",
          },
        },
        required: ["slotOptionId"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const slotOptionId = readStringArg(args, "slotOptionId");
        const selectedOption = selectSlotById(slotOptionId, state.lastOfferedOptions);
        if (!selectedOption) {
          return {
            ok: false,
            error: "No matching slot was available to book.",
          };
        }

        await recordSlotSelection(storage, state, selectedOption, timestamp);
        await recordStageOnce(storage, state, "slot_selected", timestamp, {
          slotLabel: selectedOption.label,
        });
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
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
          state.analytics.lastBookingId = booking.externalId;
          await storage.appendBookingEvent({
            conversationId: state.sessionId,
            bookingExternalId: booking.externalId,
            finalHcpJobType: selectedOption.bookingTarget,
            bookingStatus: booking.status,
            timestamp,
            metadata: {
              slotLabel: selectedOption.label,
            },
          });
          await recordStageOnce(storage, state, "booked", timestamp, {
            bookingId: booking.externalId,
          });
        } else if (booking.presentation.options?.length) {
          state.lastOfferedOptions = booking.presentation.options;
          state.stage = "offer_slots";
          state.bookingStatus = "offered";
          await recordSlotExposureSet(storage, state, booking.presentation.options, timestamp);
          await recordStageOnce(storage, state, "availability_presented", timestamp, {
            slotCount: booking.presentation.options.length,
          });
        } else {
          state.stage = "human_handoff";
          state.bookingStatus = "handoff";
          state.analytics.lastHandoffReason = "booking_fallback";
          await storage.appendBookingEvent({
            conversationId: state.sessionId,
            finalHcpJobType: selectedOption.bookingTarget,
            bookingStatus: booking.status,
            timestamp,
          });
          await storage.appendHandoffEvent({
            conversationId: state.sessionId,
            reason: "booking_fallback",
            timestamp,
            metadata: {
              bookingStatus: booking.status,
            },
          });
          await recordStageOnce(storage, state, "escalated", timestamp, {
            reason: "booking_fallback",
          });
        }

        return {
          ok: booking.status === "booked",
          status: booking.status,
          bookingId: booking.externalId,
          replyText: booking.presentation.replyText,
          options: booking.presentation.options?.map((option) => ({
            slotOptionId: buildSlotOptionId(option),
            label: option.label,
          })),
        };
      },
    },
    {
      name: "handoff_to_human",
      description: "Escalate the conversation to a human operator when policy requires handoff.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            enum: ["urgent", "outside_service_area", "fallback"],
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const reason = normalizeHandoffReason(readStringArg(args, "reason"));
        state.stage = "human_handoff";
        state.bookingStatus = "handoff";
        if (reason === "urgent") {
          await persistUrgencyHits(storage, state, timestamp);
        }
        await storage.appendHandoffEvent({
          conversationId: state.sessionId,
          reason,
          timestamp,
          metadata: reason === "urgent" ? { keywords: state.analytics.urgencyKeywordsDetected } : undefined,
        });
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "handoff_to_human",
          toolCallSummary: `Escalating ${reason} request to a human.`,
        });
        await recordStageOnce(storage, state, "escalated", timestamp, {
          reason,
        });
        state.analytics.lastHandoffReason = reason;
        return handoffToHuman(reason);
      },
    },
  ];
}

async function enforceBookSmartGuards(
  storage: StorageAdapter,
  state: ChatSessionState,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  sessionId: string,
  timestamp: number,
): Promise<ChatReplyPayload | undefined> {
  if (state.urgency === "urgent" && state.bookingStatus !== "booked" && state.bookingStatus !== "handoff") {
    state.stage = "human_handoff";
    state.bookingStatus = "handoff";
    state.analytics.lastHandoffReason = "urgent";
    await persistUrgencyHits(storage, state, timestamp);
    await storage.appendHandoffEvent({
      conversationId: state.sessionId,
      reason: "urgent",
      timestamp,
      metadata: {
        keywords: state.analytics.urgencyKeywordsDetected,
      },
    });
    await recordStageOnce(storage, state, "escalated", timestamp, {
      reason: "urgent",
    });
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: "This sounds urgent, so I’m having our team review it right away instead of continuing with normal booking.",
      stage: state.stage,
      handoffRequired: true,
    }, timestamp);
  }

  if (state.customer.city && state.bookingStatus !== "booked" && state.bookingStatus !== "handoff") {
    const areaDecision = checkServiceArea(state.customer.city, bookSmartConfig);
    if (!areaDecision.ok) {
      state.stage = "human_handoff";
      state.bookingStatus = "handoff";
      state.analytics.lastHandoffReason = "outside_service_area";
      await storage.appendHandoffEvent({
        conversationId: state.sessionId,
        reason: "outside_service_area",
        timestamp,
        metadata: {
          city: state.customer.city,
        },
      });
      await recordStageOnce(storage, state, "escalated", timestamp, {
        reason: "outside_service_area",
      });
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "Thanks. That area needs a quick manual review from our team before we book it.",
        stage: state.stage,
        handoffRequired: true,
      }, timestamp);
    }
  }

  return undefined;
}

function buildOpenAiInput(
  state: ChatSessionState,
  latestMessage: string,
  config: typeof DEFAULT_BOOKSMART_CONFIG,
): string {
  const transcript = state.transcript.slice(-8).map((entry) => ({
    direction: entry.direction,
    text: entry.text,
  }));
  const availableSlots = (state.lastOfferedOptions ?? []).map((option) => ({
    slotOptionId: buildSlotOptionId(option),
    label: option.label,
    start: option.start,
    end: option.end,
    technician: option.technician,
  }));

  return JSON.stringify({
    latestCustomerMessage: latestMessage,
    stage: state.stage,
    missingFields: listMissingFields(state),
    bookingStatus: state.bookingStatus,
    customer: state.customer,
    serviceTypeId: state.serviceTypeId,
    urgency: state.urgency ?? "normal",
    availableSlots,
    transcript,
    bookingRules: config.bookingRules,
    conversationSettings: {
      openingQuestion: config.conversation.openingQuestion,
      handoffMessage: config.conversation.handoffMessage,
      requestPhotosFor: config.conversation.requestPhotosFor,
    },
  });
}

function deriveStageFromState(state: ChatSessionState): ChatStage {
  if (state.bookingStatus === "booked") {
    return "booked";
  }

  if (state.bookingStatus === "lead_submitted") {
    return "lead_submitted";
  }

  if (state.bookingStatus === "handoff") {
    return "human_handoff";
  }

  if (state.lastOfferedOptions?.length && state.bookingStatus === "offered") {
    return "offer_slots";
  }

  if (!state.customer.city) {
    return "collect_city";
  }

  if (!state.customer.requestedService) {
    return "collect_service_type";
  }

  if (!state.customer.address) {
    return "collect_address";
  }

  if (!state.customer.zipCode) {
    return "collect_zip";
  }

  if (!state.customer.firstName) {
    return "collect_name";
  }

  if (!state.customer.phone) {
    return "collect_phone";
  }

  if (!state.customer.preferredWindow) {
    return "collect_preferred_window";
  }

  return "collect_preferred_window";
}

function listMissingFields(state: ChatSessionState): string[] {
  const missing: string[] = [];
  if (!state.customer.city) {
    missing.push("city");
  }
  if (!state.customer.requestedService) {
    missing.push("service_type");
  }
  if (!state.customer.address) {
    missing.push("address");
  }
  if (!state.customer.zipCode) {
    missing.push("zip_code");
  }
  if (!state.customer.firstName) {
    missing.push("first_name");
  }
  if (!state.customer.phone) {
    missing.push("phone");
  }
  if (!state.customer.preferredWindow) {
    missing.push("preferred_window");
  }
  return missing;
}

function readStateUpdateArgs(args: unknown): Partial<CustomerRequest> {
  return {
    city: readStringArg(args, "city"),
    address: readStringArg(args, "address"),
    zipCode: readStringArg(args, "zipCode"),
    firstName: readStringArg(args, "firstName"),
    lastName: readStringArg(args, "lastName"),
    phone: normalizePhoneArg(readStringArg(args, "phone")),
    email: readStringArg(args, "email"),
    preferredWindow: readPreferredWindowArg(args, "preferredWindow"),
    notes: readStringArg(args, "notes"),
  };
}

function applyStructuredConversationUpdates(
  state: ChatSessionState,
  updates: Partial<CustomerRequest>,
): Record<string, unknown> {
  const applied: Record<string, unknown> = {};

  if (updates.city && updates.city !== state.customer.city) {
    state.customer.city = updates.city;
    applied.city = updates.city;
  }
  if (updates.address && updates.address !== state.customer.address) {
    state.customer.address = updates.address;
    applied.address = updates.address;
  }
  if (updates.zipCode && updates.zipCode !== state.customer.zipCode) {
    state.customer.zipCode = updates.zipCode;
    applied.zipCode = updates.zipCode;
  }
  if (updates.firstName && updates.firstName !== state.customer.firstName) {
    state.customer.firstName = updates.firstName;
    applied.firstName = updates.firstName;
  }
  if (updates.lastName && updates.lastName !== state.customer.lastName) {
    state.customer.lastName = updates.lastName;
    applied.lastName = updates.lastName;
  }
  if (updates.phone && updates.phone !== state.customer.phone) {
    state.customer.phone = updates.phone;
    applied.phone = updates.phone;
  }
  if (updates.email && updates.email !== state.customer.email) {
    state.customer.email = updates.email;
    applied.email = updates.email;
  }
  if (updates.preferredWindow && updates.preferredWindow !== state.customer.preferredWindow) {
    state.customer.preferredWindow = updates.preferredWindow;
    applied.preferredWindow = updates.preferredWindow;
  }
  if (updates.notes && updates.notes !== state.customer.notes) {
    state.customer.notes = updates.notes;
    applied.notes = updates.notes;
  }

  state.stage = deriveStageFromState(state);
  return applied;
}

function readStringArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPreferredWindowArg(
  args: unknown,
  key: string,
): "morning" | "afternoon" | undefined {
  const value = readStringArg(args, key);
  return value === "morning" || value === "afternoon" ? value : undefined;
}

function normalizePhoneArg(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return extractPhoneNumber(value) ?? value;
}

function selectSlotById(
  slotOptionId: string | undefined,
  options: PresentedSlotOption[] | undefined,
): PresentedSlotOption | undefined {
  if (!slotOptionId || !options?.length) {
    return undefined;
  }

  return options.find((option) => buildSlotOptionId(option) === slotOptionId);
}

function normalizeHandoffReason(
  value: string | undefined,
): "urgent" | "outside_service_area" | "fallback" {
  if (value === "urgent" || value === "outside_service_area") {
    return value;
  }
  return "fallback";
}

function summarizeOpenAiDecisionTrace(toolCalls: string[]): string {
  if (!toolCalls.length) {
    return "OpenAI responded without tool calls.";
  }

  return `OpenAI used tools: ${toolCalls.join(", ")}.`;
}
