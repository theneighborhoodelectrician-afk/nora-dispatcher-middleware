import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "../src/storage/memory.js";

describe("memory storage adapter", () => {
  it("stores and returns idempotent results", async () => {
    const storage = new MemoryStorageAdapter();
    await storage.storeIdempotentResult("abc", { ok: true });

    const result = await storage.getIdempotentResult<{ ok: boolean }>("abc");
    expect(result).toEqual({ ok: true });
  });

  it("removes expired idempotency entries during cleanup", async () => {
    const storage = new MemoryStorageAdapter();
    await storage.storeIdempotentResult("old", { ok: true });

    await new Promise((resolve) => setTimeout(resolve, 5));
    await storage.cleanupIdempotency(1);

    const result = await storage.getIdempotentResult("old");
    expect(result).toBeUndefined();
  });
});
