import { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig } from "../../src/config.js";
import { sendJson } from "../../src/lib/response.js";
import { getStorageMode } from "../../src/storage/index.js";

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getConfig();

  sendJson(res, 200, {
    success: true,
    environment: config.environment,
    storageMode: getStorageMode(config),
    openAiEnabled: config.openai.enabled,
    adminProtected: Boolean(config.admin.secret),
  });
}
