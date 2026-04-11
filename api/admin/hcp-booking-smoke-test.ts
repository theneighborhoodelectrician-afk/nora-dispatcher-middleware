import { VercelRequest, VercelResponse } from "@vercel/node";
import { getConfig } from "../../src/config.js";
import { isAdminAuthorized } from "../../src/admin/auth.js";
import { sendJson } from "../../src/lib/response.js";
import { runHcpBookingSmokeTest } from "../../src/integrations/hcpBookingSmokeTest.js";

interface SmokeTestPayload {
  adminSecret?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address?: string;
  zipCode?: string;
  serviceName?: string;
  notes?: string;
  start?: string;
  end?: string;
  technician?: string;
  target?: "job" | "estimate";
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getConfig();

  if (req.method === "GET") {
    sendJson(res, 200, {
      success: true,
      message: "POST a fully specified smoke-test payload to attempt a real HCP create.",
      auth: {
        requiresAdminSecret: Boolean(config.admin.secret),
        acceptedHeader: "x-admin-secret",
        acceptedBodyField: "adminSecret",
      },
      configuredPaths: {
        createJobPath: config.hcp.createJobPath,
        createEstimatePath: config.hcp.createEstimatePath,
        customerPath: config.hcp.customerPath,
      },
      examplePayload: {
        target: "job",
        firstName: "BookSmart",
        lastName: "Smoke Test",
        phone: "5551112222",
        email: "ops@example.com",
        address: "123 Main St",
        zipCode: "48313",
        serviceName: "Breaker tripping smoke test",
        notes: "DELETE_ME smoke test created from BookSmart admin diagnostics.",
        technician: "Nate",
        start: "2026-04-12T13:00:00.000Z",
        end: "2026-04-12T17:00:00.000Z",
      },
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { success: false, message: "Method not allowed." });
    return;
  }

  const body = (req.body ?? {}) as SmokeTestPayload;
  const bodySecret = typeof body.adminSecret === "string" ? body.adminSecret : undefined;
  const headerSecret = req.headers["x-admin-secret"];
  const candidateHeaderSecret = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
  const authorized =
    !config.admin.secret ||
    candidateHeaderSecret === config.admin.secret ||
    bodySecret === config.admin.secret ||
    isAdminAuthorized(req, config);

  if (!authorized) {
    sendJson(res, 401, { success: false, message: "Admin authorization required." });
    return;
  }

  const validationError = validatePayload(body);
  if (validationError) {
    sendJson(res, 400, { success: false, message: validationError });
    return;
  }

  const result = await runHcpBookingSmokeTest(config, {
    firstName: body.firstName!,
    lastName: body.lastName,
    phone: body.phone!,
    email: body.email,
    address: body.address,
    zipCode: body.zipCode!,
    serviceName: body.serviceName!,
    notes: body.notes,
    start: body.start!,
    end: body.end!,
    technician: body.technician!,
    target: body.target!,
  });

  sendJson(res, result.success ? 200 : 502, result);
}

function validatePayload(body: SmokeTestPayload): string | null {
  const requiredFields = [
    "firstName",
    "phone",
    "zipCode",
    "serviceName",
    "start",
    "end",
    "technician",
    "target",
  ] as const;

  for (const field of requiredFields) {
    if (!body[field]) {
      return `Missing required field: ${field}`;
    }
  }

  if (body.target !== "job" && body.target !== "estimate") {
    return "target must be either 'job' or 'estimate'.";
  }

  if (Number.isNaN(Date.parse(body.start!)) || Number.isNaN(Date.parse(body.end!))) {
    return "start and end must be valid ISO timestamps.";
  }

  return null;
}
