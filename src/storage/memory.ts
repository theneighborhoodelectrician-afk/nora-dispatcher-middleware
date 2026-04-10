import { BookSmartConfig } from "../booksmart/types.js";
import {
  BookingEventRecord,
  ContactRecord,
  ConversationMessageRecord,
  ConversationOutcomeRecord,
  ConversationRecord,
  ConversationStageHistoryRecord,
  HandoffEventRecord,
  LeadSourceCode,
  LeadSourceRecord,
  SlotExposureRecord,
  UrgencyKeywordHitRecord,
} from "../conversations/types.js";
import { ChatSessionRecord, StorageAdapter, WebhookEventRecord } from "./types.js";

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly processedKeys = new Map<string, { createdAt: number; payload: unknown }>();
  private readonly webhookEvents: WebhookEventRecord[] = [];
  private readonly chatSessions = new Map<string, ChatSessionRecord>();
  private readonly leadSources = new Map<LeadSourceCode, LeadSourceRecord>();
  private readonly contacts = new Map<string, ContactRecord>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly conversationOutcomes = new Map<string, ConversationOutcomeRecord>();
  private readonly conversationStages = new Map<string, ConversationStageHistoryRecord[]>();
  private readonly conversationMessages = new Map<string, ConversationMessageRecord[]>();
  private readonly slotExposures = new Map<string, SlotExposureRecord[]>();
  private readonly urgencyKeywordHits = new Map<string, UrgencyKeywordHitRecord[]>();
  private readonly bookingEvents = new Map<string, BookingEventRecord[]>();
  private readonly handoffEvents = new Map<string, HandoffEventRecord[]>();
  private bookSmartConfig: BookSmartConfig | undefined;

  async getIdempotentResult<T>(key: string): Promise<T | undefined> {
    const entry = this.processedKeys.get(key);
    return entry?.payload as T | undefined;
  }

  async storeIdempotentResult<T>(key: string, payload: T): Promise<void> {
    this.processedKeys.set(key, { createdAt: Date.now(), payload });
  }

  async logWebhookEvent(event: WebhookEventRecord): Promise<void> {
    this.webhookEvents.push(event);
    if (this.webhookEvents.length > 500) {
      this.webhookEvents.shift();
    }
  }

  async getChatSession<T>(sessionId: string): Promise<ChatSessionRecord<T> | undefined> {
    return this.chatSessions.get(sessionId) as ChatSessionRecord<T> | undefined;
  }

  async storeChatSession<T>(sessionId: string, payload: T): Promise<void> {
    this.chatSessions.set(sessionId, {
      sessionId,
      payload,
      updatedAt: Date.now(),
    });
  }

  async getBookSmartConfig(): Promise<BookSmartConfig | undefined> {
    return this.bookSmartConfig;
  }

  async storeBookSmartConfig(config: BookSmartConfig): Promise<void> {
    this.bookSmartConfig = config;
  }

  async upsertLeadSource(leadSource: LeadSourceRecord): Promise<void> {
    this.leadSources.set(leadSource.code, leadSource);
  }

  async getLeadSource(code: LeadSourceCode): Promise<LeadSourceRecord | undefined> {
    return this.leadSources.get(code);
  }

  async upsertContact(contact: ContactRecord): Promise<void> {
    this.contacts.set(contact.contactId, contact);
  }

  async getContact(contactId: string): Promise<ContactRecord | undefined> {
    return this.contacts.get(contactId);
  }

  async upsertConversation(conversation: ConversationRecord): Promise<void> {
    this.conversations.set(conversation.conversationId, conversation);
  }

  async getConversation(conversationId: string): Promise<ConversationRecord | undefined> {
    return this.conversations.get(conversationId);
  }

  async upsertConversationOutcome(outcome: ConversationOutcomeRecord): Promise<void> {
    this.conversationOutcomes.set(outcome.conversationId, outcome);
  }

  async getConversationOutcome(conversationId: string): Promise<ConversationOutcomeRecord | undefined> {
    return this.conversationOutcomes.get(conversationId);
  }

  async listConversationOutcomes(limit = 50): Promise<ConversationOutcomeRecord[]> {
    return [...this.conversationOutcomes.values()]
      .sort((a, b) => b.timestampLastMessage - a.timestampLastMessage)
      .slice(0, limit);
  }

  async appendConversationStage(record: ConversationStageHistoryRecord): Promise<void> {
    const existing = this.conversationStages.get(record.conversationId) ?? [];
    existing.push(record);
    this.conversationStages.set(record.conversationId, existing);
  }

  async listConversationStages(conversationId: string): Promise<ConversationStageHistoryRecord[]> {
    return [...(this.conversationStages.get(conversationId) ?? [])];
  }

  async appendConversationMessage(record: ConversationMessageRecord): Promise<void> {
    const existing = this.conversationMessages.get(record.conversationId) ?? [];
    existing.push(record);
    this.conversationMessages.set(record.conversationId, existing);
  }

  async listConversationMessages(conversationId: string): Promise<ConversationMessageRecord[]> {
    return [...(this.conversationMessages.get(conversationId) ?? [])];
  }

  async upsertSlotExposure(record: SlotExposureRecord): Promise<void> {
    const existing = this.slotExposures.get(record.conversationId) ?? [];
    const next = existing.filter((entry) => entry.slotOptionId !== record.slotOptionId);
    next.push(record);
    next.sort((a, b) => a.slotOrderPresented - b.slotOrderPresented);
    this.slotExposures.set(record.conversationId, next);
  }

  async listSlotExposures(conversationId: string): Promise<SlotExposureRecord[]> {
    return [...(this.slotExposures.get(conversationId) ?? [])];
  }

  async appendUrgencyKeywordHit(record: UrgencyKeywordHitRecord): Promise<void> {
    const existing = this.urgencyKeywordHits.get(record.conversationId) ?? [];
    existing.push(record);
    this.urgencyKeywordHits.set(record.conversationId, existing);
  }

  async listUrgencyKeywordHits(conversationId: string): Promise<UrgencyKeywordHitRecord[]> {
    return [...(this.urgencyKeywordHits.get(conversationId) ?? [])];
  }

  async appendBookingEvent(record: BookingEventRecord): Promise<void> {
    const existing = this.bookingEvents.get(record.conversationId) ?? [];
    existing.push(record);
    this.bookingEvents.set(record.conversationId, existing);
  }

  async listBookingEvents(conversationId: string): Promise<BookingEventRecord[]> {
    return [...(this.bookingEvents.get(conversationId) ?? [])];
  }

  async appendHandoffEvent(record: HandoffEventRecord): Promise<void> {
    const existing = this.handoffEvents.get(record.conversationId) ?? [];
    existing.push(record);
    this.handoffEvents.set(record.conversationId, existing);
  }

  async listHandoffEvents(conversationId: string): Promise<HandoffEventRecord[]> {
    return [...(this.handoffEvents.get(conversationId) ?? [])];
  }

  async cleanupIdempotency(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    const threshold = Date.now() - maxAgeMs;
    for (const [key, value] of this.processedKeys.entries()) {
      if (value.createdAt < threshold) {
        this.processedKeys.delete(key);
      }
    }
  }
}
