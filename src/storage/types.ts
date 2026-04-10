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
  cleanupIdempotency(maxAgeMs?: number): Promise<void>;
}
