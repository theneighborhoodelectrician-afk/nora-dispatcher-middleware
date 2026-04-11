import { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig } from "../../src/config.js";
import { sendError, sendJson } from "../../src/lib/response.js";
import { handleChatMessage } from "../../src/services/chatbot.js";
import { getStorageAdapter, prepareStorage } from "../../src/storage/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  try {
    const config = getConfig();
    await prepareStorage(config);
    const storage = getStorageAdapter(config);
    const body = {
      ...((req.body ?? {}) as Record<string, unknown>),
      leadSource:
        typeof req.body?.leadSource === "string" && req.body.leadSource.trim().length
          ? req.body.leadSource
          : "website",
      source: "website",
    };

    const reply = await handleChatMessage(body, storage, config);
    sendJson(res, 200, reply);
  } catch (error) {
    sendError(res, error);
  }
}
