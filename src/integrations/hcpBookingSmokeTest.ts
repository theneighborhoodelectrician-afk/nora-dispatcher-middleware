import { AppConfig } from "../config.js";
import { HousecallProClient } from "./housecallPro.js";
import { ExternalServiceError } from "../lib/errors.js";

export interface HcpBookingSmokeTestInput {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  address?: string;
  zipCode: string;
  serviceName: string;
  notes?: string;
  start: string;
  end: string;
  technician: string;
  target: "job" | "estimate";
}

export interface HcpBookingSmokeTestResult {
  success: boolean;
  request: {
    target: "job" | "estimate";
    technician: string;
    serviceName: string;
    start: string;
    end: string;
    customer: {
      firstName: string;
      lastName?: string;
      phone: string;
      email?: string;
      address?: string;
      zipCode: string;
    };
    notes?: string;
  };
  result?: {
    id: string;
  };
  error?: {
    message: string;
    publicMessage: string;
    details?: unknown;
  };
}

export async function runHcpBookingSmokeTest(
  config: AppConfig,
  input: HcpBookingSmokeTestInput,
): Promise<HcpBookingSmokeTestResult> {
  const client = new HousecallProClient(config.hcp);
  const request = {
    target: input.target,
    technician: input.technician,
    serviceName: input.serviceName,
    start: input.start,
    end: input.end,
    customer: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
      email: input.email,
      address: input.address,
      zipCode: input.zipCode,
    },
    notes: input.notes,
  } satisfies HcpBookingSmokeTestResult["request"];

  try {
    const result = await client.createBooking(request);
    return {
      success: true,
      request,
      result,
    };
  } catch (error) {
    if (error instanceof ExternalServiceError) {
      return {
        success: false,
        request,
        error: {
          message: error.message,
          publicMessage: error.publicMessage,
          details: error.details,
        },
      };
    }

    return {
      success: false,
      request,
      error: {
        message: String(error),
        publicMessage: "Unexpected error while running HCP booking smoke test.",
      },
    };
  }
}
