import { VercelRequest } from "@vercel/node";
import { AppConfig } from "../config.js";

export function isAdminAuthorized(req: VercelRequest, config: AppConfig): boolean {
  const providedSecret = req.headers["x-admin-secret"];
  const expectedSecret = config.admin.secret;
  if (!expectedSecret) {
    return true;
  }

  const candidate = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;
  return candidate === expectedSecret;
}
