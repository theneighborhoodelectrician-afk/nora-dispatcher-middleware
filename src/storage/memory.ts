import { ChatSessionRecord, StorageAdapter, WebhookEventRecord } from "./types.js";

const processedKeys = new Map<string, { createdAt: number; payload: unknown }>();
const webhookEvents: WebhookEventRecord[] = [];
const chatSessions = new Map<string, ChatSessionRecord>();

export class MemoryStorageAdapter implements StorageAdapter {
  async getIdempotentResult<T>(key: string): Promise<T | undefined> {
    const entry = processedKeys.get(key);
    return entry?.payload as T | undefined;
  }

  async storeIdempotentResult<T>(key: string, payload: T): Promise<void> {
    processedKeys.set(key, { createdAt: Date.now(), payload });
  }

  async logWebhookEvent(event: WebhookEventRecord): Promise<void> {
    webhookEvents.push(event);
    if (webhookEvents.length > 500) {
      webhookEvents.shift();
    }
  }

  async getChatSession<T>(sessionId: string): Promise<ChatSessionRecord<T> | undefined> {
    return chatSessions.get(sessionId) as ChatSessionRecord<T> | undefined;
  }

  async storeChatSession<T>(sessionId: string, payload: T): Promise<void> {
    chatSessions.set(sessionId, {
      sessionId,
      payload,
      updatedAt: Date.now(),
    });
  }

  async cleanupIdempotency(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    const threshold = Date.now() - maxAgeMs;
    for (const [key, value] of processedKeys.entries()) {
      if (value.createdAt < threshold) {
        processedKeys.delete(key);
      }
    }
  }
}
