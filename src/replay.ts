import { AppConfig } from "./config.js";
import { ScheduledJob } from "./domain/types.js";
import { parseAvailabilityRequest, parseBookingRequest } from "./lib/requestParsing.js";
import { getAvailability } from "./services/availability.js";
import { createBooking } from "./services/booking.js";

export interface ReplayFiles {
  webhook: unknown;
  scheduledJobs?: ScheduledJob[];
}

export async function replayAvailability(
  payload: unknown,
  scheduledJobs: ScheduledJob[],
  config: AppConfig,
): Promise<unknown> {
  const { request } = parseAvailabilityRequest(payload);
  const client = new ReplayHousecallClient(scheduledJobs);
  return getAvailability(request, client as never, config);
}

export async function replayBooking(
  payload: unknown,
  scheduledJobs: ScheduledJob[],
  config: AppConfig,
): Promise<unknown> {
  const { request, selectedSlot } = parseBookingRequest(payload);
  const client = new ReplayHousecallClient(scheduledJobs);
  return createBooking(request, selectedSlot, client as never, config);
}

class ReplayHousecallClient {
  constructor(private readonly scheduledJobs: ScheduledJob[]) {}

  async fetchScheduledJobs(_start: string, _end: string): Promise<ScheduledJob[]> {
    return this.scheduledJobs;
  }

  async createBooking(payload: {
    target: "job" | "estimate";
  }): Promise<{ id: string }> {
    return { id: `replay-${payload.target}-001` };
  }
}
