import { describe, expect, it } from "vitest";
import handler from "../api/public/chat.js";

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

describe("public chat api", () => {
  it("accepts browser chat messages without webhook auth and returns a reply", async () => {
    const req = {
      method: "POST",
      headers: {},
      body: {
        sessionId: "public-chat-1",
        text: "hello",
      },
    };

    const res = createResponseRecorder();
    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.success).toBe(true);
    expect(payload.sessionId).toBe("public-chat-1");
    expect(payload.replyText).toContain("What’s going on?");
  });
});
