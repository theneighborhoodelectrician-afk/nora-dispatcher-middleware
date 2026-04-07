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
  if (providedSignature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedSignature));
}

export function verifyWebhookAuth(input: {
  rawBody: string;
  providedSignature?: string;
  providedSecret?: string;
  secret?: string;
}): boolean {
  if (!input.secret) {
    return true;
  }

  if (input.providedSecret && input.providedSecret === input.secret) {
    return true;
  }

  return verifyWebhookSignature(input.rawBody, input.providedSignature, input.secret);
}
