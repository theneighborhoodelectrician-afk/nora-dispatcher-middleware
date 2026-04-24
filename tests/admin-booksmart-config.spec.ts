import { describe, expect, it, vi } from "vitest";
import handler from "../api/admin/booksmart-config.js";
import { DEFAULT_BOOKSMART_CONFIG } from "../src/booksmart/defaultConfig.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";
import * as storageIndex from "../src/storage/index.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(payload: string) {
      this.body = payload;
      return this;
    },
  };
}

describe("admin BookSmart config API", () => {
  it("returns seeded BookSmart config on GET", async () => {
    const storage = new MemoryStorageAdapter();
    const prepareSpy = vi.spyOn(storageIndex, "prepareStorage").mockResolvedValue({
      mode: "memory",
      schemaReady: false,
    });
    const adapterSpy = vi.spyOn(storageIndex, "getStorageAdapter").mockReturnValue(storage);

    const res = createResponseRecorder();
    await handler(
      {
        method: "GET",
        headers: {},
        query: {},
      } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("\"success\":true");
    expect(res.body).toContain("\"serviceTypes\"");

    prepareSpy.mockRestore();
    adapterSpy.mockRestore();
  });

  it("stores normalized BookSmart config on PUT", async () => {
    const storage = new MemoryStorageAdapter();
    const prepareSpy = vi.spyOn(storageIndex, "prepareStorage").mockResolvedValue({
      mode: "memory",
      schemaReady: false,
    });
    const adapterSpy = vi.spyOn(storageIndex, "getStorageAdapter").mockReturnValue(storage);

    const res = createResponseRecorder();
    await handler(
      {
        method: "PUT",
        headers: {},
        query: {},
        body: {
          ...DEFAULT_BOOKSMART_CONFIG,
          serviceAreas: {
            outsideAreaBehavior: "handoff",
          },
        },
      } as never,
      res as never,
    );

    const saved = await storage.getBookSmartConfig();
    expect(res.statusCode).toBe(200);
    expect(saved?.serviceAreas).toEqual({ outsideAreaBehavior: "handoff" });

    prepareSpy.mockRestore();
    adapterSpy.mockRestore();
  });

  it("rejects invalid config payloads", async () => {
    const storage = new MemoryStorageAdapter();
    const prepareSpy = vi.spyOn(storageIndex, "prepareStorage").mockResolvedValue({
      mode: "memory",
      schemaReady: false,
    });
    const adapterSpy = vi.spyOn(storageIndex, "getStorageAdapter").mockReturnValue(storage);

    const res = createResponseRecorder();
    await handler(
      {
        method: "PUT",
        headers: {},
        query: {},
        body: {
          serviceTypes: [],
        },
      } as never,
      res as never,
    );

    expect(res.statusCode).toBe(400);

    prepareSpy.mockRestore();
    adapterSpy.mockRestore();
  });
});
