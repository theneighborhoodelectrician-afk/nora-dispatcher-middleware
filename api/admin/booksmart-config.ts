import { VercelRequest, VercelResponse } from "@vercel/node";
import { isAdminAuthorized } from "../../src/admin/auth.js";
import { getConfig } from "../../src/config.js";
import { loadBookSmartConfig, saveBookSmartConfig, seedBookSmartConfig } from "../../src/booksmart/storage.js";
import { sendError, sendJson } from "../../src/lib/response.js";
import { getStorageAdapter, prepareStorage } from "../../src/storage/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getConfig();
  if (!isAdminAuthorized(req, config)) {
    sendJson(res, 401, { success: false, message: "Invalid admin secret." });
    return;
  }

  if (req.method !== "GET" && req.method !== "PUT") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  try {
    await prepareStorage(config);
    const storage = getStorageAdapter(config);

    if (req.method === "GET") {
      const current = await seedBookSmartConfig(storage);
      sendJson(res, 200, {
        success: true,
        config: current,
      });
      return;
    }

    const saved = await saveBookSmartConfig(storage, req.body);
    const merged = await loadBookSmartConfig(storage);
    sendJson(res, 200, {
      success: true,
      config: merged,
      savedConfig: saved,
    });
  } catch (error) {
    sendError(res, error);
  }
}
