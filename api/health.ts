import { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig } from "../src/config.js";
import { sendJson } from "../src/lib/response.js";
import { prepareStorage, getStorageMode } from "../src/storage/index.js";

export default async function handler(_req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getConfig();
  const storageMode = getStorageMode(config);
  let schemaReady = false;

  if (storageMode === "postgres") {
    try {
      const result = await prepareStorage(config);
      schemaReady = result.schemaReady;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown storage error";
      sendJson(res, 503, {
        success: false,
        service: "nora-dispatcher-middleware",
        timestamp: new Date().toISOString(),
        storage: {
          mode: storageMode,
          schemaReady: false,
          autoInit: config.storage.autoInit,
          error: message,
        },
      });
      return;
    }
  }

  sendJson(res, 200, {
    success: true,
    service: "nora-dispatcher-middleware",
    timestamp: new Date().toISOString(),
    integrations: {
      hcpConfigured: Boolean(config.hcp.token),
      ghlSecretConfigured: Boolean(config.ghl.webhookSecret),
    },
    storage: {
      mode: storageMode,
      schemaReady,
      autoInit: config.storage.autoInit,
    },
  });
}
