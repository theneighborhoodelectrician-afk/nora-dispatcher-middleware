import { describe, expect, it } from "vitest";
import { DEFAULT_BOOKSMART_CONFIG } from "../src/booksmart/defaultConfig.js";
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

  it("stores and returns BookSmart config", async () => {
    const storage = new MemoryStorageAdapter();
    const config = {
      ...DEFAULT_BOOKSMART_CONFIG,
      conversation: {
        ...DEFAULT_BOOKSMART_CONFIG.conversation,
        openingQuestion: "Which city is the job in?",
      },
    };

    await storage.storeBookSmartConfig(config);

    await expect(storage.getBookSmartConfig()).resolves.toEqual(config);
  });
});
