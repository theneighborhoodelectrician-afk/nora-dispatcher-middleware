import { describe, expect, it, vi } from "vitest";
import handler from "../api/admin/conversations.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";
import { getConversationAdminBundle } from "../src/conversations/read.js";
import { trackAvailabilityRequest } from "../src/conversations/webhookTracking.js";
import { CustomerRequest } from "../src/domain/types.js";
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

describe("admin conversations", () => {
  it("builds a full conversation bundle for admin reads", async () => {
    const storage = new MemoryStorageAdapter();
    const request: CustomerRequest = {
      firstName: "Jane",
      phone: "555-111-2222",
      city: "Sterling Heights",
      address: "123 Main St",
      zipCode: "48313",
      requestedService: "Install recessed lights",
    };

    await trackAvailabilityRequest({
      storage,
      conversationId: "admin-conv-1",
      leadSource: "website",
      request,
      timestamp: Date.now(),
      response: {
        success: true,
        status: "slots_available",
        message: "ok",
        service: {
          category: "recessed-lighting",
          title: "Recessed lighting",
          durationMinutes: 240,
          requiredSkills: ["recessed-lighting", "residential"],
          preferredSkills: [],
          target: "job",
          complexityScore: 6,
        },
        slots: [],
        presentation: {
          replyText: "I have an option.",
          options: [
            {
              label: "Tomorrow at 9:00 AM",
              start: "2026-04-05T13:00:00.000Z",
              end: "2026-04-05T17:00:00.000Z",
              technician: "Dave",
              bookingTarget: "job",
            },
          ],
        },
      },
    });

    const bundle = await getConversationAdminBundle(storage, "admin-conv-1");
    expect(bundle.conversation?.conversationId).toBe("admin-conv-1");
    expect(bundle.outcome?.availabilityShown).toBe(true);
    expect(bundle.stages.length).toBeGreaterThan(0);
    expect(bundle.messages.length).toBeGreaterThan(0);
    expect(bundle.slots).toHaveLength(1);
  });

  it("returns conversation outcomes and detailed bundles from the admin API", async () => {
    const storage = new MemoryStorageAdapter();
    const request: CustomerRequest = {
      firstName: "Jane",
      phone: "555-111-2222",
      city: "Sterling Heights",
      address: "123 Main St",
      zipCode: "48313",
      requestedService: "Install recessed lights",
    };

    await trackAvailabilityRequest({
      storage,
      conversationId: "admin-api-conv-1",
      leadSource: "website",
      request,
      timestamp: Date.now(),
      response: {
        success: true,
        status: "slots_available",
        message: "ok",
        service: {
          category: "recessed-lighting",
          title: "Recessed lighting",
          durationMinutes: 240,
          requiredSkills: ["recessed-lighting", "residential"],
          preferredSkills: [],
          target: "job",
          complexityScore: 6,
        },
        slots: [],
        presentation: {
          replyText: "I have an option.",
          options: [],
        },
      },
    });

    const prepareSpy = vi.spyOn(storageIndex, "prepareStorage").mockResolvedValue({
      mode: "memory",
      schemaReady: false,
    });
    const adapterSpy = vi.spyOn(storageIndex, "getStorageAdapter").mockReturnValue(storage);

    const listRes = createResponseRecorder();
    await handler(
      {
        method: "GET",
        headers: {},
        query: {},
      } as never,
      listRes as never,
    );

    const detailRes = createResponseRecorder();
    await handler(
      {
        method: "GET",
        headers: {},
        query: {
          conversationId: "admin-api-conv-1",
        },
      } as never,
      detailRes as never,
    );

    expect(listRes.statusCode).toBe(200);
    expect(listRes.body).toContain("admin-api-conv-1");
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body).toContain("\"conversationId\":\"admin-api-conv-1\"");

    prepareSpy.mockRestore();
    adapterSpy.mockRestore();
  });
});
