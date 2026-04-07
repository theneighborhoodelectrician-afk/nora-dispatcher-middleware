export interface StoredResult<T = unknown> {
  key: string;
  payload: T;
  createdAt: number;
}

export interface WebhookEventRecord {
  webhookId: string;
  kind: "availability" | "booking";
  phase: "received" | "cached_response" | "processed" | "error";
  payload: unknown;
  createdAt: number;
}

export interface StorageAdapter {
  getIdempotentResult<T>(key: string): Promise<T | undefined>;
  storeIdempotentResult<T>(key: string, payload: T): Promise<void>;
  logWebhookEvent(event: WebhookEventRecord): Promise<void>;
  cleanupIdempotency(maxAgeMs?: number): Promise<void>;
}
