import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BOOKSMART_CONFIG } from "../src/booksmart/defaultConfig.js";
import { createInitialAnalytics } from "../src/conversations/tracking.js";
import { AppConfig } from "../src/config.js";
import { buildBookSmartSystemPrompt } from "../src/prompts/booksmartSystemPrompt.js";
import { ChatSessionState, handleChatMessage } from "../src/services/chatbot.js";
import { MemoryStorageAdapter } from "../src/storage/memory.js";
import * as booksmartTools from "../src/tools/booksmart.js";
import * as hcpIntegration from "../src/integrations/housecallPro.js";

const config: AppConfig = {
  environment: "test",
  contact: {
    humanHandoffPhone: "586-489-1504",
    humanHandoffHref: "sms:+15864891504",
    humanHandoffCallHref: "tel:+15864891504",
    humanHandoffSmsHref: "sms:+15864891504",
  },
  scheduling: {
    timezone: "America/Detroit",
    openingHour: 9,
    closingHour: 18,
    defaultSlotCount: 3,
    maxLookaheadDays: 5,
    maxLookaheadTotalDays: 60,
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
  booking: {},
  leadOnlyLaunch: false,
};

describe("BookSmart chat flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T16:00:00.000Z"));
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

    expect(reply.stage).toBe("collect_name");
    expect(reply.replyText.toLowerCase()).toMatch(/first name|who am i speaking/);
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

    expect(reply.stage).toBe("collect_name");
    expect(reply.replyText.toLowerCase()).toMatch(/first name|who am i speaking/);
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

    expect(firstReply.stage).toBe("collect_name");
    expect(secondReply.stage).toBe("collect_name");
    expect(secondReply.replyText.toLowerCase()).toMatch(/first name|who am i speaking/);
  });

  it("does not treat repeated greetings as the city", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-repeated-greetings-city";

    await handleChatMessage(
      {
        sessionId,
        text: "Pat",
        contact: {
          phone: "555-121-0002",
        },
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId,
        text: "need recessed lights",
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

    expect(reply.stage).toBe("collect_address");
    expect(reply.replyText.toLowerCase()).toContain("address?");
  });

  it("answers a common question briefly and then pivots back to booking", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-faq-area";

    await handleChatMessage(
      {
        sessionId,
        text: "Pat",
        contact: {
          phone: "555-111-3333",
        },
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId,
        text: "Do you service my area?",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText.toLowerCase()).toContain("macomb and oakland county");
    expect(reply.replyText.toLowerCase()).toContain("what’s going on?");
  });

  it("recognizes a returning customer by phone and greets them by name", async () => {
    const storage = new MemoryStorageAdapter();
    const lookupSpy = vi.spyOn(hcpIntegration, "lookupCustomerByPhone").mockResolvedValue({
      found: true,
      firstName: "Nate",
      address: "53617 Oak Grove",
      city: "Shelby Charter Township",
      zipCode: "48315",
      email: "nate@example.com",
    });

    const firstReply = await handleChatMessage(
      {
        sessionId: "booksmart-returning-1",
        text: "hello",
        contact: {
          phone: "586-555-1212",
        },
      },
      storage,
      config,
    );

    expect(firstReply.stage).toBe("confirm_returning_address");
    expect(firstReply.replyText).toContain("Nate");
    expect(firstReply.replyText).toContain("53617 Oak Grove");

    lookupSpy.mockRestore();
  });

  it("skips duplicate contact questions for a returning customer after address confirmation", async () => {
    const storage = new MemoryStorageAdapter();
    const lookupSpy = vi.spyOn(hcpIntegration, "lookupCustomerByPhone").mockResolvedValue({
      found: true,
      firstName: "Nate",
      address: "53617 Oak Grove",
      city: "Shelby Charter Township",
      zipCode: "48315",
      email: "nate@example.com",
    });
    const sessionId = "booksmart-returning-2";

    await handleChatMessage(
      {
        sessionId,
        text: "hello",
        contact: {
          phone: "586-555-9898",
        },
      },
      storage,
      config,
    );

    const confirmReply = await handleChatMessage(
      {
        sessionId,
        text: "yes",
      },
      storage,
      config,
    );

    expect(confirmReply.stage).toBe("collect_service_type");
    expect(confirmReply.replyText.toLowerCase()).toContain("what can we help with this time");

    const serviceReply = await handleChatMessage(
      {
        sessionId,
        text: "Need two outdoor outlets added",
      },
      storage,
      config,
    );

    expect(serviceReply.stage).toBe("collect_preferred_window");
    expect(serviceReply.replyText.toLowerCase()).toContain("morning or afternoon");

    const notesPrompt = await handleChatMessage(
      {
        sessionId,
        text: "morning",
      },
      storage,
      config,
    );

    expect(notesPrompt.stage).toBe("collect_job_notes");
    expect(notesPrompt.replyText.toLowerCase()).toContain("tech should know");

    const storedSession = await storage.getChatSession<ChatSessionState>(sessionId);
    expect(storedSession?.payload.customer.firstName).toBe("Nate");
    expect(storedSession?.payload.customer.email).toBe("nate@example.com");
    expect(storedSession?.payload.customer.phone).toBe("586-555-9898");
    expect(storedSession?.payload.customer.address).toBe("53617 Oak Grove");
    expect(storedSession?.payload.customer.zipCode).toBe("48315");

    lookupSpy.mockRestore();
  });

  it("lets the customer ask questions first without forcing intake immediately", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-questions-first";

    await handleChatMessage(
      {
        sessionId,
        text: "Sky",
        contact: {
          phone: "555-111-5656",
        },
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId,
        text: "I'd like to ask some questions first",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText.toLowerCase()).toContain("ask away");
    expect(reply.replyText.toLowerCase()).not.toContain("city?");
  });

  it("responds naturally when the customer pushes back on the questions", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-pushback-questions";

    await handleChatMessage(
      {
        sessionId,
        text: "Rae",
        contact: {
          phone: "555-111-5757",
        },
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId,
        text: "Is that all you can ask me?",
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

    await handleChatMessage(
      {
        sessionId,
        text: "Morgan",
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
    const sessionId = "booksmart-faq-storm";

    await handleChatMessage(
      {
        sessionId,
        text: "Chris",
        contact: {
          phone: "555-111-4444",
        },
      },
      storage,
      config,
    );

    const reply = await handleChatMessage(
      {
        sessionId,
        text: "What should I check before a storm?",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("collect_service_type");
    expect(reply.replyText.toLowerCase()).toContain("mast");
    expect(reply.replyText.toLowerCase()).toContain("what’s going on?");
  });

  it("starts a fresh intake after a completed lead instead of reusing the closed session", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-restart-after-lead";

    await handleChatMessage(
      {
        sessionId,
        text: "hello",
        contact: {
          phone: "586-111-2222",
        },
      },
      storage,
      config,
    );
    await handleChatMessage({ sessionId, text: "Nate" }, storage, config);
    await handleChatMessage({ sessionId, text: "I need a panel upgrade" }, storage, config);
    await handleChatMessage(
      { sessionId, text: "Oak Grove Dr, Shelby Charter Township" },
      storage,
      config,
    );
    await handleChatMessage({ sessionId, text: "48315" }, storage, config);
    await handleChatMessage({ sessionId, text: "nate@example.com" }, storage, config);
    const notesPrompt = await handleChatMessage({ sessionId, text: "morning" }, storage, config);
    expect(notesPrompt.stage).toBe("collect_job_notes");
    expect(notesPrompt.replyText.toLowerCase()).toContain("tech should know");

    const leadReply = await handleChatMessage({ sessionId, text: "panel is in the basement" }, storage, config);

    expect(leadReply.stage).toBe("lead_submitted");
    expect(leadReply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");

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

    expect(restartReply.stage).toBe("collect_name");
    expect(restartReply.replyText.toLowerCase()).toMatch(/first name|who am i speaking/);
    expect(restartReply.replyText.toLowerCase()).not.toContain("i'll get it on the calendar asap");
  });

  it("starts a fresh intake after a lead is submitted even when OpenAI is enabled", async () => {
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
    const sessionId = "booksmart-follow-up-after-lead";

    await handleChatMessage(
      {
        sessionId,
        text: "hello",
        contact: {
          phone: "586-222-3333",
        },
      },
      storage,
      aiConfig,
    );
    await handleChatMessage({ sessionId, text: "Brad" }, storage, aiConfig);
    await handleChatMessage({ sessionId, text: "flickering lights" }, storage, aiConfig);
    await handleChatMessage(
      { sessionId, text: "N Garfield Ave, Fraser" },
      storage,
      aiConfig,
    );
    await handleChatMessage({ sessionId, text: "48026" }, storage, aiConfig);
    await handleChatMessage({ sessionId, text: "Brad Mumma" }, storage, aiConfig);
    await handleChatMessage({ sessionId, text: "brad@example.com" }, storage, aiConfig);
    const notesPrompt = await handleChatMessage({ sessionId, text: "morning" }, storage, aiConfig);
    expect(notesPrompt.stage).toBe("collect_job_notes");

    const leadReply = await handleChatMessage({ sessionId, text: "no" }, storage, aiConfig);
    expect(leadReply.stage).toBe("lead_submitted");

    const followUpReply = await handleChatMessage(
      {
        sessionId,
        text: "When will I know when you are coming?",
      },
      storage,
      aiConfig,
    );

    expect(followUpReply.stage).toBe("lead_submitted");
    expect(followUpReply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");

    const storedSession = await storage.getChatSession<ChatSessionState>(sessionId);
    expect(storedSession?.payload.customer.city).toBe("Fraser");
    expect(storedSession?.payload.customer.address).toBe("N Garfield Ave, Fraser");
    expect(storedSession?.payload.customer.zipCode).toBe("48026");
    expect(storedSession?.payload.bookingStatus).toBe("lead_submitted");
  });

  it("asks for one short tech note before submitting the lead", async () => {
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
        text: "Jane",
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
        text: "123 Main St, Sterling Heights",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "48313",
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

    const notesPrompt = await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "Morning works best",
      },
      storage,
      config,
    );

    expect(notesPrompt.stage).toBe("collect_job_notes");
    expect(notesPrompt.replyText.toLowerCase()).toContain("tech should know");

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-slots",
        text: "kitchen cans, attic access is through the hallway",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");
  });

  it("submits a lead through the OpenAI runtime path after capturing a short tech note", async () => {
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

    const getAvailabilitySpy = vi.spyOn(booksmartTools, "getAvailabilityTool").mockResolvedValue({
      success: false,
      status: "human_escalation_required",
      message: "No online slots; submit lead",
      service: {
        category: "generic-electrical",
        title: "Test",
        durationMinutes: 60,
        requiredSkills: [],
        preferredSkills: [],
        target: "job",
        complexityScore: 1,
      },
      slots: [],
      presentation: { replyText: "Dispatch will follow up." },
    } as Awaited<ReturnType<typeof booksmartTools.getAvailabilityTool>>);

    const sessionState: ChatSessionState = {
      sessionId: "booksmart-ai-slots",
      stage: "collect_job_notes",
      customer: {
        city: "Sterling Heights",
        requestedService: "Recessed lighting",
        address: "123 Main St",
        zipCode: "48313",
        firstName: "Jane",
        phone: "555-111-2222",
        email: "jane@example.com",
        preferredWindow: "morning",
        notes: "kitchen recessed lights",
      },
      bookingStatus: "collecting",
      techNotesCaptured: true,
      transcript: [],
      analytics: createInitialAnalytics(
        new Date("2026-04-06T16:00:00.000Z").getTime(),
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
    expect(reply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");

    const messages = await storage.listConversationMessages("booksmart-ai-slots");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(true);

    getAvailabilitySpy.mockRestore();
  });

  it("uses the OpenAI conversation path for broader customer questions while keeping booking in control", async () => {
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

    await handleChatMessage(
      {
        sessionId: "booksmart-ai-answer-layer",
        text: "Quinn",
        contact: {
          phone: "555-111-4545",
        },
      },
      storage,
      aiConfig,
    );

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-answer-layer",
        text: "How long have you guys been in business?",
      },
      storage,
      aiConfig,
    );

    expect(reply.replyText.toLowerCase()).toMatch(
      /want to get it scheduled|what’s going on|not totally sure/,
    );
    expect(["collect_name", "collect_service_type"]).toContain(reply.stage);

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

    await handleChatMessage(
      {
        sessionId: "booksmart-ai-city",
        text: "Riley",
        contact: { phone: "555-000-0001" },
      },
      storage,
      aiConfig,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-ai-city",
        text: "I need a broken outlet fixed",
      },
      storage,
      aiConfig,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-ai-city",
        text: "10 Main St, Sterling Heights",
      },
      storage,
      aiConfig,
    );
    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-city",
        text: "48314",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("collect_email");
    expect(reply.replyText.toLowerCase()).toContain("email?");

    const storedSession = await storage.getChatSession<ChatSessionState>("booksmart-ai-city");
    expect(storedSession?.payload.customer.city).toBe("Sterling Heights");
    expect(storedSession?.payload.customer.zipCode).toBe("48314");

    const stages = await storage.listConversationStages("booksmart-ai-city");
    expect(stages.some((stage) => stage.stage === "address_collected")).toBe(true);

    const messages = await storage.listConversationMessages("booksmart-ai-city");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "update_conversation_state")).toBe(false);
  });

  it("does not treat non-address text like a street address", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-invalid-address",
        text: "Nate",
        contact: { phone: "555-000-1000" },
      },
      storage,
      config,
    );

    const serviceReply = await handleChatMessage(
      {
        sessionId: "booksmart-invalid-address",
        text: "I need some new lights installed",
      },
      storage,
      config,
    );

    expect(serviceReply.stage).toBe("collect_address");

    const addressReply = await handleChatMessage(
      {
        sessionId: "booksmart-invalid-address",
        text: "15 years maybe",
      },
      storage,
      config,
    );

    expect(addressReply.stage).toBe("collect_address");
    expect(addressReply.replyText.toLowerCase()).toContain("street address");

    const storedSession = await storage.getChatSession<ChatSessionState>("booksmart-invalid-address");
    expect(storedSession?.payload.customer.address).toBeUndefined();
  });

  it("lets OpenAI capture practical notes after the core booking info is complete", async () => {
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
      sessionId: "booksmart-ai-post-intake-notes",
      stage: "collect_job_notes",
      customer: {
        firstName: "Nate",
        phone: "586-555-1212",
        email: "nate@example.com",
        address: "53617 Oak Grove",
        city: "Shelby Township",
        zipCode: "48315",
        requestedService: "General troubleshooting",
        preferredWindow: "morning",
      },
      bookingStatus: "collecting",
      transcript: [],
      analytics: createInitialAnalytics(
        new Date("2026-04-06T16:00:00.000Z").getTime(),
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
          id: "resp_notes_1",
          output: [
            {
              type: "function_call",
              call_id: "call_notes_1",
              name: "update_conversation_state",
              arguments: JSON.stringify({ notes: "Customer says the ceiling is pretty high." }),
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "resp_notes_2",
          output_text: "got it. i’ve got what i need.",
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-ai-post-intake-notes",
        text: "The ceiling is pretty high",
      },
      storage,
      aiConfig,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");

    const storedSession = await storage.getChatSession<ChatSessionState>("booksmart-ai-post-intake-notes");
    expect(storedSession?.payload.customer.notes).toContain("Customer says the ceiling is pretty high.");

    const messages = await storage.listConversationMessages("booksmart-ai-post-intake-notes");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "update_conversation_state")).toBe(true);
  });

  it("converts legacy offered-slot state into lead submission instead of booking", async () => {
    const storage = new MemoryStorageAdapter();
    const aiConfig: AppConfig = {
      ...config,
      leadOnlyLaunch: true,
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
        notes: "panel is on the back wall in the basement",
      },
      bookingStatus: "offered",
      techNotesCaptured: true,
      lastOfferedOptions,
      transcript: [],
      analytics: createInitialAnalytics(
        new Date("2026-04-06T16:00:00.000Z").getTime(),
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
    expect(reply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");

    const messages = await storage.listConversationMessages("booksmart-ai-book");
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(true);
    // Lead-only with full intake submits from guards before the OpenAI turn (no decision trace in this path).
    expect(messages.some((message) => message.toolName === "openai_decision_trace")).toBe(false);

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

  it("submits a lead when the ZIP is outside the Macomb/Oakland list", async () => {
    const storage = new MemoryStorageAdapter();

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "hello",
        contact: { phone: "555-201-2002" },
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "Alex",
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "I need a GFI in the kitchen that keeps tripping",
      },
      storage,
      config,
    );

    await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "100 Gratiot Ave, Detroit",
      },
      storage,
      config,
    );
    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-area",
        text: "48201",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.replyText.toLowerCase()).toContain("macomb and oakland");
  });

  it("uses stored BookSmart config for the opening line and normal intake", async () => {
    const storage = new MemoryStorageAdapter();
    await storage.storeBookSmartConfig({
      ...DEFAULT_BOOKSMART_CONFIG,
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

    expect(firstReply.replyText.toLowerCase()).toMatch(/first name|who am i speaking/);

    const secondReply = await handleChatMessage(
      {
        sessionId: "booksmart-config-routing",
        text: "Morgan",
      },
      storage,
      config,
    );

    expect(secondReply.stage).toBe("collect_service_type");
    expect(secondReply.replyText.toLowerCase()).toContain("what’s going on");

    const thirdReply = await handleChatMessage(
      {
        sessionId: "booksmart-config-routing",
        text: "Half of my kitchen outlets stopped working",
      },
      storage,
      config,
    );

    expect(thirdReply.stage).toBe("collect_address");
    expect(thirdReply.replyText.toLowerCase()).toContain("address");
    expect(thirdReply.handoffRequired).toBeUndefined();
  });

  it("submits a lead instead of claiming a booking before any exact appointment is confirmed", async () => {
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
        text: "Jane",
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
        text: "123 Main St, Sterling Heights",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "48313",
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
    const notesPrompt = await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "afternoon",
      },
      storage,
      config,
    );

    expect(notesPrompt.stage).toBe("collect_job_notes");
    expect(notesPrompt.replyText.toLowerCase()).toContain("tech should know");

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-chat-book",
        text: "panel is on the back wall in the basement",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");
  });

  it("retires stale offered slots and submits a lead instead of honoring numbered selections", async () => {
    const storage = new MemoryStorageAdapter();
    const createBookingSpy = vi.spyOn(booksmartTools, "createBookingTool");

    const sessionState: ChatSessionState = {
      sessionId: "booksmart-stale-slot-selection",
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
      lastOfferedOptions: [
        {
          label: "Monday, April 6 at 9:00 AM",
          start: "2026-04-06T13:00:00.000Z",
          end: "2026-04-06T17:00:00.000Z",
          technician: "Dave",
          bookingTarget: "job",
        },
        {
          label: "Tuesday, April 7 at 9:00 AM",
          start: "2026-04-07T13:00:00.000Z",
          end: "2026-04-07T17:00:00.000Z",
          technician: "Steve",
          bookingTarget: "job",
        },
        {
          label: "Wednesday, April 8 at 1:00 PM",
          start: "2026-04-08T17:00:00.000Z",
          end: "2026-04-08T21:00:00.000Z",
          technician: "Lou",
          bookingTarget: "job",
        },
      ],
      lastOfferedAt: new Date("2026-04-06T15:00:00.000Z").getTime(),
      transcript: [],
      analytics: createInitialAnalytics(
        new Date("2026-04-06T16:00:00.000Z").getTime(),
        "hello",
        "website",
      ),
    };

    await storage.storeChatSession(sessionState.sessionId, sessionState);

    const reply = await handleChatMessage(
      {
        sessionId: "booksmart-stale-slot-selection",
        text: "2",
      },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    expect(reply.replyText.toLowerCase()).toContain("follow up with the appointment time shortly");
    expect(createBookingSpy).not.toHaveBeenCalled();

    const storedSession = await storage.getChatSession<ChatSessionState>("booksmart-stale-slot-selection");
    expect(storedSession?.payload.lastOfferedOptions).toBeUndefined();
    expect(storedSession?.payload.bookingStatus).toBe("lead_submitted");
  });

  it("keeps the OpenAI system prompt in intake-only mode for booking", () => {
    const prompt = buildBookSmartSystemPrompt(DEFAULT_BOOKSMART_CONFIG);

    expect(prompt).toContain("Jess is an intake assistant only.");
    expect(prompt).toContain('NEVER say "You\'re booked,"');
    expect(prompt).not.toContain("You either book a visit directly in Housecall Pro");
    expect(prompt).not.toContain("About how old is the home?");
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
        text: "Jane",
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
        text: "123 Main St, Sterling Heights",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-5",
        text: "48313",
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
    const notesPrompt = await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-7",
        text: "morning",
      },
      storage,
      config,
    );
    expect(notesPrompt.stage).toBe("collect_job_notes");
    await handleChatMessage(
      {
        sessionId: "booksmart-analytics-book",
        messageId: "msg-8",
        text: "lights are in the kitchen and dining room",
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
        "service_identified",
        "address_collected",
        "contact_collected",
        "photo_requested",
        "lead_submitted",
      ]),
    );
    expect(messages.some((message) => message.direction === "inbound")).toBe(true);
    expect(messages.some((message) => message.direction === "outbound")).toBe(true);
    expect(messages.some((message) => message.direction === "tool" && message.toolName === "create_lead")).toBe(
      true,
    );
    expect(slots.length).toBe(0);
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
        text: "Jane",
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
        text: "123 Main St, Sterling Heights",
      },
      storage,
      config,
    );
    const emailPrompt = await handleChatMessage(
      {
        sessionId: "booksmart-chat-email",
        text: "48313",
      },
      storage,
      config,
    );

    expect(emailPrompt.stage).toBe("collect_email");
    expect(emailPrompt.replyText.toLowerCase()).toContain("email?");
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
        text: "Nate",
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
        text: "Oak Grove Dr, Shelby Charter Township",
      },
      storage,
      config,
    );
    await handleChatMessage(
      {
        sessionId: "booksmart-chat-window",
        text: "48315",
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

  it("stores the final tech note on the session before submitting the lead", async () => {
    const storage = new MemoryStorageAdapter();
    const sessionId = "booksmart-tech-note";

    await handleChatMessage({ sessionId, text: "hello", contact: { phone: "555-777-1111" } }, storage, config);
    await handleChatMessage({ sessionId, text: "Jamie" }, storage, config);
    await handleChatMessage({ sessionId, text: "Need two outdoor outlets added" }, storage, config);
    await handleChatMessage({ sessionId, text: "123 Main St, Sterling Heights" }, storage, config);
    await handleChatMessage({ sessionId, text: "48313" }, storage, config);
    await handleChatMessage({ sessionId, text: "jamie@example.com" }, storage, config);
    const notesPrompt = await handleChatMessage({ sessionId, text: "morning" }, storage, config);

    expect(notesPrompt.stage).toBe("collect_job_notes");

    const reply = await handleChatMessage(
      { sessionId, text: "one is by the patio and there is a dog in the yard" },
      storage,
      config,
    );

    expect(reply.stage).toBe("lead_submitted");
    const stored = await storage.getChatSession<ChatSessionState>(sessionId);
    expect(stored?.payload.customer.notes).toContain("patio");
    expect(stored?.payload.customer.notes).toContain("dog");
    expect(stored?.payload.techNotesCaptured).toBe(true);
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
