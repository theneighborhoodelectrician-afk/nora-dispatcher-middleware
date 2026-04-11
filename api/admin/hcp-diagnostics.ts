import { VercelRequest, VercelResponse } from "@vercel/node";
import { isAdminAuthorized } from "../../src/admin/auth.js";
import { getConfig } from "../../src/config.js";
import { runHcpDiagnostics } from "../../src/integrations/hcpDiagnostics.js";
import { sendError, sendJson } from "../../src/lib/response.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getConfig();
  if (!isAdminAuthorized(req, config)) {
    sendJson(res, 401, { success: false, message: "Invalid admin secret." });
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  try {
    const result = await runHcpDiagnostics(config);
    sendJson(res, 200, result);
  } catch (error) {
    sendError(res, error);
  }
}
