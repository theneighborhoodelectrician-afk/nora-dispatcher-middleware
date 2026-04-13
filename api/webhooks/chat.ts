import { VercelRequest, VercelResponse } from "@vercel/node";
import { sendBlooioMessage } from "../../src/channels/blooio/client.js";
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
  const bodyRecord = ((req.body ?? {}) as Record<string, unknown>);
  const blooioEvent = typeof bodyRecord.event === "string" ? bodyRecord.event : "";
  const isNativeBlooioMessageReceivedEvent =
    blooioEvent === "message.received" &&
    typeof bodyRecord.message_id === "string" &&
    typeof bodyRecord.external_id === "string" &&
    typeof bodyRecord.internal_id === "string";
  const isBlooioStatusEvent =
    blooioEvent === "message.read" ||
    blooioEvent === "message.delivered" ||
    blooioEvent === "message.sent";

  if (isBlooioStatusEvent) {
    sendJson(res, 200, {
      success: true,
      ignored: true,
      event: blooioEvent,
    });
    return;
  }

  if (
    !isNativeBlooioMessageReceivedEvent &&
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
      req.body?.message_id ??
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
      ...bodyRecord,
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
    if (body.source === "blooio" && config.blooio.apiKey) {
      const normalized = normalizeBlooioInboundPayload(body);
      const chatId =
        normalized.contact?.phone ??
        normalized.customer?.phone ??
        normalized.sessionId;

      if (chatId) {
        try {
          console.log("[blooio] outbound_send_attempt", {
            webhookId,
            chatId,
            stage: reply.stage,
            hasApiKey: Boolean(config.blooio.apiKey),
            fromNumber: config.blooio.fromNumber,
          });
          await sendBlooioMessage(
            {
              chatId,
              text: reply.replyText,
              idempotencyKey: `reply:${webhookId}`,
            },
            config,
          );
          await storage.logWebhookEvent({
            webhookId,
            kind: "chat",
            phase: "outbound_sent",
            payload: {
              chatId,
              stage: reply.stage,
            },
            createdAt: Date.now(),
          });
          console.log("[blooio] outbound_send_success", {
            webhookId,
            chatId,
            stage: reply.stage,
          });
        } catch (outboundError) {
          console.error("[blooio] outbound_send_error", {
            webhookId,
            chatId,
            error: outboundError instanceof Error ? outboundError.message : String(outboundError),
          });
          await storage.logWebhookEvent({
            webhookId,
            kind: "chat",
            phase: "outbound_error",
            payload: {
              chatId,
              error: outboundError instanceof Error ? outboundError.message : String(outboundError),
            },
            createdAt: Date.now(),
          });
        }
      }
    }
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
