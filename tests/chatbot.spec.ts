import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig } from "../src/config.js";
import { handleChatMessage } from "../src/services/chatbot.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";

const config: AppConfig = {
  environment: "test",
  scheduling: {
    timezone: "America/Detroit",
    openingHour: 9,
    closingHour: 18,
    defaultSlotCount: 3,
    maxLookaheadDays: 5,
    minLeadHours: 2,
    bufferMinutes: 30,
  },
  hcp: {
    baseUrl: "https://api.housecallpro.com",
    customerPath: "/customers",
    employeePath: "/public/v1/employees",
    schedulePath: "/public/v1/jobs",
    createJobPath: "/public/v1/jobs",
    createEstimatePath: "/public/v1/estimates",
  },
  ghl: {},
  blooio: {},
  storage: {
    autoInit: true,
  },
};

describe("BookSmart chat flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T11:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for city first before collecting booking details", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-city",
        text: "I need recessed lights in my kitchen",
        contact: {
          phone: "555-111-2222",
        },
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_city");
    expect(reply.replyText).toContain("What city is the project in?");
  });

  it("offers real slots after city, service, address, name, and time preference are collected", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "Hi there",
        contact: {
          phone: "555-111-2222",
        },
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "Sterling Heights",
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "I need recessed lights in my kitchen",
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "123 Main St, Sterling Heights, MI 48313",
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "Jane",
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "Morning works best",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("offer_slots");
    expect(reply.options).toHaveLength(3);
    expect(reply.replyText.toLowerCase()).toContain("morning");
  });

  it("hands off urgent issues instead of continuing normal booking", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-urgent",
        text: "hello",
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-urgent",
        text: "Troy",
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-urgent",
        text: "I have a burning smell coming from the panel",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("human_handoff");
    expect(reply.handoffRequired).toBe(true);
    expect(reply.replyText.toLowerCase()).toContain("urgent");
  });

  it("hands off outside-area cities for manual review", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "hello",
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "Detroit",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("human_handoff");
    expect(reply.handoffRequired).toBe(true);
    expect(reply.replyText.toLowerCase()).toContain("manual review");
  });

  it("books a selected option after BookSmart offers slots", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "hello",
        contact: {
          phone: "555-111-2222",
        },
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "Sterling Heights",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "I need a breaker that keeps tripping checked out",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "123 Main St, Sterling Heights, MI 48313",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "Jane",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "afternoon",
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "the first one works",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("booked");
    expect(reply.bookingId).toContain("mock-");
  });
});
