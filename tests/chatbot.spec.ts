import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOOKSMART_CONFIG } from "../src/booksmart/defaultConfig.js";
import { createInitialAnalytics } from "../src/conversations/tracking.js";
import { AppConfig } from "../src/config.js";
import { ChatSessionState, handleChatMessage } from "../src/services/chatbot.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";

const config: AppConfig = {
  environment: "test",
  contact: {
    humanHandoffPhone: "586-489-1504",
    humanHandoffHref: "tel:+15864891504",
  },
  scheduling: {
    timezone: "America/Detroit",
    openingHour: 9,
    closingHour: 18,
    defaultSlotCount: 3,
    maxLookaheadDays: 5,
    minLeadHours: 2,
    bufferMinutes: 30,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    enabled: false,
  },
  hcp: {
    baseUrl: "https://api.housecallpro.com",
    customerPath: "/customers",
    employeePath: "/employees",
    schedulePath: "/jobs",
    createJobPath: "/jobs",
    createEstimatePath: "/public/v1/estimates",
    createLeadPath: "/leads",
  },
  ghl: {},
  blooio: {},
  admin: {},
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("submits a lead after city, service, address, name, and time preference are collected", async () => {
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

    const emailReply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "jane@example.com",
      },
      storage,
      config,
    );

    expect(emailReply.stage).toBe("collect_preferred_window");
    expect(emailReply.replyText.toLowerCase()).toContain("mornings or afternoons");

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "Morning works best",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.leadId).toContain("lead-");
    expect(reply.replyText.toLowerCase()).toContain("dispatch");
    expect(reply.replyText.toLowerCase()).toContain("team member");
    expect(reply.replyText.toLowerCase()).toContain("asap");
  });

  it("submits a lead through the OpenAI runtime path instead of offering slots", async () => {
    const storage = new MemoryStorageAdapter();
    const aiConfig: AppConfig = {
      ...config,
      openai: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5-mini",
        enabled: true,
      },
    };

    const sessionState: ChatSessionState = {
      sessionId: "booksmart-ai-slots",
      stage: "collect_preferred_window",
      customer: {
        city: "Sterling Heights",
        requestedService: "Recessed lighting",
        address: "123 Main St",
        zipCode: "48313",
        firstName: "Jane",
        phone: "555-111-2222",
        email: "jane@example.com",
      },
      bookingStatus: "collecting",
      transcript: [],
      analytics: createInitialAnalytics(
        new Date("2026-04-04T11:00:00.000Z").getTime(),
        "hello",
        "website",
      ),
    };

    await storage.storeChatSession(sessionState.sessionId, sessionState);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_1",
          output_text: "Thanks, I have what I need to send this to dispatch.",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-slots",
        text: "Morning works best",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.leadId).toContain("lead-");
    expect(reply.replyText.toLowerCase()).toContain("dispatch");
    expect(reply.replyText.toLowerCase()).toContain("team member");

    const messages = await storage.listConversationMessages("booksmart-ai-slots");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(true);
  });

  it("can use the OpenAI runtime path to store structured fields before asking the next question", async () => {
    const storage = new MemoryStorageAdapter();
    const aiConfig: AppConfig = {
      ...config,
      openai: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5-mini",
        enabled: true,
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_city_1",
          output: [
            {
              type: "function_call",
              call_id: "call_city_1",
              name: "update_conversation_state",
              arguments: JSON.stringify({ city: "Sterling Heights" }),
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_city_2",
          output_text: "What kind of electrical project do you need help with?",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-city",
        text: "Sterling Heights",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText).toContain("What kind of electrical project");

    const storedSession = await storage.getChatSession<ChatSessionState>("booksmart-ai-city");
    expect(storedSession?.payload.customer.city).toBe("Sterling Heights");

    const stages = await storage.listConversationStages("booksmart-ai-city");
    expect(stages.some((stage) => stage.stage === "city_collected")).toBe(true);

    const messages = await storage.listConversationMessages("booksmart-ai-city");
    expect(
      messages.some((message) => message.direction === "tool" && message.toolName === "update_conversation_state"),
    ).toBe(true);
  });

  it("ignores legacy offered-slot state and still submits a lead in launch mode", async () => {
    const storage = new MemoryStorageAdapter();
    const aiConfig: AppConfig = {
      ...config,
      openai: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5-mini",
        enabled: true,
      },
    };

    const lastOfferedOptions = [
      {
        label: "Monday at 9:00 AM",
        start: "2026-04-06T13:00:00.000Z",
        end: "2026-04-06T17:00:00.000Z",
        technician: "Dave" as const,
        bookingTarget: "job" as const,
      },
      {
        label: "Tuesday at 9:00 AM",
        start: "2026-04-07T13:00:00.000Z",
        end: "2026-04-07T17:00:00.000Z",
        technician: "Dave" as const,
        bookingTarget: "job" as const,
      },
      {
        label: "Wednesday at 9:00 AM",
        start: "2026-04-08T13:00:00.000Z",
        end: "2026-04-08T17:00:00.000Z",
        technician: "Dave" as const,
        bookingTarget: "job" as const,
      },
    ];

    const sessionState: ChatSessionState = {
      sessionId: "booksmart-ai-book",
      stage: "offer_slots",
      customer: {
        city: "Sterling Heights",
        requestedService: "Breaker tripping",
        address: "123 Main St",
        zipCode: "48313",
        firstName: "Jane",
        phone: "555-111-2222",
        email: "jane@example.com",
        preferredWindow: "morning",
      },
      bookingStatus: "offered",
      lastOfferedOptions,
      transcript: [],
      analytics: createInitialAnalytics(
        new Date("2026-04-04T11:00:00.000Z").getTime(),
        "hello",
        "website",
      ),
    };

    await storage.storeChatSession(sessionState.sessionId, sessionState);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_book_3",
          output_text: "I’ll send this to dispatch for follow-up.",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-book",
        text: "the second one works",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.leadId).toContain("lead-");
    expect(reply.replyText.toLowerCase()).toContain("dispatch");
    expect(reply.replyText.toLowerCase()).toContain("team member");

    const messages = await storage.listConversationMessages("booksmart-ai-book");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(true);
    const decisionTrace = messages.find(
      (message) => message.direction === "tool" && message.toolName === "openai_decision_trace",
    );
    expect(decisionTrace?.toolCallSummary).toContain("without tool calls");
    expect(Array.isArray(decisionTrace?.metadata?.trace)).toBe(true);

    const outcome = await storage.getConversationOutcome("booksmart-ai-book");
    expect(outcome?.bookedYesNo).toBe(true);
    expect(outcome?.finalBookingStatus).toBe("lead_submitted");
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
    expect(reply.replyText).toContain("586-489-1504");
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
    expect(reply.replyText).toContain("586-489-1504");
  });

  it("uses stored BookSmart config to change routing behavior", async () => {
    const storage = new MemoryStorageAdapter();
    await storage.storeBookSmartConfig({
      ...DEFAULT_BOOKSMART_CONFIG,
      serviceAreas: {
        ...DEFAULT_BOOKSMART_CONFIG.serviceAreas,
        allowedCities: [...DEFAULT_BOOKSMART_CONFIG.serviceAreas.allowedCities, "detroit"],
      },
      conversation: {
        ...DEFAULT_BOOKSMART_CONFIG.conversation,
        openingQuestion: "Which city is this project in?",
      },
    });

    const firstReply = await handleChatMessage(
      {
        sessionId: "booksmart-config-routing",
        text: "hello",
      },
      storage,
      config,
    );

    expect(firstReply.replyText).toContain("Which city is this project in?");

    const secondReply = await handleChatMessage(
      {
        sessionId: "booksmart-config-routing",
        text: "Detroit",
      },
      storage,
      config,
    );

    expect(secondReply.stage).toBe("collect_service_type");
    expect(secondReply.handoffRequired).toBeUndefined();
  });

  it("submits a lead instead of claiming a booked slot", async () => {
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
        text: "jane@example.com",
      },
      storage,
      config,
    );
    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "afternoon",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.leadId).toContain("lead-");
    expect(reply.replyText.toLowerCase()).toContain("dispatch");
    expect(reply.replyText.toLowerCase()).toContain("team member");
  });

  it("persists structured outcome, transcript, stage history, slot exposure, and lead source data", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-1",
        leadSource: "website",
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
        sessionId: "booksmart-analytics-book",
        messageId: "msg-2",
        text: "Sterling Heights",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-3",
        text: "I need recessed lights in my kitchen",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-4",
        text: "123 Main St, Sterling Heights, MI 48313",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-5",
        text: "Jane",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-6",
        text: "jane@example.com",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-7",
        text: "morning",
      },
      storage,
      config,
    );
    const conversation = await storage.getConversation("booksmart-analytics-book");
    const outcome = await storage.getConversationOutcome("booksmart-analytics-book");
    const stages = await storage.listConversationStages("booksmart-analytics-book");
    const messages = await storage.listConversationMessages("booksmart-analytics-book");
    const slots = await storage.listSlotExposures("booksmart-analytics-book");
    const leadSource = await storage.getLeadSource("website");
    const bookingEvents = await storage.listBookingEvents("booksmart-analytics-book");

    expect(conversation?.leadSource).toBe("website");
    expect(outcome?.bookedYesNo).toBe(true);
    expect(outcome?.availabilityShown).toBe(false);
    expect(outcome?.slotSelected).toBe(false);
    expect(outcome?.slotsShownCount).toBe(0);
    expect(stages.map((stage) => stage.stage)).toEqual(
      expect.arrayContaining([
        "started",
        "city_collected",
        "service_identified",
        "address_collected",
        "contact_collected",
        "lead_submitted",
      ]),
    );
    expect(messages.some((message) => message.direction === "inbound")).toBe(true);
    expect(messages.some((message) => message.direction === "outbound")).toBe(true);
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(true);
    expect(slots).toHaveLength(0);
    expect(leadSource?.code).toBe("website");
    expect(bookingEvents).toHaveLength(1);
  });

  it("asks for email before submitting the lead when email is missing", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-email",
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
        sessionId: "booksmart-chat-email",
        text: "Sterling Heights",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-email",
        text: "I need a breaker checked",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-email",
        text: "123 Main St, Sterling Heights, MI 48313",
      },
      storage,
      config,
    );
    const emailPrompt = await handleChatMessage(
      {
        sessionId: "booksmart-chat-email",
        text: "Jane",
      },
      storage,
      config,
    );

    expect(emailPrompt.stage).toBe("collect_email");
    expect(emailPrompt.replyText.toLowerCase()).toContain("best email");
  });

  it("records urgency hits and handoff outcomes for urgent flows", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-urgent",
        leadSource: "after_hours_text",
        text: "hello",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-urgent",
        text: "Troy",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-urgent",
        text: "I have a burning smell and sparks near the panel",
      },
      storage,
      config,
    );

    const outcome = await storage.getConversationOutcome("booksmart-analytics-urgent");
    const urgencyHits = await storage.listUrgencyKeywordHits("booksmart-analytics-urgent");
    const handoffEvents = await storage.listHandoffEvents("booksmart-analytics-urgent");

    expect(outcome?.handoffYesNo).toBe(true);
    expect(outcome?.urgencyLevel).toBe("urgent");
    expect(urgencyHits.map((hit) => hit.keywordDetected)).toContain("burning smell");
    expect(handoffEvents[0]?.reason).toBe("urgent");
  });
});
