import { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeBlooioInboundPayload } from "../../src/channels/blooio/normalize.js";
import { getConfig } from "../../src/config.js";
import { verifyWebhookAuth } from "../../src/integrations/gohighlevel.js";
import { sendError, sendJson } from "../../src/lib/response.js";
import { handleChatMessage } from "../../src/services/chatbot.js";
import { getStorageAdapter, prepareStorage } from "../../src/storage/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  const config = getConfig();
  await prepareStorage(config);
  const storage = getStorageAdapter(config);
  const rawBody = JSON.stringify(req.body ?? {});
  const providedSignature = req.headers["x-nora-signature"];
  const providedSecret =
    req.headers["x-nora-chat-secret"] ??
    req.headers["x-blooio-secret"] ??
    req.headers["x-nora-secret"];

  if (
    !verifyWebhookAuth({
      rawBody,
      providedSignature: Array.isArray(providedSignature) ? providedSignature[0] : providedSignature,
      providedSecret: Array.isArray(providedSecret) ? providedSecret[0] : providedSecret,
      secret: config.blooio.webhookSecret ?? config.ghl.webhookSecret,
    })
  ) {
    sendJson(res, 401, { success: false, message: "Invalid chat webhook signature." });
    return;
  }

  const webhookId = String(
    req.body?.messageId ??
      req.body?.message?.id ??
      req.body?.conversationId ??
      req.body?.threadId ??
      req.body?.sessionId ??
      Date.now(),
  );

  await storage.logWebhookEvent({
    webhookId,
    kind: "chat",
    phase: "received",
    payload: req.body ?? {},
    createdAt: Date.now(),
  });

  try {
    const cached = await storage.getIdempotentResult(webhookId);
    if (cached) {
      await storage.logWebhookEvent({
        webhookId,
        kind: "chat",
        phase: "cached_response",
        payload: cached,
        createdAt: Date.now(),
      });
      sendJson(res, 200, cached);
      return;
    }

    const body = {
      ...((req.body ?? {}) as Record<string, unknown>),
      leadSource:
        typeof req.body?.leadSource === "string" && req.body.leadSource.trim().length
          ? req.body.leadSource
          : typeof req.body?.source === "string" && req.body.source.trim().length
            ? req.body.source
            : "blooio",
      source:
        typeof req.body?.source === "string" && req.body.source.trim().length
          ? req.body.source
          : "blooio",
    };

    const reply = await handleChatMessage(body, storage, config);
    await storage.storeIdempotentResult(webhookId, reply);
    await storage.logWebhookEvent({
      webhookId,
      kind: "chat",
      phase: "processed",
      payload: reply,
      createdAt: Date.now(),
    });
    sendJson(res, 200, reply);
  } catch (error) {
    const normalized = normalizeBlooioInboundPayload((req.body ?? {}) as Record<string, unknown>);
    if (normalized.sessionId) {
      await storage.appendConversationStage({
        conversationId: normalized.sessionId,
        stage: "failed",
        timestamp: Date.now(),
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      }).catch(() => undefined);
    }
    await storage.logWebhookEvent({
      webhookId,
      kind: "chat",
      phase: "error",
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      createdAt: Date.now(),
    });
    sendError(res, error);
  }
}
