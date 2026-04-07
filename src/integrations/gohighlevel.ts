import crypto from "node:crypto";

export function verifyWebhookSignature(
  rawBody: string,
  providedSignature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) {
    return true;
  }
  if (!providedSignature) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSignature));
}
