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
import { Pool } from "pg";
import { ChatSessionRecord, StorageAdapter, WebhookEventRecord } from "./types.js";

export class PostgresStorageAdapter implements StorageAdapter {
  constructor(private readonly pool: Pool) {}

  async getIdempotentResult<T>(key: string): Promise<T | undefined> {
    const result = await this.pool.query(
      `select payload
       from middleware_idempotency
       where key = $1
       limit 1`,
      [key],
    );

    return result.rows[0]?.payload as T | undefined;
  }

  async storeIdempotentResult<T>(key: string, payload: T): Promise<void> {
    await this.pool.query(
      `insert into middleware_idempotency (key, payload, created_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update
       set payload = excluded.payload,
           created_at = now()`,
      [key, JSON.stringify(payload)],
    );
  }

  async logWebhookEvent(event: WebhookEventRecord): Promise<void> {
    await this.pool.query(
      `insert into middleware_webhook_events
        (webhook_id, kind, phase, payload, created_at)
       values ($1, $2, $3, $4::jsonb, to_timestamp($5 / 1000.0))`,
      [
        event.webhookId,
        event.kind,
        event.phase,
        JSON.stringify(event.payload),
        event.createdAt,
      ],
    );
  }

  async getChatSession<T>(sessionId: string): Promise<ChatSessionRecord<T> | undefined> {
    const result = await this.pool.query(
      `select session_id, payload, extract(epoch from updated_at) * 1000 as updated_at
       from middleware_chat_sessions
       where session_id = $1
       limit 1`,
      [sessionId],
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      sessionId: row.session_id as string,
      payload: row.payload as T,
      updatedAt: Number(row.updated_at),
    };
  }

  async storeChatSession<T>(sessionId: string, payload: T): Promise<void> {
    await this.pool.query(
      `insert into middleware_chat_sessions (session_id, payload, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (session_id) do update
       set payload = excluded.payload,
           updated_at = now()`,
      [sessionId, JSON.stringify(payload)],
    );
  }

  async getBookSmartConfig(): Promise<BookSmartConfig | undefined> {
    const result = await this.pool.query(
      `select payload
       from middleware_config
       where key = 'booksmart_config'
       limit 1`,
    );

    return result.rows[0]?.payload as BookSmartConfig | undefined;
  }

  async storeBookSmartConfig(config: BookSmartConfig): Promise<void> {
    await this.pool.query(
      `insert into middleware_config (key, payload, updated_at)
       values ('booksmart_config', $1::jsonb, now())
       on conflict (key) do update
       set payload = excluded.payload,
           updated_at = now()`,
      [JSON.stringify(config)],
    );
  }

  async upsertLeadSource(leadSource: LeadSourceRecord): Promise<void> {
    await this.pool.query(
      `insert into lead_sources (code, display_name, active, updated_at)
       values ($1, $2, $3, now())
       on conflict (code) do update
       set display_name = excluded.display_name,
           active = excluded.active,
           updated_at = now()`,
      [leadSource.code, leadSource.displayName, leadSource.active],
    );
  }

  async getLeadSource(code: LeadSourceCode): Promise<LeadSourceRecord | undefined> {
    const result = await this.pool.query(
      `select code, display_name, active
       from lead_sources
       where code = $1
       limit 1`,
      [code],
    );
    const row = result.rows[0];
    return row
      ? {
          code: row.code as LeadSourceCode,
          displayName: row.display_name as string,
          active: Boolean(row.active),
        }
      : undefined;
  }

  async upsertContact(contact: ContactRecord): Promise<void> {
    await this.pool.query(
      `insert into contacts
        (contact_id, phone, first_name, last_name, email, address, city, zip_code, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0))
       on conflict (contact_id) do update
       set phone = excluded.phone,
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           email = excluded.email,
           address = excluded.address,
           city = excluded.city,
           zip_code = excluded.zip_code,
           updated_at = excluded.updated_at`,
      [
        contact.contactId,
        contact.phone,
        contact.firstName,
        contact.lastName,
        contact.email,
        contact.address,
        contact.city,
        contact.zipCode,
        contact.updatedAt,
      ],
    );
  }

  async getContact(contactId: string): Promise<ContactRecord | undefined> {
    const result = await this.pool.query(
      `select contact_id, phone, first_name, last_name, email, address, city, zip_code,
              extract(epoch from updated_at) * 1000 as updated_at
       from contacts
       where contact_id = $1
       limit 1`,
      [contactId],
    );
    const row = result.rows[0];
    return row
      ? {
          contactId: row.contact_id as string,
          phone: row.phone as string | undefined,
          firstName: row.first_name as string | undefined,
          lastName: row.last_name as string | undefined,
          email: row.email as string | undefined,
          address: row.address as string | undefined,
          city: row.city as string | undefined,
          zipCode: row.zip_code as string | undefined,
          updatedAt: Number(row.updated_at),
        }
      : undefined;
  }

  async upsertConversation(conversation: ConversationRecord): Promise<void> {
    await this.pool.query(
      `insert into conversations
        (conversation_id, contact_id, lead_source, timestamp_started, timestamp_last_message, current_stage, updated_at)
       values ($1, $2, $3, to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), $6, now())
       on conflict (conversation_id) do update
       set contact_id = excluded.contact_id,
           lead_source = excluded.lead_source,
           timestamp_last_message = excluded.timestamp_last_message,
           current_stage = excluded.current_stage,
           updated_at = now()`,
      [
        conversation.conversationId,
        conversation.contactId,
        conversation.leadSource,
        conversation.timestampStarted,
        conversation.timestampLastMessage,
        conversation.currentStage,
      ],
    );
  }

  async getConversation(conversationId: string): Promise<ConversationRecord | undefined> {
    const result = await this.pool.query(
      `select conversation_id, contact_id, lead_source,
              extract(epoch from timestamp_started) * 1000 as timestamp_started,
              extract(epoch from timestamp_last_message) * 1000 as timestamp_last_message,
              current_stage
       from conversations
       where conversation_id = $1
       limit 1`,
      [conversationId],
    );
    const row = result.rows[0];
    return row
      ? {
          conversationId: row.conversation_id as string,
          contactId: row.contact_id as string | undefined,
          leadSource: row.lead_source as LeadSourceCode,
          timestampStarted: Number(row.timestamp_started),
          timestampLastMessage: Number(row.timestamp_last_message),
          currentStage: row.current_stage as ConversationRecord["currentStage"],
        }
      : undefined;
  }

  async upsertConversationOutcome(outcome: ConversationOutcomeRecord): Promise<void> {
    await this.pool.query(
      `insert into conversation_outcomes
        (conversation_id, lead_source, timestamp_started, timestamp_last_message, first_customer_message,
         classified_service_type, urgency_level, urgency_keywords_detected, address_collected, phone_collected,
         email_collected, photo_sent, availability_shown, slots_shown_count, slot_selected, booked_yes_no,
         handoff_yes_no, abandonment_stage, final_hcp_job_type, final_booking_status, system_summary, updated_at)
       values ($1, $2, to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5,
         $6, $7, $8::jsonb, $9, $10,
         $11, $12, $13, $14, $15, $16,
         $17, $18, $19, $20, $21, now())
       on conflict (conversation_id) do update
       set lead_source = excluded.lead_source,
           timestamp_started = excluded.timestamp_started,
           timestamp_last_message = excluded.timestamp_last_message,
           first_customer_message = excluded.first_customer_message,
           classified_service_type = excluded.classified_service_type,
           urgency_level = excluded.urgency_level,
           urgency_keywords_detected = excluded.urgency_keywords_detected,
           address_collected = excluded.address_collected,
           phone_collected = excluded.phone_collected,
           email_collected = excluded.email_collected,
           photo_sent = excluded.photo_sent,
           availability_shown = excluded.availability_shown,
           slots_shown_count = excluded.slots_shown_count,
           slot_selected = excluded.slot_selected,
           booked_yes_no = excluded.booked_yes_no,
           handoff_yes_no = excluded.handoff_yes_no,
           abandonment_stage = excluded.abandonment_stage,
           final_hcp_job_type = excluded.final_hcp_job_type,
           final_booking_status = excluded.final_booking_status,
           system_summary = excluded.system_summary,
           updated_at = now()`,
      [
        outcome.conversationId,
        outcome.leadSource,
        outcome.timestampStarted,
        outcome.timestampLastMessage,
        outcome.firstCustomerMessage,
        outcome.classifiedServiceType,
        outcome.urgencyLevel,
        JSON.stringify(outcome.urgencyKeywordsDetected),
        outcome.addressCollected,
        outcome.phoneCollected,
        outcome.emailCollected,
        outcome.photoSent,
        outcome.availabilityShown,
        outcome.slotsShownCount,
        outcome.slotSelected,
        outcome.bookedYesNo,
        outcome.handoffYesNo,
        outcome.abandonmentStage,
        outcome.finalHcpJobType,
        outcome.finalBookingStatus,
        outcome.systemSummary,
      ],
    );
  }

  async getConversationOutcome(conversationId: string): Promise<ConversationOutcomeRecord | undefined> {
    const result = await this.pool.query(
      `select conversation_id, lead_source,
              extract(epoch from timestamp_started) * 1000 as timestamp_started,
              extract(epoch from timestamp_last_message) * 1000 as timestamp_last_message,
              first_customer_message, classified_service_type, urgency_level, urgency_keywords_detected,
              address_collected, phone_collected, email_collected, photo_sent, availability_shown,
              slots_shown_count, slot_selected, booked_yes_no, handoff_yes_no, abandonment_stage,
              final_hcp_job_type, final_booking_status, system_summary
       from conversation_outcomes
       where conversation_id = $1
       limit 1`,
      [conversationId],
    );
    const row = result.rows[0];
    return row
      ? {
          conversationId: row.conversation_id as string,
          leadSource: row.lead_source as LeadSourceCode,
          timestampStarted: Number(row.timestamp_started),
          timestampLastMessage: Number(row.timestamp_last_message),
          firstCustomerMessage: row.first_customer_message as string,
          classifiedServiceType: row.classified_service_type as string | undefined,
          urgencyLevel: row.urgency_level as ConversationOutcomeRecord["urgencyLevel"],
          urgencyKeywordsDetected: (row.urgency_keywords_detected as string[]) ?? [],
          addressCollected: Boolean(row.address_collected),
          phoneCollected: Boolean(row.phone_collected),
          emailCollected: Boolean(row.email_collected),
          photoSent: Boolean(row.photo_sent),
          availabilityShown: Boolean(row.availability_shown),
          slotsShownCount: Number(row.slots_shown_count),
          slotSelected: Boolean(row.slot_selected),
          bookedYesNo: Boolean(row.booked_yes_no),
          handoffYesNo: Boolean(row.handoff_yes_no),
          abandonmentStage: row.abandonment_stage as string | undefined,
          finalHcpJobType: row.final_hcp_job_type as string | undefined,
          finalBookingStatus: row.final_booking_status as string | undefined,
          systemSummary: row.system_summary as string | undefined,
        }
      : undefined;
  }

  async listConversationOutcomes(limit = 50): Promise<ConversationOutcomeRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, lead_source,
              extract(epoch from timestamp_started) * 1000 as timestamp_started,
              extract(epoch from timestamp_last_message) * 1000 as timestamp_last_message,
              first_customer_message, classified_service_type, urgency_level, urgency_keywords_detected,
              address_collected, phone_collected, email_collected, photo_sent, availability_shown,
              slots_shown_count, slot_selected, booked_yes_no, handoff_yes_no, abandonment_stage,
              final_hcp_job_type, final_booking_status, system_summary
       from conversation_outcomes
       order by timestamp_last_message desc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      leadSource: row.lead_source as LeadSourceCode,
      timestampStarted: Number(row.timestamp_started),
      timestampLastMessage: Number(row.timestamp_last_message),
      firstCustomerMessage: row.first_customer_message as string,
      classifiedServiceType: row.classified_service_type as string | undefined,
      urgencyLevel: row.urgency_level as ConversationOutcomeRecord["urgencyLevel"],
      urgencyKeywordsDetected: (row.urgency_keywords_detected as string[]) ?? [],
      addressCollected: Boolean(row.address_collected),
      phoneCollected: Boolean(row.phone_collected),
      emailCollected: Boolean(row.email_collected),
      photoSent: Boolean(row.photo_sent),
      availabilityShown: Boolean(row.availability_shown),
      slotsShownCount: Number(row.slots_shown_count),
      slotSelected: Boolean(row.slot_selected),
      bookedYesNo: Boolean(row.booked_yes_no),
      handoffYesNo: Boolean(row.handoff_yes_no),
      abandonmentStage: row.abandonment_stage as string | undefined,
      finalHcpJobType: row.final_hcp_job_type as string | undefined,
      finalBookingStatus: row.final_booking_status as string | undefined,
      systemSummary: row.system_summary as string | undefined,
    }));
  }

  async appendConversationStage(record: ConversationStageHistoryRecord): Promise<void> {
    await this.pool.query(
      `insert into conversation_stage_history
        (conversation_id, stage, created_at, metadata)
       values ($1, $2, to_timestamp($3 / 1000.0), $4::jsonb)`,
      [record.conversationId, record.stage, record.timestamp, JSON.stringify(record.metadata ?? {})],
    );
  }

  async listConversationStages(conversationId: string): Promise<ConversationStageHistoryRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, stage, extract(epoch from created_at) * 1000 as created_at, metadata
       from conversation_stage_history
       where conversation_id = $1
       order by created_at asc, id asc`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      stage: row.stage as ConversationStageHistoryRecord["stage"],
      timestamp: Number(row.created_at),
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    }));
  }

  async appendConversationMessage(record: ConversationMessageRecord): Promise<void> {
    await this.pool.query(
      `insert into conversation_messages
        (conversation_id, direction, text, tool_name, tool_call_summary, created_at, metadata)
       values ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), $7::jsonb)`,
      [
        record.conversationId,
        record.direction,
        record.text,
        record.toolName,
        record.toolCallSummary,
        record.timestamp,
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  async listConversationMessages(conversationId: string): Promise<ConversationMessageRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, direction, text, tool_name, tool_call_summary,
              extract(epoch from created_at) * 1000 as created_at, metadata
       from conversation_messages
       where conversation_id = $1
       order by created_at asc, id asc`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      direction: row.direction as ConversationMessageRecord["direction"],
      text: row.text as string | undefined,
      timestamp: Number(row.created_at),
      toolName: row.tool_name as string | undefined,
      toolCallSummary: row.tool_call_summary as string | undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    }));
  }

  async upsertSlotExposure(record: SlotExposureRecord): Promise<void> {
    await this.pool.query(
      `insert into slot_exposure_history
        (conversation_id, slot_option_id, slot_label, slot_start, slot_end, slot_order_presented, selected_yes_no, created_at)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, to_timestamp($8 / 1000.0))
       on conflict (conversation_id, slot_option_id) do update
       set slot_label = excluded.slot_label,
           slot_start = excluded.slot_start,
           slot_end = excluded.slot_end,
           slot_order_presented = excluded.slot_order_presented,
           selected_yes_no = excluded.selected_yes_no,
           created_at = excluded.created_at`,
      [
        record.conversationId,
        record.slotOptionId,
        record.slotLabel,
        record.slotStart,
        record.slotEnd,
        record.slotOrderPresented,
        record.selectedYesNo,
        record.timestamp,
      ],
    );
  }

  async listSlotExposures(conversationId: string): Promise<SlotExposureRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, slot_option_id, slot_label, slot_start, slot_end,
              slot_order_presented, selected_yes_no, extract(epoch from created_at) * 1000 as created_at
       from slot_exposure_history
       where conversation_id = $1
       order by slot_order_presented asc, id asc`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      slotOptionId: row.slot_option_id as string,
      slotLabel: row.slot_label as string,
      slotStart: new Date(row.slot_start as string).toISOString(),
      slotEnd: new Date(row.slot_end as string).toISOString(),
      slotOrderPresented: Number(row.slot_order_presented),
      selectedYesNo: Boolean(row.selected_yes_no),
      timestamp: Number(row.created_at),
    }));
  }

  async appendUrgencyKeywordHit(record: UrgencyKeywordHitRecord): Promise<void> {
    await this.pool.query(
      `insert into urgency_keyword_hits
        (conversation_id, keyword_detected, mapped_urgency_level, created_at)
       values ($1, $2, $3, to_timestamp($4 / 1000.0))`,
      [record.conversationId, record.keywordDetected, record.mappedUrgencyLevel, record.timestamp],
    );
  }

  async listUrgencyKeywordHits(conversationId: string): Promise<UrgencyKeywordHitRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, keyword_detected, mapped_urgency_level,
              extract(epoch from created_at) * 1000 as created_at
       from urgency_keyword_hits
       where conversation_id = $1
       order by created_at asc, id asc`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      keywordDetected: row.keyword_detected as string,
      mappedUrgencyLevel: row.mapped_urgency_level as UrgencyKeywordHitRecord["mappedUrgencyLevel"],
      timestamp: Number(row.created_at),
    }));
  }

  async appendBookingEvent(record: BookingEventRecord): Promise<void> {
    await this.pool.query(
      `insert into booking_events
        (conversation_id, booking_external_id, final_hcp_job_type, booking_status, created_at, metadata)
       values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6::jsonb)`,
      [
        record.conversationId,
        record.bookingExternalId,
        record.finalHcpJobType,
        record.bookingStatus,
        record.timestamp,
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  async listBookingEvents(conversationId: string): Promise<BookingEventRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, booking_external_id, final_hcp_job_type, booking_status,
              extract(epoch from created_at) * 1000 as created_at, metadata
       from booking_events
       where conversation_id = $1
       order by created_at asc, id asc`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      bookingExternalId: row.booking_external_id as string | undefined,
      finalHcpJobType: row.final_hcp_job_type as string | undefined,
      bookingStatus: row.booking_status as string,
      timestamp: Number(row.created_at),
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    }));
  }

  async appendHandoffEvent(record: HandoffEventRecord): Promise<void> {
    await this.pool.query(
      `insert into handoff_events
        (conversation_id, reason, created_at, metadata)
       values ($1, $2, to_timestamp($3 / 1000.0), $4::jsonb)`,
      [record.conversationId, record.reason, record.timestamp, JSON.stringify(record.metadata ?? {})],
    );
  }

  async listHandoffEvents(conversationId: string): Promise<HandoffEventRecord[]> {
    const result = await this.pool.query(
      `select conversation_id, reason, extract(epoch from created_at) * 1000 as created_at, metadata
       from handoff_events
       where conversation_id = $1
       order by created_at asc, id asc`,
      [conversationId],
    );
    return result.rows.map((row) => ({
      conversationId: row.conversation_id as string,
      reason: row.reason as string,
      timestamp: Number(row.created_at),
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    }));
  }

  async cleanupIdempotency(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    await this.pool.query(
      `delete from middleware_idempotency
       where created_at < now() - ($1 * interval '1 millisecond')`,
      [maxAgeMs],
    );
  }
}
