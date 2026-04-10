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

  async cleanupIdempotency(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    await this.pool.query(
      `delete from middleware_idempotency
       where created_at < now() - ($1 * interval '1 millisecond')`,
      [maxAgeMs],
    );
  }
}
