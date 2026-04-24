import { VercelRequest, VercelResponse } from "@vercel/node";
import { isAdminAuthorized } from "../../src/admin/auth.js";
import { getConfig } from "../../src/config.js";
import { sendError, sendJson } from "../../src/lib/response.js";
import { getStorageAdapter, prepareStorage } from "../../src/storage/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const config = getConfig();
  if (!isAdminAuthorized(req, config)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const { sessionId } = (req.body ?? {}) as { sessionId?: string };
  if (!sessionId) {
    sendJson(res, 400, { error: "sessionId required" });
    return;
  }

  try {
    await prepareStorage(config);
    const storage = getStorageAdapter(config);
    await storage.deleteChatSession(sessionId);
    sendJson(res, 200, { success: true, sessionId });
  } catch (error) {
    sendError(res, error);
  }
}
