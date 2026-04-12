import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/webhooks/chat.js";
import { getConfig } from "../src/config.js";
import { getStorageAdapter } from "../src/storage/index.js";

function createResponseRecorder() {
  const response = {
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

  return response;
}

describe("chat webhook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BLOOIO_API_KEY;
    delete process.env.BLOOIO_FROM_NUMBER;
  });

  it("returns the cached response for duplicate message deliveries", async () => {
    const req = {
      method: "POST",
      headers: {},
      body: {
        messageId: "dup-message-1",
        sessionId: "dup-session-1",
        text: "hello",
      },
    };

    const firstRes = createResponseRecorder();
    await handler(req as never, firstRes as never);

    const secondRes = createResponseRecorder();
    await handler(req as never, secondRes as never);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.body).toBe(firstRes.body);
  });

  it("routes Blooio webhook conversations through the shared lead-first tracking flow", async () => {
    const originalToken = process.env.HCP_API_TOKEN;
    delete process.env.HCP_API_TOKEN;

    const sessionId = "blooio-lead-flow-1";
    const messages = [
      {
        messageId: "blooio-msg-1",
        text: "Hello",
        contact: {
          id: "blooio-contact-1",
          phone: "586-555-0100",
        },
      },
      {
        messageId: "blooio-msg-2",
        text: "I need help with an EV charger install",
      },
      {
        messageId: "blooio-msg-3",
        text: "Sterling Heights",
      },
      {
        messageId: "blooio-msg-4",
        text: "123 Main St, Sterling Heights, MI 48313",
      },
      {
        messageId: "blooio-msg-5",
        text: "Jane",
      },
      {
        messageId: "blooio-msg-6",
        text: "jane@example.com",
      },
      {
        messageId: "blooio-msg-7",
        text: "Afternoon works best",
      },
    ];

    let lastPayload: Record<string, unknown> | undefined;

    try {
      for (const message of messages) {
        const req = {
          method: "POST",
          headers: {},
          body: {
            sessionId,
            ...message,
          },
        };
        const res = createResponseRecorder();
        await handler(req as never, res as never);
        expect(res.statusCode).toBe(200);
        lastPayload = JSON.parse(res.body);
      }
    } finally {
      if (originalToken === undefined) {
        delete process.env.HCP_API_TOKEN;
      } else {
        process.env.HCP_API_TOKEN = originalToken;
      }
    }

    expect(lastPayload?.stage).toBe("lead_submitted");
    expect(String(lastPayload?.replyText ?? "").toLowerCase()).toContain("getting you scheduled shortly");

    const storage = getStorageAdapter(getConfig());
    const conversation = await storage.getConversation(sessionId);
    const outcome = await storage.getConversationOutcome(sessionId);
    const bookingEvents = await storage.listBookingEvents(sessionId);
    const leadSource = await storage.getLeadSource("blooio");

    expect(conversation?.leadSource).toBe("blooio");
    expect(outcome?.finalBookingStatus).toBe("lead_submitted");
    expect(outcome?.bookedYesNo).toBe(true);
    expect(bookingEvents).toHaveLength(1);
    expect(leadSource?.code).toBe("blooio");
  });

  it("falls back to a phone-based session id when Blooio does not send one", async () => {
    const req = {
      method: "POST",
      headers: {},
      body: {
        messageId: "blooio-msg-phone-session",
        text: "Hello",
        contact: {
          phone: "(586) 555-0142",
        },
      },
    };

    const res = createResponseRecorder();
    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.sessionId).toBe("phone:5865550142");

    const storage = getStorageAdapter(getConfig());
    const conversation = await storage.getConversation("phone:5865550142");
    expect(conversation?.leadSource).toBe("blooio");
  });

  it("sends the reply back through Blooio when outbound messaging is configured", async () => {
    process.env.BLOOIO_API_KEY = "test-blooio-key";
    process.env.BLOOIO_FROM_NUMBER = "+12488475527";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: vi.fn().mockResolvedValue(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      method: "POST",
      headers: {},
      body: {
        messageId: "blooio-send-1",
        sessionId: "blooio-send-session-1",
        source: "blooio",
        text: "hello",
        contact: {
          phone: "+15865550188",
        },
      },
    };

    const res = createResponseRecorder();
    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://backend.blooio.com/v2/api/chats/%2B15865550188/messages",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer test-blooio-key",
        "Content-Type": "application/json",
        "Idempotency-Key": "reply:blooio-send-1",
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      text: expect.stringContaining("what’s up?"),
      from_number: "+12488475527",
      use_typing_indicator: true,
    });
  });

  it("accepts Blooio's native message.received payload shape", async () => {
    const req = {
      method: "POST",
      headers: {},
      body: {
        event: "message.received",
        message_id: "blo-native-1",
        external_id: "+15864891504",
        protocol: "imessage",
        timestamp: 1776007457528,
        internal_id: "+12488475527",
        is_group: false,
        text: "Hi",
        sender: "+15864891504",
        received_at: 1776007455034,
      },
    };

    const res = createResponseRecorder();
    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.sessionId).toBe("chat:5864891504:2488475527");
    expect(payload.replyText).toContain("what’s up?");
  });

  it("separates native Blooio sessions by customer phone instead of the business number", async () => {
    const firstRes = createResponseRecorder();
    await handler({
      method: "POST",
      headers: {},
      body: {
        event: "message.received",
        message_id: "blo-native-thread-1",
        external_id: "+15864891504",
        protocol: "imessage",
        timestamp: 1776009235791,
        internal_id: "+12488475527",
        is_group: false,
        text: "Hello",
        sender: "+15864891504",
        received_at: 1776009232569,
      },
    } as never, firstRes as never);

    const secondRes = createResponseRecorder();
    await handler({
      method: "POST",
      headers: {},
      body: {
        event: "message.received",
        message_id: "blo-native-thread-2",
        external_id: "+12487700169",
        protocol: "imessage",
        timestamp: 1776009236791,
        internal_id: "+12488475527",
        is_group: false,
        text: "Hello",
        sender: "+12487700169",
        received_at: 1776009233569,
      },
    } as never, secondRes as never);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);

    const firstPayload = JSON.parse(firstRes.body);
    const secondPayload = JSON.parse(secondRes.body);

    expect(firstPayload.sessionId).toBe("chat:5864891504:2488475527");
    expect(secondPayload.sessionId).toBe("chat:2487700169:2488475527");
    expect(firstPayload.sessionId).not.toBe(secondPayload.sessionId);
  });

  it("accepts Blooio native org webhook events without a shared-secret header", async () => {
    const originalSecret = process.env.BLOOIO_WEBHOOK_SECRET;
    process.env.BLOOIO_WEBHOOK_SECRET = "whsec_launch_override";

    try {
      const req = {
        method: "POST",
        headers: {},
        body: {
          event: "message.received",
          message_id: "blo-native-no-header-1",
          external_id: "+15864891504",
          protocol: "imessage",
          timestamp: 1776009235791,
          internal_id: "+12488475527",
          is_group: false,
          text: "Hello",
          sender: "+15864891504",
          received_at: 1776009232569,
        },
      };

      const res = createResponseRecorder();
      await handler(req as never, res as never);

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.body);
      expect(payload.success).toBe(true);
      expect(typeof payload.replyText).toBe("string");
    } finally {
      if (originalSecret === undefined) {
        delete process.env.BLOOIO_WEBHOOK_SECRET;
      } else {
        process.env.BLOOIO_WEBHOOK_SECRET = originalSecret;
      }
    }
  });
});
