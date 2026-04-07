import { VercelResponse } from "@vercel/node";
import { AppError } from "./errors.js";

export function sendJson(res: VercelResponse, status: number, payload: unknown): void {
  res.status(status).setHeader("content-type", "application/json").send(JSON.stringify(payload));
}

export function sendError(res: VercelResponse, error: unknown): void {
  if (error instanceof AppError) {
    sendJson(res, error.statusCode, {
      success: false,
      message: error.publicMessage,
    });
    return;
  }

  sendJson(res, 500, {
    success: false,
    message: "Something unexpected happened while checking the schedule.",
  });
}
