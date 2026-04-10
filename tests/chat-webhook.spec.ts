import { describe, expect, it } from "vitest";
import handler from "../api/webhooks/chat.js";

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
});
