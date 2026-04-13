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
  const normalizedSignature = extractSignatureValue(providedSignature);
  if (!normalizedSignature || normalizedSignature.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalizedSignature));
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

function extractSignatureValue(signature: string): string | undefined {
  const trimmed = signature.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.includes("=")) {
    return trimmed;
  }

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const v1Part = parts.find((part) => part.startsWith("v1="));
  return v1Part ? v1Part.slice(3) : undefined;
}
