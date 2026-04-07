import { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig } from "../../src/config.js";
import { verifyWebhookAuth } from "../../src/integrations/gohighlevel.js";
import { HousecallProClient } from "../../src/integrations/housecallPro.js";
import { parseAvailabilityRequest } from "../../src/lib/requestParsing.js";
import { sendError, sendJson } from "../../src/lib/response.js";
import { getAvailability } from "../../src/services/availability.js";
import { getStorageAdapter, prepareStorage } from "../../src/storage/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  const config = getConfig();
  await prepareStorage(config);
  const storage = getStorageAdapter(config);
  await storage.cleanupIdempotency();
  const rawBody = JSON.stringify(req.body ?? {});
  const providedSignature = req.headers["x-nora-signature"];
  const providedSecret = req.headers["x-nora-secret"];

  if (
    !verifyWebhookAuth({
      rawBody,
      providedSignature: Array.isArray(providedSignature) ? providedSignature[0] : providedSignature,
      providedSecret: Array.isArray(providedSecret) ? providedSecret[0] : providedSecret,
      secret: config.ghl.webhookSecret,
    })
  ) {
    sendJson(res, 401, { success: false, message: "Invalid webhook signature." });
    return;
  }

  try {
    const { request, webhookId } = parseAvailabilityRequest(req.body);
    await storage.logWebhookEvent({
      webhookId,
      kind: "availability",
      phase: "received",
      payload: req.body ?? {},
      createdAt: Date.now(),
    });

    const cached = await storage.getIdempotentResult(webhookId);
    if (cached) {
      await storage.logWebhookEvent({
        webhookId,
        kind: "availability",
        phase: "cached_response",
        payload: cached,
        createdAt: Date.now(),
      });
      sendJson(res, 200, cached);
      return;
    }

    const client = new HousecallProClient(config.hcp);
    const payload = await getAvailability(request, client, config);
    await storage.storeIdempotentResult(webhookId, payload);
    await storage.logWebhookEvent({
      webhookId,
      kind: "availability",
      phase: "processed",
      payload,
      createdAt: Date.now(),
    });
    sendJson(res, 200, payload);
  } catch (error) {
    await storage.logWebhookEvent({
      webhookId: String(req.body?.webhookId ?? req.body?.phone ?? "availability-error"),
      kind: "availability",
      phase: "error",
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      createdAt: Date.now(),
    });
    sendError(res, error);
  }
}
