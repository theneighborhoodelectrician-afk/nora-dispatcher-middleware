import { StorageAdapter } from "../storage/types.js";

export async function getConversationAdminBundle(
  storage: StorageAdapter,
  conversationId: string,
): Promise<{
  conversation: Awaited<ReturnType<StorageAdapter["getConversation"]>>;
  outcome: Awaited<ReturnType<StorageAdapter["getConversationOutcome"]>>;
  stages: Awaited<ReturnType<StorageAdapter["listConversationStages"]>>;
  messages: Awaited<ReturnType<StorageAdapter["listConversationMessages"]>>;
  slots: Awaited<ReturnType<StorageAdapter["listSlotExposures"]>>;
  urgencyHits: Awaited<ReturnType<StorageAdapter["listUrgencyKeywordHits"]>>;
  bookingEvents: Awaited<ReturnType<StorageAdapter["listBookingEvents"]>>;
  handoffEvents: Awaited<ReturnType<StorageAdapter["listHandoffEvents"]>>;
}> {
  const [conversation, outcome, stages, messages, slots, urgencyHits, bookingEvents, handoffEvents] =
    await Promise.all([
      storage.getConversation(conversationId),
      storage.getConversationOutcome(conversationId),
      storage.listConversationStages(conversationId),
      storage.listConversationMessages(conversationId),
      storage.listSlotExposures(conversationId),
      storage.listUrgencyKeywordHits(conversationId),
      storage.listBookingEvents(conversationId),
      storage.listHandoffEvents(conversationId),
    ]);

  return {
    conversation,
    outcome,
    stages,
    messages,
    slots,
    urgencyHits,
    bookingEvents,
    handoffEvents,
  };
}
