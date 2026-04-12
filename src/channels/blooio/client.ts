import { AppConfig } from "../../config.js";

export interface SendBlooioMessageInput {
  chatId: string;
  text: string;
  idempotencyKey?: string;
}

export async function sendBlooioMessage(
  input: SendBlooioMessageInput,
  config: AppConfig,
): Promise<{ status: number; ok: boolean }> {
  if (!config.blooio.apiKey) {
    throw new Error("Missing BLOOIO_API_KEY");
  }

  const chatId = normalizeChatId(input.chatId);
  if (!chatId) {
    throw new Error("Missing Blooio chat id");
  }

  const response = await fetch(`${config.blooio.baseUrl}/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.blooio.apiKey}`,
      "Content-Type": "application/json",
      ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      text: input.text,
      ...(config.blooio.fromNumber ? { from_number: config.blooio.fromNumber } : {}),
      use_typing_indicator: true,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Blooio send failed (${response.status}): ${details || "unknown error"}`);
  }

  return {
    status: response.status,
    ok: response.ok,
  };
}

function normalizeChatId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("@") || trimmed.startsWith("grp_")) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length > 10) {
    return `+${digits}`;
  }
  return trimmed;
}
