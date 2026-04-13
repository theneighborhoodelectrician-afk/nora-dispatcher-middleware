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
  blooio: {
    baseUrl: "https://backend.blooio.com/v2/api",
  },
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

  it("opens with a more natural first text when the customer starts with a greeting", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-city",
        text: "hello",
        contact: {
          phone: "555-111-2222",
        },
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText).toContain("what’s up?");
  });

  it("asks a natural follow-up when the customer only gives a vague request", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-vague-help-request",
        text: "I'd like to get an electrician over to the job",
        contact: {
          phone: "555-111-2323",
        },
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText.toLowerCase()).toContain("what’s going on?");
  });

  it("does not treat repeated greetings as the service description", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-repeated-greetings-service";

    const firstReply = await handleChatMessage(
      {
        sessionId,
        text: "hey",
        contact: {
          phone: "555-121-0001",
        },
      },
      storage,
      config,
    );

    const secondReply = await handleChatMessage(
      {
        sessionId,
        text: "hey",
      },
      storage,
      config,
    );

    expect(firstReply.stage).toBe("collect_service_type");
    expect(secondReply.stage).toBe("collect_service_type");
    expect(secondReply.replyText.toLowerCase()).toContain("what’s up?");
  });

  it("does not treat repeated greetings as the city", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-repeated-greetings-city";

    await handleChatMessage(
      {
        sessionId,
        text: "need recessed lights",
        contact: {
          phone: "555-121-0002",
        },
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId,
        text: "hey",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_city");
    expect(reply.replyText.toLowerCase()).toContain("city?");
  });

  it("answers a common question briefly and then pivots back to booking", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-faq-area",
        text: "Do you service my area?",
        contact: {
          phone: "555-111-3333",
        },
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_city");
    expect(reply.replyText.toLowerCase()).toContain("macomb and oakland county");
    expect(reply.replyText.toLowerCase()).toContain("city?");
  });

  it("lets the customer ask questions first without forcing intake immediately", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-questions-first",
        text: "I'd like to ask some questions first",
        contact: {
          phone: "555-111-5656",
        },
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_city");
    expect(reply.replyText.toLowerCase()).toContain("ask away");
    expect(reply.replyText.toLowerCase()).not.toContain("city?");
  });

  it("responds naturally when the customer pushes back on the questions", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-pushback-questions",
        text: "Is that all you can ask me?",
        contact: {
          phone: "555-111-5757",
        },
      },
      storage,
      config,
    );

    expect(reply.replyText.toLowerCase()).toContain("ask whatever you want");
    expect(reply.replyText.toLowerCase()).not.toContain("city?");
  });

  it("does not treat an unknown question like the city while waiting on city", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-question-not-city";

    await handleChatMessage(
      {
        sessionId,
        text: "hello",
        contact: {
          phone: "555-111-5858",
        },
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId,
        text: "How long have you guys been in business?",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText.toLowerCase()).toContain("not totally sure on that one over text");
    expect(reply.replyText.toLowerCase()).not.toContain("need to check that area first");
  });

  it("handles a storm-related question briefly and then moves back toward scheduling", async () => {
    const storage = new MemoryStorageAdapter();

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-faq-storm",
        text: "What should I check before a storm?",
        contact: {
          phone: "555-111-4444",
        },
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_city");
    expect(reply.replyText.toLowerCase()).toContain("mast");
    expect(reply.replyText.toLowerCase()).toContain("city?");
  });

  it("starts a fresh intake after a completed lead instead of reusing the closed session", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-restart-after-lead";

    await handleChatMessage(
      {
        sessionId,
        text: "I need a panel upgrade",
        contact: {
          phone: "586-111-2222",
        },
      },
      storage,
      config,
    );
    await handleChatMessage({ sessionId, text: "Shelby Township" }, storage, config);
    await handleChatMessage({ sessionId, text: "53617 Oak Grove" }, storage, config);
    await handleChatMessage({ sessionId, text: "48315" }, storage, config);
    await handleChatMessage({ sessionId, text: "Nate" }, storage, config);
    await handleChatMessage({ sessionId, text: "nate@example.com" }, storage, config);
    const leadReply = await handleChatMessage({ sessionId, text: "morning" }, storage, config);

    expect(leadReply.stage).toBe("lead_submitted");

    const restartReply = await handleChatMessage(
      {
        sessionId,
        text: "I'd like to get an electrician over to the job",
        contact: {
          phone: "586-111-2222",
        },
      },
      storage,
      config,
    );

    expect(restartReply.stage).toBe("collect_service_type");
    expect(restartReply.replyText.toLowerCase()).toContain("what’s going on?");
    expect(restartReply.replyText.toLowerCase()).not.toContain("i'll get it on the calendar asap");
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
        text: "I need recessed lights in my kitchen",
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
    expect(emailReply.replyText.toLowerCase()).toContain("morning or afternoon");

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
    expect(reply.replyText.toLowerCase()).toContain("i'll get it on the calendar asap");
    expect(reply.replyText).toContain("586-489-1504");
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
        preferredWindow: "morning",
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
        text: "Sounds good",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.leadId).toContain("lead-");
    expect(reply.replyText.toLowerCase()).toContain("i'll get it on the calendar asap");

    const messages = await storage.listConversationMessages("booksmart-ai-slots");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(true);
  });

  it("uses the OpenAI answer layer for broader customer questions while keeping booking in control", async () => {
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

    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: "resp_answer_1",
        output_text: "not sure on the exact number over text. want to get it scheduled?",
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-answer-layer",
        text: "How long have you guys been in business?",
        contact: {
          phone: "555-111-4545",
        },
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("collect_city");
    expect(reply.replyText.toLowerCase()).toContain("want to get it scheduled");

    const messages = await storage.listConversationMessages("booksmart-ai-answer-layer");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "openai_answer_layer")).toBe(true);
  });

  it("keeps simple structured intake deterministic even when OpenAI is enabled", async () => {
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

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-city",
        text: "Sterling Heights",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText.toLowerCase()).toContain("what’s up?");

    const storedSession = await storage.getChatSession<ChatSessionState>("booksmart-ai-city");
    expect(storedSession?.payload.customer.city).toBe("Sterling Heights");

    const stages = await storage.listConversationStages("booksmart-ai-city");
    expect(stages.some((stage) => stage.stage === "city_collected")).toBe(true);

    const messages = await storage.listConversationMessages("booksmart-ai-city");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "update_conversation_state")).toBe(false);
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
    expect(reply.replyText.toLowerCase()).toContain("i'll get it on the calendar asap");
    expect(reply.replyText).toContain("586-489-1504");

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

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "I need an electrician",
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
    expect(reply.replyText.toLowerCase()).toContain("need to check that area first");
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
        openingQuestion: "hey - what’s up?",
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

    expect(firstReply.replyText).toContain("hey - what’s up?");

    const secondReply = await handleChatMessage(
      {
        sessionId: "booksmart-config-routing",
        text: "I need an electrician",
      },
      storage,
      config,
    );

    expect(secondReply.stage).toBe("collect_service_type");
    expect(secondReply.handoffRequired).toBeUndefined();

    const thirdReply = await handleChatMessage(
      {
        sessionId: "booksmart-config-routing",
        text: "Detroit",
      },
      storage,
      config,
    );

    expect(thirdReply.stage).toBe("collect_service_type");
    expect(thirdReply.handoffRequired).toBeUndefined();
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
        text: "I need a breaker that keeps tripping checked out",
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
    expect(reply.replyText.toLowerCase()).toContain("i'll get it on the calendar asap");
    expect(reply.replyText).toContain("586-489-1504");
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
        text: "I need recessed lights in my kitchen",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-3",
        text: "Sterling Heights",
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
        text: "I need a breaker checked",
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
    expect(emailPrompt.replyText.toLowerCase()).toContain("email? or skip it.");
  });

  it("does not set a preferred window until the customer explicitly answers that question", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "hello",
        contact: {
          phone: "555-333-4444",
        },
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "Need a new panel",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "Shelby Township",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "53617 Oak Grove, Shelby Township, MI 48315",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "Nate",
      },
      storage,
      config,
    );

    const emailPrompt = await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "skip",
      },
      storage,
      config,
    );

    expect(emailPrompt.stage).toBe("collect_preferred_window");
    expect(emailPrompt.replyText.toLowerCase()).toContain("morning or afternoon");

    const session = await storage.getChatSession<ChatSessionState>("booksmart-chat-window");
    expect(session?.payload.customer.preferredWindow).toBeUndefined();
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
