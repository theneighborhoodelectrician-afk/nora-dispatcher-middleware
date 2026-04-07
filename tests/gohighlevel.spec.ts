import { describe, expect, it } from "vitest";
import { verifyWebhookAuth, verifyWebhookSignature } from "../src/integrations/gohighlevel.js";
import crypto from "node:crypto";

describe("GoHighLevel webhook auth", () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "top-secret";

  it("accepts a valid HMAC signature", () => {
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(
      verifyWebhookAuth({
        rawBody: body,
        providedSignature: signature,
        secret,
      }),
    ).toBe(true);
  });

  it("accepts a direct shared secret header", () => {
    expect(
      verifyWebhookAuth({
        rawBody: body,
        providedSecret: secret,
        secret,
      }),
    ).toBe(true);
  });

  it("rejects invalid credentials", () => {
    expect(
      verifyWebhookAuth({
        rawBody: body,
        providedSignature: "bad-signature",
        providedSecret: "wrong-secret",
        secret,
      }),
    ).toBe(false);
  });
});
