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

export interface StoredResult<T = unknown> {
  key: string;
  payload: T;
  createdAt: number;
}

export interface WebhookEventRecord {
  webhookId: string;
  kind: "availability" | "booking" | "chat";
  phase: "received" | "cached_response" | "processed" | "error";
  payload: unknown;
  createdAt: number;
}

export interface ChatSessionRecord<T = unknown> {
  sessionId: string;
  payload: T;
  updatedAt: number;
}

export interface StorageAdapter {
  getIdempotentResult<T>(key: string): Promise<T | undefined>;
  storeIdempotentResult<T>(key: string, payload: T): Promise<void>;
  logWebhookEvent(event: WebhookEventRecord): Promise<void>;
  getChatSession<T>(sessionId: string): Promise<ChatSessionRecord<T> | undefined>;
  storeChatSession<T>(sessionId: string, payload: T): Promise<void>;
  getBookSmartConfig(): Promise<BookSmartConfig | undefined>;
  storeBookSmartConfig(config: BookSmartConfig): Promise<void>;
  upsertLeadSource(leadSource: LeadSourceRecord): Promise<void>;
  getLeadSource(code: LeadSourceCode): Promise<LeadSourceRecord | undefined>;
  upsertContact(contact: ContactRecord): Promise<void>;
  getContact(contactId: string): Promise<ContactRecord | undefined>;
  upsertConversation(conversation: ConversationRecord): Promise<void>;
  getConversation(conversationId: string): Promise<ConversationRecord | undefined>;
  upsertConversationOutcome(outcome: ConversationOutcomeRecord): Promise<void>;
  getConversationOutcome(conversationId: string): Promise<ConversationOutcomeRecord | undefined>;
  listConversationOutcomes(limit?: number): Promise<ConversationOutcomeRecord[]>;
  appendConversationStage(record: ConversationStageHistoryRecord): Promise<void>;
  listConversationStages(conversationId: string): Promise<ConversationStageHistoryRecord[]>;
  appendConversationMessage(record: ConversationMessageRecord): Promise<void>;
  listConversationMessages(conversationId: string): Promise<ConversationMessageRecord[]>;
  upsertSlotExposure(record: SlotExposureRecord): Promise<void>;
  listSlotExposures(conversationId: string): Promise<SlotExposureRecord[]>;
  appendUrgencyKeywordHit(record: UrgencyKeywordHitRecord): Promise<void>;
  listUrgencyKeywordHits(conversationId: string): Promise<UrgencyKeywordHitRecord[]>;
  appendBookingEvent(record: BookingEventRecord): Promise<void>;
  listBookingEvents(conversationId: string): Promise<BookingEventRecord[]>;
  appendHandoffEvent(record: HandoffEventRecord): Promise<void>;
  listHandoffEvents(conversationId: string): Promise<HandoffEventRecord[]>;
  cleanupIdempotency(maxAgeMs?: number): Promise<void>;
}
