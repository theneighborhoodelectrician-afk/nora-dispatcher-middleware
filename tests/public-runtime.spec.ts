import { describe, expect, it } from "vitest";
import handler from "../api/public/runtime.js";

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

describe("public runtime api", () => {
  it("returns basic runtime information for public pages", async () => {
    const originalPhone = process.env.HUMAN_HANDOFF_PHONE;
    process.env.HUMAN_HANDOFF_PHONE = "586-489-1504";

    const req = {
      method: "GET",
      headers: {},
      body: {},
    };

    const res = createResponseRecorder();
    try {
      await handler(req as never, res as never);

      expect(res.statusCode).toBe(200);
      const payload = JSON.parse(res.body);
      expect(payload.success).toBe(true);
      expect(typeof payload.environment).toBe("string");
      expect(typeof payload.storageMode).toBe("string");
      expect(typeof payload.openAiEnabled).toBe("boolean");
      expect(typeof payload.adminProtected).toBe("boolean");
      expect(payload.humanHandoffPhone).toBe("586-489-1504");
      expect(payload.humanHandoffHref).toBe("sms:+15864891504");
      expect(payload.humanHandoffCallHref).toBe("tel:+15864891504");
      expect(payload.humanHandoffSmsHref).toBe("sms:+15864891504");
    } finally {
      if (originalPhone === undefined) {
        delete process.env.HUMAN_HANDOFF_PHONE;
      } else {
        process.env.HUMAN_HANDOFF_PHONE = originalPhone;
      }
    }
  });
});
