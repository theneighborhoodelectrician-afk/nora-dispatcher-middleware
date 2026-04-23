import {
  AvailabilityResponsePayload,
  BookingResponsePayload,
  CandidateSlot,
  ConversationPresentation,
  EscalationReason,
} from "../domain/types.js";

export function buildAvailabilityPresentation(input: {
  status: AvailabilityResponsePayload["status"];
  slots: CandidateSlot[];
  escalationReason?: EscalationReason;
}): ConversationPresentation {
  if (input.status === "slots_available") {
    const options = input.slots.slice(0, 3).map((slot) => ({
      label: slot.label,
      start: slot.start,
      end: slot.end,
      technician: slot.technician,
      bookingTarget: slot.bookingTarget,
    }));

    const labels = options.map((option) => option.label);
    return {
      replyText: `I have ${joinLabels(labels)}. Do any of those work for you?`,
      followUpPrompt: "Ask the customer which of the three options works best.",
      options,
    };
  }

  return {
    replyText: escalationReply(input.escalationReason),
    followUpPrompt: "Tell the customer dispatch will review the schedule and follow up directly.",
  };
}

export function buildBookingPresentation(input: {
  status: BookingResponsePayload["status"];
  alternatives?: CandidateSlot[];
  escalationReason?: EscalationReason;
}): ConversationPresentation {
  if (input.status === "booked") {
    return {
      replyText: "You're all set. I've locked that in for you.",
    };
  }

  if (input.status === "slot_unavailable") {
    const options = (input.alternatives ?? []).slice(0, 3).map((slot) => ({
      label: slot.label,
      start: slot.start,
      end: slot.end,
      technician: slot.technician,
      bookingTarget: slot.bookingTarget,
    }));
    return {
      replyText: `That time just filled up. I can offer ${joinLabels(options.map((option) => option.label))}. Which one would you like?`,
      followUpPrompt: "Offer the refreshed alternatives immediately.",
      options,
    };
  }

  return {
    replyText: escalationReply(input.escalationReason),
    followUpPrompt: "Tell the customer dispatch will call or text shortly to help manually.",
  };
}

function escalationReply(reason: EscalationReason | undefined): string {
  switch (reason) {
    case "emergency_keyword_detected":
      return "I'm having dispatch review this right now because it sounds urgent. They will call you in about 5 minutes.";
    case "outside_service_area":
      return "I'm having dispatch review this address and they will follow up with you directly.";
    case "after_hours_or_weekend":
      return "We typically schedule Monday through Friday. I've passed your info to our team and they'll reach out first thing to get you on the calendar.";
    case "no_viable_availability":
    default:
      return "I'm having my dispatch manager look at the schedule right now to squeeze you in. They will call you in about 5 minutes.";
  }
}

function joinLabels(labels: string[]): string {
  if (labels.length === 0) {
    return "a few options";
  }
  if (labels.length === 1) {
    return labels[0]!;
  }
  if (labels.length === 2) {
    return `${labels[0]} or ${labels[1]}`;
  }
  return `${labels[0]}, ${labels[1]}, or ${labels[2]}`;
}
