import { describe, expect, it } from "vitest";
import { normalizeBlooioInboundPayload } from "../src/channels/blooio/normalize.js";

describe("normalizeBlooioInboundPayload", () => {
  it("builds a chat: session id from 10+ digit sender and internal_id (SMS)", () => {
    const out = normalizeBlooioInboundPayload({
      sender: "+15865550100",
      internal_id: "conv-99",
      text: "hello",
    } as Record<string, unknown>);

    expect(out.sessionId).toBe("chat:5865550100:conv-99");
    expect(out.contact?.phone).toBe("+15865550100");
    expect(out.customer?.phone).toBe("+15865550100");
    expect(out.contact?.email).toBeUndefined();
    expect(out.customer?.email).toBeUndefined();
  });

  it("builds a chat: session id from email sender and does not set phone", () => {
    const out = normalizeBlooioInboundPayload({
      sender: "Pat.Smith9@icloud.com",
      internal_id: "th-m1",
      text: "hello",
    } as Record<string, unknown>);

    expect(out.sessionId).toBe("chat:pat.smith9@icloud.com:th-m1");
    expect(out.contact?.phone).toBeUndefined();
    expect(out.customer?.phone).toBeUndefined();
    expect(out.contact?.email).toBe("Pat.Smith9@icloud.com");
    expect(out.customer?.email).toBe("Pat.Smith9@icloud.com");
  });

  it("prefers sender over external_id when classifying the channel", () => {
    const out = normalizeBlooioInboundPayload({
      sender: "+19998887777",
      external_id: "other@me.com",
      internal_id: "a1",
      text: "hi",
    } as Record<string, unknown>);

    expect(out.sessionId).toBe("chat:9998887777:a1");
    expect(out.customer?.phone).toBe("+19998887777");
  });
});
