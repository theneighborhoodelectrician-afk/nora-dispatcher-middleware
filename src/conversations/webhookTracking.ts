import { normalizeLeadSource, defaultLeadSourceRecord } from "./tracking.js";
import { StorageAdapter } from "../storage/types.js";
import { CandidateSlot, CustomerRequest } from "../domain/types.js";
import { BookingResponsePayload, AvailabilityResponsePayload } from "../domain/types.js";
import { detectUrgency } from "../tools/booksmart.js";

export async function trackAvailabilityRequest(input: {
  storage: StorageAdapter;
  conversationId: string;
  leadSource?: string;
  request: CustomerRequest;
  response: AvailabilityResponsePayload;
  timestamp: number;
}): Promise<void> {
  const leadSource = normalizeLeadSource(input.leadSource);
  const urgency = detectUrgency([input.request.requestedService, input.request.notes].filter(Boolean).join(" "));

  await input.storage.upsertLeadSource(defaultLeadSourceRecord(leadSource));
  await input.storage.upsertContact({
    contactId: input.request.phone,
    phone: input.request.phone,
    firstName: input.request.firstName,
    lastName: input.request.lastName,
    email: input.request.email,
    address: input.request.address,
    city: input.request.city,
    zipCode: input.request.zipCode,
    updatedAt: input.timestamp,
  });
  await input.storage.upsertConversation({
    conversationId: input.conversationId,
    contactId: input.request.phone,
    leadSource,
    timestampStarted: input.timestamp,
    timestampLastMessage: input.timestamp,
    currentStage: input.response.status === "slots_available" ? "availability_presented" : "escalated",
  });
  await input.storage.upsertConversationOutcome({
    conversationId: input.conversationId,
    leadSource,
    timestampStarted: input.timestamp,
    timestampLastMessage: input.timestamp,
    firstCustomerMessage: input.request.requestedService,
    classifiedServiceType: input.response.service.category,
    urgencyLevel: urgency.urgent ? "urgent" : "normal",
    urgencyKeywordsDetected: urgency.matchedKeyword ? [urgency.matchedKeyword] : [],
    addressCollected: Boolean(input.request.address && input.request.zipCode),
    phoneCollected: Boolean(input.request.phone),
    emailCollected: Boolean(input.request.email),
    photoSent: false,
    availabilityShown: input.response.status === "slots_available",
    slotsShownCount: input.response.presentation.options?.length ?? 0,
    slotSelected: false,
    bookedYesNo: false,
    handoffYesNo: input.response.status !== "slots_available",
    abandonmentStage: undefined,
    finalHcpJobType: input.response.service.target,
    finalBookingStatus: input.response.status,
    systemSummary:
      input.response.status === "slots_available"
        ? `Availability shown for ${input.response.service.title}.`
        : `Escalated during availability for ${input.response.service.title}.`,
  });
  await input.storage.appendConversationStage({
    conversationId: input.conversationId,
    stage: "started",
    timestamp: input.timestamp,
    metadata: { channel: "webhook_availability" },
  });
  await input.storage.appendConversationStage({
    conversationId: input.conversationId,
    stage: "service_identified",
    timestamp: input.timestamp,
    metadata: { serviceCategory: input.response.service.category },
  });
  if (input.request.address || input.request.zipCode) {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "address_collected",
      timestamp: input.timestamp,
      metadata: { zipCode: input.request.zipCode },
    });
  }
  if (input.request.phone || input.request.email) {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "contact_collected",
      timestamp: input.timestamp,
      metadata: { phone: Boolean(input.request.phone), email: Boolean(input.request.email) },
    });
  }
  await input.storage.appendConversationMessage({
    conversationId: input.conversationId,
    direction: "inbound",
    text: input.request.requestedService,
    timestamp: input.timestamp,
    metadata: {
      kind: "availability_request",
      phone: input.request.phone,
    },
  });
  await input.storage.appendConversationMessage({
    conversationId: input.conversationId,
    direction: "tool",
    toolName: "get_availability",
    toolCallSummary: `Checked real availability for ${input.response.service.title}.`,
    timestamp: input.timestamp,
  });

  if (urgency.matchedKeyword) {
    await input.storage.appendUrgencyKeywordHit({
      conversationId: input.conversationId,
      keywordDetected: urgency.matchedKeyword,
      mappedUrgencyLevel: "urgent",
      timestamp: input.timestamp,
    });
  }

  if (input.response.presentation.options?.length) {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "availability_presented",
      timestamp: input.timestamp,
      metadata: { slotCount: input.response.presentation.options.length },
    });
    for (const [index, option] of input.response.presentation.options.entries()) {
      await input.storage.upsertSlotExposure({
        conversationId: input.conversationId,
        slotOptionId: buildWebhookSlotId(option.start, option.end, option.technician, option.bookingTarget),
        slotLabel: option.label,
        slotStart: option.start,
        slotEnd: option.end,
        slotOrderPresented: index + 1,
        selectedYesNo: false,
        timestamp: input.timestamp,
      });
    }
  } else {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "escalated",
      timestamp: input.timestamp,
      metadata: { reason: input.response.escalationReason ?? input.response.status },
    });
    await input.storage.appendHandoffEvent({
      conversationId: input.conversationId,
      reason: input.response.escalationReason ?? input.response.status,
      timestamp: input.timestamp,
    });
  }
}

export async function trackBookingRequest(input: {
  storage: StorageAdapter;
  conversationId: string;
  leadSource?: string;
  request: CustomerRequest;
  selectedSlot: CandidateSlot;
  response: BookingResponsePayload;
  timestamp: number;
}): Promise<void> {
  const leadSource = normalizeLeadSource(input.leadSource);
  await input.storage.upsertLeadSource(defaultLeadSourceRecord(leadSource));
  await input.storage.upsertContact({
    contactId: input.request.phone,
    phone: input.request.phone,
    firstName: input.request.firstName,
    lastName: input.request.lastName,
    email: input.request.email,
    address: input.request.address,
    city: input.request.city,
    zipCode: input.request.zipCode,
    updatedAt: input.timestamp,
  });
  await input.storage.upsertConversation({
    conversationId: input.conversationId,
    contactId: input.request.phone,
    leadSource,
    timestampStarted: input.timestamp,
    timestampLastMessage: input.timestamp,
    currentStage: input.response.status === "booked" ? "booked" : input.response.status === "slot_unavailable" ? "availability_presented" : "escalated",
  });
  const previous = await input.storage.getConversationOutcome(input.conversationId);
  await input.storage.upsertConversationOutcome({
    conversationId: input.conversationId,
    leadSource,
    timestampStarted: previous?.timestampStarted ?? input.timestamp,
    timestampLastMessage: input.timestamp,
    firstCustomerMessage: previous?.firstCustomerMessage ?? input.request.requestedService,
    classifiedServiceType: previous?.classifiedServiceType ?? input.request.requestedService,
    urgencyLevel: previous?.urgencyLevel ?? "normal",
    urgencyKeywordsDetected: previous?.urgencyKeywordsDetected ?? [],
    addressCollected: Boolean(input.request.address && input.request.zipCode),
    phoneCollected: Boolean(input.request.phone),
    emailCollected: Boolean(input.request.email),
    photoSent: previous?.photoSent ?? false,
    availabilityShown: true,
    slotsShownCount: previous?.slotsShownCount ?? 1,
    slotSelected: true,
    bookedYesNo: input.response.status === "booked",
    handoffYesNo: input.response.status === "human_escalation_required",
    abandonmentStage: undefined,
    finalHcpJobType: input.response.bookingTarget,
    finalBookingStatus: input.response.status,
    systemSummary:
      input.response.status === "booked"
        ? `Booked ${input.response.bookingTarget} from webhook flow.`
        : `Booking webhook ended with ${input.response.status}.`,
  });
  await input.storage.appendConversationStage({
    conversationId: input.conversationId,
    stage: "slot_selected",
    timestamp: input.timestamp,
    metadata: { slotLabel: input.selectedSlot.label },
  });
  await input.storage.upsertSlotExposure({
    conversationId: input.conversationId,
    slotOptionId: buildWebhookSlotId(
      input.selectedSlot.start,
      input.selectedSlot.end,
      input.selectedSlot.technician,
      input.selectedSlot.bookingTarget,
    ),
    slotLabel: input.selectedSlot.label,
    slotStart: input.selectedSlot.start,
    slotEnd: input.selectedSlot.end,
    slotOrderPresented: 1,
    selectedYesNo: true,
    timestamp: input.timestamp,
  });
  await input.storage.appendConversationMessage({
    conversationId: input.conversationId,
    direction: "tool",
    toolName: "create_booking",
    toolCallSummary: `Processed booking for ${input.selectedSlot.label}.`,
    timestamp: input.timestamp,
  });
  await input.storage.appendBookingEvent({
    conversationId: input.conversationId,
    bookingExternalId: input.response.externalId,
    finalHcpJobType: input.response.bookingTarget,
    bookingStatus: input.response.status,
    timestamp: input.timestamp,
  });

  if (input.response.status === "booked") {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "booked",
      timestamp: input.timestamp,
      metadata: { bookingId: input.response.externalId },
    });
  } else if (input.response.status === "slot_unavailable" && input.response.presentation.options?.length) {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "availability_presented",
      timestamp: input.timestamp,
      metadata: { slotCount: input.response.presentation.options.length },
    });
    for (const [index, option] of input.response.presentation.options.entries()) {
      await input.storage.upsertSlotExposure({
        conversationId: input.conversationId,
        slotOptionId: buildWebhookSlotId(option.start, option.end, option.technician, option.bookingTarget),
        slotLabel: option.label,
        slotStart: option.start,
        slotEnd: option.end,
        slotOrderPresented: index + 1,
        selectedYesNo: false,
        timestamp: input.timestamp,
      });
    }
  } else {
    await input.storage.appendConversationStage({
      conversationId: input.conversationId,
      stage: "escalated",
      timestamp: input.timestamp,
      metadata: { reason: input.response.escalationReason ?? input.response.status },
    });
    await input.storage.appendHandoffEvent({
      conversationId: input.conversationId,
      reason: input.response.escalationReason ?? input.response.status,
      timestamp: input.timestamp,
    });
  }
}

function buildWebhookSlotId(
  start: string,
  end: string,
  technician: string,
  bookingTarget: string,
): string {
  return `${start}__${end}__${technician}__${bookingTarget}`;
}
