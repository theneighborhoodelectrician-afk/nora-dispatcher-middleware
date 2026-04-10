import { VercelRequest, VercelResponse } from "@vercel/node";
import { isAdminAuthorized } from "../../src/admin/auth.js";
import { getConfig } from "../../src/config.js";
import { AppError } from "../../src/lib/errors.js";
import { sendError, sendJson } from "../../src/lib/response.js";
import { prepareStorage, getStorageAdapter } from "../../src/storage/index.js";
import { getConversationAdminBundle } from "../../src/conversations/read.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  const config = getConfig();
  if (!isAdminAuthorized(req, config)) {
    sendJson(res, 401, { success: false, message: "Invalid admin secret." });
    return;
  }

  try {
    await prepareStorage(config);
    const storage = getStorageAdapter(config);
    const conversationId = stringQuery(req.query.conversationId);
    const limit = numberQuery(req.query.limit) ?? 50;

    if (conversationId) {
      const bundle = await getConversationAdminBundle(storage, conversationId);
      if (!bundle.conversation && !bundle.outcome) {
        throw new AppError("Conversation not found", 404, "Conversation not found.");
      }

      sendJson(res, 200, {
        success: true,
        conversationId,
        ...bundle,
      });
      return;
    }

    const outcomes = await storage.listConversationOutcomes(limit);
    sendJson(res, 200, {
      success: true,
      count: outcomes.length,
      outcomes,
    });
  } catch (error) {
    sendError(res, error);
  }
}

function stringQuery(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function numberQuery(value: string | string[] | undefined): number | undefined {
  const raw = stringQuery(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
