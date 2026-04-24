import { DEFAULT_BOOKSMART_CONFIG } from "../booksmart/defaultConfig.js";
import { buildKnowledgePivot, findKnowledgeAnswer } from "../booksmart/knowledge.js";
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
import {
  buildBookSmartAnswerLayerKnowledgeContext,
  buildBookSmartAnswerLayerPrompt,
  buildBookSmartSystemPrompt,
} from "../prompts/booksmartSystemPrompt.js";
import { chatWebhookSchema } from "../schemas/chat.js";
import { StorageAdapter } from "../storage/types.js";
import {
  checkServiceArea,
  classifyServiceType,
  createBookingTool,
  createLeadTool,
  detectUrgency,
  getAvailabilityTool,
  getServiceTypeById,
  handoffToHuman,
  requestPhoto,
} from "../tools/booksmart.js";
import { OpenAiFunctionTool, runOpenAiResponses } from "./openaiResponses.js";
import { isValidServiceZip, lookupZip } from "../lib/zipLookup.js";
import { lookupCustomerByPhone } from "../integrations/housecallPro.js";

type ChatStage =
  | "collect_name"
  | "collect_service_type"
  | "collect_address"
  | "collect_zip"
  | "collect_phone"
  | "collect_email"
  | "collect_preferred_window"
  | "confirm_returning_address"
  | "ready_for_availability"
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
  isReturningCustomer?: boolean;
  hcpCustomerLookupTried?: boolean;
  /** After we send the “still at this address?” greeting (returning). */
  returningGreetingSent?: boolean;
  /** Awaiting same-address yes / no. */
  returningAddressAwaiting?: boolean;
  /** HCP prefill: address is still good (yes). */
  returningAddressConfirmed?: boolean;
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
  console.log("[PHONE DEBUG]", {
    customerPhone: normalized.customer?.phone,
    contactPhone: normalized.contact?.phone,
    sessionId: normalized.sessionId,
  });
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
  const phoneForLookup = normalized.customer?.phone ?? normalized.contact?.phone;
  const hcpLookup = phoneForLookup
    ? await lookupCustomerByPhone(phoneForLookup, config.hcp)
    : { found: false as const };

  const existing = await storage.getChatSession<ChatSessionState>(sessionId);
  const isBrandNewSession = !existing?.payload;
  const state = mergeState(existing?.payload, sessionId, normalized, messageText, now, leadSource);

  if (hcpLookup?.found && isBrandNewSession) {
    state.hcpCustomerLookupTried = true;
    state.isReturningCustomer = true;
    if (hcpLookup.firstName) {
      state.customer.firstName = hcpLookup.firstName;
    }
    if (hcpLookup.address) {
      state.customer.address = hcpLookup.address;
    }
    if (hcpLookup.city) {
      state.customer.city = hcpLookup.city;
    }
    if (hcpLookup.zipCode) {
      state.customer.zipCode = hcpLookup.zipCode;
    }
    if (hcpLookup.email) {
      state.customer.email = hcpLookup.email;
    }
    state.returningAddressAwaiting = true;
    state.stage = "confirm_returning_address";
  }

  if (isLeadOnlyLaunch(config)) {
    state.lastOfferedOptions = undefined;
    if (state.bookingStatus === "offered") {
      state.bookingStatus = "collecting";
    }
    if (state.stage === "offer_slots") {
      state.stage = deriveStageFromState(state);
    }
  }
  state.stage = deriveStageFromState(state);
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

  if (state.stage === "confirm_returning_address" && state.isReturningCustomer) {
    if (!state.returningGreetingSent) {
      state.returningGreetingSent = true;
      state.stage = "confirm_returning_address";
      const first = state.customer.firstName ?? "there";
      const addr = state.customer.address ?? "this address";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: `Hey ${first}! Great to hear from you. Are you still at ${addr}?`,
        stage: "confirm_returning_address",
      }, now);
    }
    if (isAffirmativeReply(messageText)) {
      state.returningAddressConfirmed = true;
      state.returningAddressAwaiting = false;
      state.stage = "collect_service_type";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "Perfect—what’s going on with the electrical today?",
        stage: state.stage,
      }, now);
    }
    if (isNegativeReply(messageText)) {
      state.customer.address = undefined;
      state.customer.city = undefined;
      state.customer.zipCode = undefined;
      state.returningAddressAwaiting = false;
      state.returningAddressConfirmed = false;
      state.stage = "collect_address";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "No problem—what’s the best street address and zip for this job?",
        stage: "collect_address",
      }, now);
    }
  }

  if (state.stage === "collect_name" && !state.customer.firstName) {
    if (isGreetingOnly(messageText) || isGenericHelpRequest(messageText)) {
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "hey—who am I speaking with? what’s your first name?",
        stage: "collect_name",
      }, now);
    }
    const urgentDuringName = detectUrgency(messageText, bookSmartConfig);
    if (urgentDuringName.urgent) {
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
          replyText: withHumanHandoffContact(
            personalizeReply(state, "that sounds urgent. pulling someone in now."),
            config,
          ),
          stage: state.stage,
          handoffRequired: true,
        }, now);
      }
    }
    const inferred = inferFirstName(messageText);
    state.customer.firstName = inferred;
    await recordStageOnce(storage, state, "contact_collected", now, { firstName: inferred });
    state.stage = "collect_service_type";
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: "thanks—what’s going on with the electrical today?",
      stage: "collect_service_type",
    }, now);
  }

  if (!isLeadOnlyLaunch(config) && state.stage === "offer_slots" && state.lastOfferedOptions?.length) {
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

  if (state.stage !== "offer_slots") {
    const guardReply = await enforceBookSmartGuards(storage, state, config, bookSmartConfig, sessionId, now);
    if (guardReply) {
      return guardReply;
    }
  }

  const shouldUseOpenAi = shouldUseOpenAiConversationFlow(config, bookSmartConfig, state, messageText);

  // If conversation is already in a completed state, don't re-enter OpenAI
  if (!isLeadOnlyLaunch(config) && (state.stage === "booked" || state.stage === "human_handoff") && !state.lastOfferedOptions?.length) {
    if (state.stage === "booked") {
      return persistReply(storage, state, { success: true, sessionId, replyText: "You're all set! Your appointment is confirmed.", stage: "booked" }, now);
    } else {
      return persistReply(storage, state, { success: true, sessionId, replyText: withHumanHandoffContact("I've connected you with our team. They'll be in touch soon.", config), stage: "human_handoff", handoffRequired: true }, now);
    }
  }

  if (shouldUseOpenAi) {
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

  const knowledgeReply = await maybeHandleKnowledgeReply(
    storage,
    state,
    messageText,
    bookSmartConfig,
    sessionId,
    now,
  );
  if (knowledgeReply) {
    return persistReply(storage, state, knowledgeReply, now);
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
      replyText: withHumanHandoffContact(bookSmartConfig.conversation.handoffMessage, config),
      stage: state.stage,
      handoffRequired: true,
    }, now);
  }

  if (!state.customer.requestedService && state.transcript.length <= 2) {
    if (isGreetingOnly(messageText)) {
      state.stage = "collect_service_type";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: bookSmartConfig.conversation.openingQuestion,
        stage: state.stage,
      }, now);
    }
    if (isGenericHelpRequest(messageText)) {
      state.stage = "collect_service_type";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: "got you. what’s going on?",
        stage: state.stage,
      }, now);
    }
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
        replyText: withHumanHandoffContact(
          personalizeReply(state, "that sounds urgent. pulling someone in now."),
          config,
        ),
        stage: state.stage,
        handoffRequired: true,
      }, now);
    }
    state.stage = "collect_address";
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: askForAddress(state),
      stage: state.stage,
    }, now);
  }

  if (!state.customer.requestedService) {
    if (state.stage === "collect_service_type") {
      if (isGreetingOnly(messageText)) {
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: bookSmartConfig.conversation.openingQuestion,
          stage: state.stage,
        }, now);
      }
      if (isGenericHelpRequest(messageText)) {
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: "got you. what’s going on?",
          stage: state.stage,
        }, now);
      }
      if (looksLikeKnowledgeQuestion(messageText)) {
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: fallbackForUnhandledQuestion(config),
          stage: state.stage,
        }, now);
      }
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
          replyText: withHumanHandoffContact(
            personalizeReply(state, "that sounds urgent. pulling someone in now."),
            config,
          ),
          stage: state.stage,
          handoffRequired: true,
        }, now);
      }

      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForAddress(state),
        stage: state.stage,
      }, now);
    } else {
      state.stage = "collect_service_type";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForServiceType(state),
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
      replyText: withHumanHandoffContact(
        personalizeReply(state, "that sounds urgent. pulling someone in now."),
        config,
      ),
      stage: state.stage,
      handoffRequired: true,
    }, now);
  }

  if (!state.customer.address) {
    if (state.stage === "collect_address") {
      if (isGreetingOnly(messageText)) {
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: askForAddress(state),
          stage: state.stage,
        }, now);
      }
      state.customer.address = messageText;
      state.customer.zipCode = state.customer.zipCode ?? extractZipCode(messageText);
      if (!state.customer.zipCode) {
        state.stage = "collect_zip";
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: askForZip(state),
          stage: state.stage,
        }, now);
      }
      const zipOutcome = await onZipCodeCollected(
        storage,
        state,
        config,
        sessionId,
        now,
        state.customer.zipCode,
      );
      if (zipOutcome) {
        return zipOutcome;
      }
      await recordStageOnce(storage, state, "address_collected", now, {
        zipCode: state.customer.zipCode,
        city: state.customer.city,
      });
      if (!state.customer.firstName) {
        state.stage = "collect_name";
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: askForFirstName(state),
          stage: state.stage,
        }, now);
      }
    } else {
      state.stage = "collect_address";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForAddress(state),
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
        replyText: askForZip(state),
        stage: state.stage,
      }, now);
    }
    const zipOutcome = await onZipCodeCollected(storage, state, config, sessionId, now, zip);
    if (zipOutcome) {
      return zipOutcome;
    }
    await recordStageOnce(storage, state, "address_collected", now, {
      zipCode: state.customer.zipCode,
      city: state.customer.city,
    });
    if (!state.customer.firstName) {
      state.stage = "collect_name";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForFirstName(state),
        stage: state.stage,
      }, now);
    }
  }

  if (!state.customer.firstName) {
    if (state.stage === "collect_name") {
      state.customer.firstName = inferFirstName(messageText);
      if (!state.customer.phone) {
        state.stage = "collect_phone";
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: askForPhone(state),
          stage: state.stage,
        }, now);
      }

      await recordStageOnce(storage, state, "contact_collected", now, {
        firstName: state.customer.firstName,
      });
      state.stage = "collect_email";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForEmail(state),
        stage: state.stage,
      }, now);
    } else {
      state.stage = "collect_name";
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForFirstName(state),
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
        replyText: askForPhone(state),
        stage: state.stage,
      }, now);
    }
    state.customer.phone = phone;
    await recordStageOnce(storage, state, "contact_collected", now, {
      phone,
    });
    state.stage = "collect_email";
    return persistReply(storage, state, {
      success: true,
      sessionId,
      replyText: askForEmail(state),
      stage: state.stage,
    }, now);
  }

  if (!state.customer.email) {
    state.stage = "collect_email";
    const email = extractEmailAddress(messageText);
    if (!email) {
      if (wantsToSkipEmail(messageText)) {
        state.stage = "collect_preferred_window";
        return persistReply(storage, state, {
          success: true,
          sessionId,
          replyText: askForPreferredWindow(state),
          stage: state.stage,
        }, now);
      }

      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: askForEmail(state),
        stage: state.stage,
      }, now);
    }

    state.customer.email = email;
    await recordStageOnce(storage, state, "contact_collected", now, {
      email,
    });
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
        ? `${askForPreferredWindow(state)} ${photoPrompt}`
        : askForPreferredWindow(state);
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText: reply,
        stage: state.stage,
      }, now);
    }
    state.customer.preferredWindow = preferredWindow;
  }
  const finalGuardReply = await enforceBookSmartGuards(storage, state, config, bookSmartConfig, sessionId, now);
  if (finalGuardReply) {
    return finalGuardReply;
  }
  return submitLeadFromState(storage, state, config, sessionId, now);
}

async function maybeHandleKnowledgeReply(
  storage: StorageAdapter,
  state: ChatSessionState,
  messageText: string,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  sessionId: string,
  timestamp: number,
): Promise<ChatReplyPayload | undefined> {
  if (state.bookingStatus === "handoff") {
    return undefined;
  }

  if (detectUrgency(messageText, bookSmartConfig).urgent) {
    return undefined;
  }

  if (!looksLikeKnowledgeQuestion(messageText)) {
    return undefined;
  }

  const match = findKnowledgeAnswer(messageText);
  if (!match) {
    return undefined;
  }

  if (match.serviceSignal && !state.customer.requestedService) {
    const classified = classifyServiceType(messageText, bookSmartConfig);
    if (classified.matched) {
      setServiceDetails(state, messageText, bookSmartConfig);
      await recordStageOnce(storage, state, "service_identified", timestamp, {
        serviceTypeId: state.serviceTypeId,
      });
    }
  }

  const followUp = match.suppressAutoPivot
    ? undefined
    : match.pivotOverride ?? buildNextBookingPrompt(state);
  const replyText = followUp ? `${match.answer} ${followUp}` : match.answer;

  await recordMessage(storage, {
    conversationId: state.sessionId,
    direction: "tool",
    timestamp,
    toolName: "knowledge_answer",
    toolCallSummary: "Answered an approved customer question and guided the conversation back to booking.",
    metadata: {
      answer: match.answer,
      followUp,
    },
  });

  return {
    success: true,
    sessionId,
    replyText,
    stage: deriveStageFromState(state),
  };
}

async function maybeHandleOpenAiAnswerLayer(
  storage: StorageAdapter,
  config: AppConfig,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  state: ChatSessionState,
  messageText: string,
  sessionId: string,
  timestamp: number,
): Promise<ChatReplyPayload | undefined> {
  if (!shouldUseOpenAiAnswerLayer(config, bookSmartConfig, state, messageText)) {
    return undefined;
  }

  try {
    const result = await runOpenAiResponses({
      apiKey: config.openai.apiKey!,
      baseUrl: config.openai.baseUrl,
      model: config.openai.model,
      systemPrompt: buildBookSmartAnswerLayerPrompt(bookSmartConfig),
      inputText: buildOpenAiAnswerLayerInput(state, messageText, config),
    });

    if (!result.outputText) {
      return undefined;
    }

    await recordMessage(storage, {
      conversationId: state.sessionId,
      direction: "tool",
      timestamp,
      toolName: "openai_answer_layer",
      toolCallSummary: "Answered a freeform customer question with booking guard rails.",
      metadata: {
        model: config.openai.model,
        trace: result.trace,
        outputText: result.outputText,
      },
    });

    return persistReply(
      storage,
      state,
      {
        success: true,
        sessionId,
        replyText: result.outputText,
        stage: deriveStageFromState(state),
      },
      timestamp,
    );
  } catch (error) {
    console.warn("BookSmart OpenAI answer layer failed, falling back to deterministic knowledge.", error);
    return undefined;
  }
}

function mergeState(
  current: ChatSessionState | undefined,
  sessionId: string,
  normalized: ReturnType<typeof normalizeBlooioInboundPayload>,
  messageText: string,
  timestamp: number,
  leadSource: LeadSourceCode,
): ChatSessionState {
  const baseState = current && shouldReuseExistingSession(current, messageText)
    ? current
    : undefined;

  const next: ChatSessionState = baseState ?? {
    sessionId,
    stage: "collect_name",
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

function shouldReuseExistingSession(state: ChatSessionState, messageText: string): boolean {
  if (!isTerminalSessionState(state) && !isAwaitingSlotSelection(state)) {
    return true;
  }

  return !looksLikeFreshConversationStart(messageText);
}

/** Slots were offered but the customer has not booked yet — allow the same "fresh start" reset as a submitted lead. */
function isAwaitingSlotSelection(state: ChatSessionState): boolean {
  return state.stage === "offer_slots" && (state.lastOfferedOptions?.length ?? 0) > 0;
}

function isTerminalSessionState(state: ChatSessionState): boolean {
  return (
    state.bookingStatus === "lead_submitted" ||
    state.bookingStatus === "handoff" ||
    state.bookingStatus === "booked"
  );
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
    bookSmartQualifiers: customer.bookSmartQualifiers,
    recessedSlotBlocks: customer.recessedSlotBlocks,
  };
}

/** If zip is not in the Macomb/Oakland list, we stop booking and (when possible) submit a real lead. */
async function onZipCodeCollected(
  storage: StorageAdapter,
  state: ChatSessionState,
  config: AppConfig,
  sessionId: string,
  now: number,
  rawZip: string,
): Promise<ChatReplyPayload | undefined> {
  const digits = rawZip.replace(/\D/g, "");
  if (digits.length < 5) {
    return undefined;
  }
  const z = digits.slice(0, 5);
  state.customer.zipCode = z;
  const loc = lookupZip(z);
  if (loc) {
    state.customer.city = loc.city;
    return undefined;
  }
  state.bookingStatus = "lead_submitted";
  if (state.customer.phone) {
    return submitLeadFromState(
      storage,
      state,
      config,
      sessionId,
      now,
      "We currently service Macomb and Oakland Counties. I've passed your info to our team in case we can help.",
    );
  }
  state.stage = "lead_submitted";
  return persistReply(
    storage,
    state,
    {
      success: true,
      sessionId,
      replyText:
        "We currently service Macomb and Oakland Counties. I've passed your info to our team in case we can help.",
      stage: "lead_submitted",
    },
    now,
  );
}

async function submitLeadFromState(
  storage: StorageAdapter,
  state: ChatSessionState,
  config: AppConfig,
  sessionId: string,
  timestamp: number,
  replyTextOverride?: string,
): Promise<ChatReplyPayload> {
  await recordMessage(storage, {
    conversationId: state.sessionId,
    direction: "tool",
    timestamp,
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
    timestamp,
    metadata: {
      requestedWindow: state.customer.preferredWindow,
      requestedService: state.customer.requestedService,
      source: "lead_first_launch_flow",
    },
  });
  await recordStageOnce(storage, state, "lead_submitted", timestamp, {
    leadId: lead.externalId,
  });
  return persistReply(
    storage,
    state,
    {
      success: true,
      sessionId,
      replyText: replyTextOverride ?? lead.presentation.replyText,
      stage: state.stage,
      leadId: lead.externalId,
    },
    timestamp,
  );
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
  const m = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : undefined;
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
  if (/\b(morning|mornings|am|earlier|first half)\b/.test(normalized)) {
    return "morning";
  }
  if (/\b(afternoon|afternoons|pm|later|second half)\b/.test(normalized)) {
    return "afternoon";
  }
  return undefined;
}

function looksLikeAddressInput(text: string): boolean {
  return /\b\d{1,6}\s+[a-z0-9.'-]+(?:\s+[a-z0-9.'-]+){0,4}\b/i.test(text.trim());
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
  const tools: OpenAiFunctionTool[] = [
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
            city: state.customer.city,
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
      description: "Validate whether a ZIP is inside the Macomb/Oakland service area (by zip).",
      parameters: {
        type: "object",
        properties: {
          zipCode: {
            type: "string",
            description: "5-digit or ZIP+4 customer project ZIP.",
          },
        },
        required: ["zipCode"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const rawZip = readStringArg(args, "zipCode") ?? state.customer.zipCode;
        if (rawZip) {
          const digits = rawZip.replace(/\D/g, "");
          if (digits.length >= 5) {
            const z5 = digits.slice(0, 5);
            state.customer.zipCode = z5;
            const loc = lookupZip(z5);
            if (loc) {
              state.customer.city = loc.city;
            }
            await recordStageOnce(storage, state, "address_collected", timestamp, {
              zipCode: z5,
              city: state.customer.city,
            });
          }
        }

        const decision = checkServiceArea(state.customer.zipCode, bookSmartConfig);
        await recordMessage(storage, {
          conversationId: state.sessionId,
          direction: "tool",
          timestamp,
          toolName: "check_service_area",
          toolCallSummary: `Checked service area for ZIP ${state.customer.zipCode ?? "unknown"}.`,
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

  return tools;
}

async function enforceBookSmartGuards(
  storage: StorageAdapter,
  state: ChatSessionState,
  config: AppConfig,
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
      replyText: withHumanHandoffContact(
        personalizeReply(state, "that sounds urgent. pulling someone in now."),
        config,
      ),
      stage: state.stage,
      handoffRequired: true,
    }, timestamp);
  }

  if (state.customer.zipCode && state.bookingStatus !== "booked" && state.bookingStatus !== "handoff") {
    const areaDecision = checkServiceArea(state.customer.zipCode, bookSmartConfig);
    if (!areaDecision.ok) {
      state.stage = "human_handoff";
      state.bookingStatus = "handoff";
      state.analytics.lastHandoffReason = "outside_service_area";
      await storage.appendHandoffEvent({
        conversationId: state.sessionId,
        reason: "outside_service_area",
        timestamp,
        metadata: {
          zipCode: state.customer.zipCode,
        },
      });
      await recordStageOnce(storage, state, "escalated", timestamp, {
        reason: "outside_service_area",
      });
      return persistReply(
        storage,
        state,
        {
          success: true,
          sessionId,
          replyText: withHumanHandoffContact(
            personalizeReply(state, "got it. need to check that area first."),
            config,
          ),
          stage: state.stage,
          handoffRequired: true,
        },
        timestamp,
      );
    }
  }

  if (isLeadOnlyLaunch(config) && shouldSubmitLead(state)) {
    if (!config.booking.hcpServiceLineId && !config.booking.hcpServiceLineName) {
      // Can't book in HCP without a service line — treat as a lead
      return submitLeadFromState(storage, state, config, sessionId, timestamp);
    }
    // Has service line config — can attempt booking flow, fall through
    return undefined;
  }

  if (
    shouldSubmitLead(state) &&
    state.bookingStatus !== "offered" &&
    state.bookingStatus !== "booked" &&
    state.bookingStatus !== "handoff" &&
    state.bookingStatus !== "lead_submitted"
  ) {
    const customerRequest = toCustomerRequest(state.customer);
    const availability = await getAvailabilityTool(customerRequest, config, bookSmartConfig);

    if (availability.status === "slots_available" && availability.slots.length > 0) {
      const options: PresentedSlotOption[] = availability.slots.map((slot) => ({
        label: slot.label,
        start: slot.start,
        end: slot.end,
        technician: slot.technician,
        bookingTarget: slot.bookingTarget,
      }));
      state.lastOfferedOptions = options;
      state.stage = "offer_slots";
      state.bookingStatus = "offered";
      state.analytics.slotsShownCount += options.length;
      await recordSlotExposureSet(storage, state, options, timestamp);
      await recordStageOnce(storage, state, "availability_presented", timestamp, { slotCount: options.length });
      const slotList = options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
      const replyText = `Here are our next available times:\n${slotList}\n\nReply with 1, 2, or 3 to confirm your appointment.`;
      return persistReply(storage, state, {
        success: true,
        sessionId,
        replyText,
        stage: state.stage,
        options,
      }, timestamp);
    }

    if (availability.status === "no_availability") {
      const maxDays = config.scheduling.maxLookaheadTotalDays;
      state.bookingStatus = "lead_submitted";
      return submitLeadFromState(
        storage,
        state,
        config,
        sessionId,
        timestamp,
        `We don't have any openings in the next ${maxDays} days that match your request — that's unusual for us. I've passed your info to our team and they'll reach out within one business day to get you scheduled.`,
      );
    }

    // No bookable slots: set before submit so downstream logic (e.g. OpenAI on the same turn) sees a terminal lead state
    if (availability.status !== "slots_available" || availability.slots.length === 0) {
      state.bookingStatus = "lead_submitted";
    }

    return submitLeadFromState(storage, state, config, sessionId, timestamp);
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
    approvedKnowledge: buildBookSmartAnswerLayerKnowledgeContext(),
    bookingRules: config.bookingRules,
    conversationSettings: {
      openingQuestion: config.conversation.openingQuestion,
      handoffMessage: config.conversation.handoffMessage,
      requestPhotosFor: config.conversation.requestPhotosFor,
    },
  });
}

function buildOpenAiAnswerLayerInput(
  state: ChatSessionState,
  latestMessage: string,
  config: AppConfig,
): string {
  const transcript = state.transcript.slice(-8).map((entry) => ({
    direction: entry.direction,
    text: entry.text,
  }));

  return JSON.stringify({
    latestCustomerMessage: latestMessage,
    stage: state.stage,
    bookingStatus: state.bookingStatus,
    missingFields: listMissingFields(state),
    customer: state.customer,
    nextBookingPrompt: buildNextBookingPrompt(state),
    fallbackUnknownAnswer: fallbackForUnhandledQuestion(config),
    approvedKnowledge: buildBookSmartAnswerLayerKnowledgeContext(),
    transcript,
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

  if (state.isReturningCustomer && state.returningAddressAwaiting && !state.returningAddressConfirmed) {
    return "confirm_returning_address";
  }

  if (!state.customer.firstName) {
    return "collect_name";
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

  if (!state.customer.phone) {
    return "collect_phone";
  }

  if (!state.customer.email) {
    return "collect_email";
  }

  if (!state.customer.preferredWindow) {
    return "collect_preferred_window";
  }

  return "ready_for_availability";
}

function listMissingFields(state: ChatSessionState): string[] {
  const missing: string[] = [];
  if (!state.customer.firstName) {
    missing.push("first_name");
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
  if (!state.customer.phone) {
    missing.push("phone");
  }
  if (!state.customer.email) {
    missing.push("email");
  }
  if (!state.customer.preferredWindow) {
    missing.push("preferred_window");
  }
  return missing;
}

function shouldSubmitLead(state: ChatSessionState): boolean {
  return Boolean(
    isValidServiceZip(state.customer.zipCode ?? "") &&
    state.customer.requestedService &&
    state.customer.address &&
    state.customer.zipCode &&
    state.customer.firstName &&
    state.customer.phone &&
    state.customer.email &&
    state.customer.preferredWindow &&
    state.bookingStatus !== "lead_submitted" &&
    state.bookingStatus !== "handoff",
  );
}

function isLeadOnlyLaunch(config: AppConfig): boolean {
  return config.leadOnlyLaunch;
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
    const digits = updates.zipCode.replace(/\D/g, "");
    if (digits.length >= 5) {
      const z5 = digits.slice(0, 5);
      state.customer.zipCode = z5;
      applied.zipCode = z5;
      const loc = lookupZip(z5);
      if (loc) {
        state.customer.city = loc.city;
      }
    } else {
      state.customer.zipCode = updates.zipCode.trim();
      applied.zipCode = updates.zipCode.trim();
    }
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

function shouldUseOpenAiAnswerLayer(
  config: AppConfig,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  state: ChatSessionState,
  messageText: string,
): boolean {
  if (!config.openai.enabled || !config.openai.apiKey) {
    return false;
  }

  if (state.bookingStatus === "handoff") {
    return false;
  }

  if (detectUrgency(messageText, bookSmartConfig).urgent) {
    return false;
  }

  if (looksLikeStructuredReplyForCurrentStage(state, messageText, bookSmartConfig)) {
    return false;
  }

  if (!looksLikeOpenAiAnswerLayerMessage(state, messageText, bookSmartConfig)) {
    return false;
  }

  return true;
}

function shouldUseOpenAiConversationFlow(
  config: AppConfig,
  bookSmartConfig: typeof DEFAULT_BOOKSMART_CONFIG,
  state: ChatSessionState,
  messageText: string,
): boolean {
  if (!config.openai.enabled || !config.openai.apiKey) {
    return false;
  }

  if (state.bookingStatus === "handoff") {
    return false;
  }

  if (detectUrgency(messageText, bookSmartConfig).urgent) {
    return false;
  }

  if (looksLikeStructuredReplyForCurrentStage(state, messageText, bookSmartConfig)) {
    return false;
  }

  return true;
}

function shouldUseOpenAiStructuredFlow(
  state: ChatSessionState,
  messageText: string,
): boolean {
  return (
    state.stage === "collect_preferred_window" ||
    state.stage === "offer_slots" ||
    Boolean(extractEmailAddress(messageText)) ||
    Boolean(extractPhoneNumber(messageText)) ||
    Boolean(looksLikeAddressInput(messageText)) ||
    Boolean(extractZipCode(messageText)) ||
    Boolean(inferPreferredWindow(messageText))
  );
}

function withHumanHandoffContact(replyText: string, config: AppConfig): string {
  const phone = config.contact.humanHandoffPhone;
  if (!phone) {
    return replyText;
  }

  return `${replyText} You can call or text ${phone} now if you’d rather talk to a person.`;
}

function personalizeReply(state: ChatSessionState, message: string): string {
  return message;
}

function askForServiceType(state: ChatSessionState): string {
  return personalizeReply(state, "what’s going on?");
}

function askForAddress(state: ChatSessionState): string {
  return personalizeReply(state, "address?");
}

function askForZip(state: ChatSessionState): string {
  return personalizeReply(state, "zip?");
}

function askForFirstName(state: ChatSessionState): string {
  return "name?";
}

function askForPhone(state: ChatSessionState): string {
  return personalizeReply(state, "best #?");
}

function askForEmail(state: ChatSessionState): string {
  return personalizeReply(state, "email?");
}

function askForPreferredWindow(state: ChatSessionState): string {
  return personalizeReply(state, "morning or afternoon?");
}

function fallbackForUnhandledQuestion(config: AppConfig): string {
  const phone = config.contact.humanHandoffPhone;
  if (phone) {
    return `not totally sure on that one over text. if you want, call ${phone} and we can handle it there.`;
  }

  return "not totally sure on that one over text.";
}

function looksLikeOpenAiAnswerLayerMessage(
  state: ChatSessionState,
  text: string,
  config: typeof DEFAULT_BOOKSMART_CONFIG,
): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    isGreetingOnly(normalized) ||
    isGenericHelpRequest(normalized) ||
    looksLikeKnowledgeQuestion(normalized) ||
    looksLikeConversationPushback(normalized) ||
    (!state.customer.requestedService && !classifyServiceType(normalized, config).matched) ||
    /\b(talk to a person|call me|call instead|text instead|have some questions first|ask away)\b/.test(normalized) ||
    /\b(i have some questions|can i ask|before i book|before i schedule)\b/.test(normalized)
  );
}

function looksLikeConversationPushback(text: string): boolean {
  return /\b(i already told you|already gave you|you already asked|didn'?t i already|i just told you|you forgot|that doesn'?t make sense)\b/.test(text);
}

function looksLikeStructuredReplyForCurrentStage(
  state: ChatSessionState,
  text: string,
  config: typeof DEFAULT_BOOKSMART_CONFIG,
): boolean {
  switch (deriveStageFromState(state)) {
    case "collect_service_type":
      return classifyServiceType(text, config).matched;
    case "collect_address":
      return looksLikeAddressInput(text);
    case "collect_zip":
      return Boolean(extractZipCode(text));
    case "collect_name":
      return looksLikeNameInput(text);
    case "collect_phone":
      return Boolean(extractPhoneNumber(text));
    case "collect_email":
      return Boolean(extractEmailAddress(text) || wantsToSkipEmail(text));
    case "collect_preferred_window":
      return Boolean(inferPreferredWindow(text));
    default:
      return false;
  }
}

function looksLikeNameInput(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (
    normalized.includes("?") ||
    Boolean(extractEmailAddress(normalized)) ||
    Boolean(extractPhoneNumber(normalized)) ||
    Boolean(extractZipCode(normalized)) ||
    looksLikeAddressInput(normalized)
  ) {
    return false;
  }

  const cleaned = normalized.replace(/[^a-zA-Z\s'-]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3 && words.every((word) => /^[a-zA-Z'-]+$/.test(word));
}

function isAffirmativeReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(y|yes|yeah|yep|yup|correct|still|same|👍)\b/i.test(t) ||
    /\b(still here|same place|same address|that'?s right|sounds right)\b/i.test(t)
  );
}

function isNegativeReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(n|no|nope|nah|moved)\b/i.test(t) ||
    /\b(new address|different address|not there|not anymore|new place)\b/i.test(t)
  );
}

function isGreetingOnly(text: string): boolean {
  return /^(hi|hi there|hey|hey there|hello|hello there|yo|good morning|good afternoon|good evening|sup|what'?s up)\b[!. ]*$/i.test(
    text.trim(),
  );
}

function isGenericHelpRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    /\b(i need|need|looking for|want|would like|i'?d like|need help|help with)\b/.test(normalized) &&
    /\b(electrician|electrical|electric|someone out|service)\b/.test(normalized) &&
    !/\b(panel|breaker|outlet|switch|lights?|lighting|recessed|charger|ev|generator|interlock|fan|fixture|smoke|co detector|surge|subpanel|rewire|remodel|mast|meter|burning|sparks?|arcing|hot panel)\b/.test(normalized)
  );
}

function looksLikeKnowledgeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return (
    normalized.includes("?") ||
    /\b(ask some questions first|have some questions first|questions first|ask a question|ask some questions)\b/.test(normalized) ||
    /^(do|does|did|can|are|is|how|what|when|will|would|should|could)\b/.test(normalized)
  );
}

function looksLikeFreshConversationStart(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    isGreetingOnly(normalized) ||
    isGenericHelpRequest(normalized) ||
    /\b(new issue|another issue|different issue|new job|another job|need an electrician|need electrical help|need some electrical help)\b/.test(normalized) ||
    classifyServiceType(normalized, DEFAULT_BOOKSMART_CONFIG).matched
  );
}

function buildNextBookingPrompt(state: ChatSessionState): string {
  if (state.bookingStatus === "lead_submitted") {
    return "anything else you want me to add?";
  }
  if (!state.customer.requestedService) {
    return askForServiceType(state);
  }
  if (!state.customer.address) {
    return askForAddress(state);
  }
  if (!state.customer.zipCode) {
    return askForZip(state);
  }
  if (!state.customer.firstName) {
    return askForFirstName(state);
  }
  if (!state.customer.phone) {
    return askForPhone(state);
  }
  if (!state.customer.email) {
    return askForEmail(state);
  }
  if (!state.customer.preferredWindow) {
    return askForPreferredWindow(state);
  }
  return buildKnowledgePivot();
}

function extractEmailAddress(text: string): string | undefined {
  const match = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match?.[0]?.toLowerCase();
}

function wantsToSkipEmail(text: string): boolean {
  return /\b(skip|no email|dont have email|don't have email|no thanks|rather not)\b/i.test(text);
}
