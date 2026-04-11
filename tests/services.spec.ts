import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig } from "../src/config.js";
import { CandidateSlot, CustomerRequest, ScheduledJob } from "../src/domain/types.js";
import { createBooking } from "../src/services/booking.js";
import { getAvailability } from "../src/services/availability.js";

const config: AppConfig = {
  environment: "test",
  scheduling: {
    timezone: "America/Detroit",
    openingHour: 9,
    closingHour: 18,
    defaultSlotCount: 3,
    maxLookaheadDays: 5,
    minLeadHours: 2,
    bufferMinutes: 30,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    enabled: false,
  },
  hcp: {
    baseUrl: "https://api.housecallpro.com",
    customerPath: "/customers",
    employeePath: "/employees",
    schedulePath: "/jobs",
    createJobPath: "/jobs",
    createEstimatePath: "/public/v1/estimates",
    createLeadPath: "/leads",
  },
  ghl: {},
  blooio: {},
  admin: {},
  storage: {
    autoInit: true,
  },
};

const baseRequest: CustomerRequest = {
  firstName: "Jane",
  phone: "555-111-2222",
  zipCode: "48038",
  requestedService: "Install recessed lights in the kitchen",
};

describe("availability service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T11:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns at most three optimal slots", async () => {
    const jobs: ScheduledJob[] = [];
    const client = {
      fetchScheduledJobs: vi.fn().mockResolvedValue(jobs),
    } as unknown as {
      fetchScheduledJobs: (start: string, end: string) => Promise<ScheduledJob[]>;
    };

    const result = await getAvailability(baseRequest, client as never, config);

    expect(result.status).toBe("slots_available");
    expect(result.slots).toHaveLength(3);
    expect(result.slots.every((slot) => slot.label.includes("at"))).toBe(true);
    expect(result.presentation.options).toHaveLength(3);
    expect(result.presentation.replyText).toContain("Do any of those work for you?");
  });

  it("soft-escalates emergencies", async () => {
    const client = {
      fetchScheduledJobs: vi.fn().mockResolvedValue([]),
    } as unknown as {
      fetchScheduledJobs: (start: string, end: string) => Promise<ScheduledJob[]>;
    };

    const result = await getAvailability(
      {
        ...baseRequest,
        requestedService: "Panel is smoking and throwing sparks",
      },
      client as never,
      config,
    );

    expect(result.status).toBe("human_escalation_required");
    expect(result.escalationReason).toBe("emergency_keyword_detected");
    expect(result.slots).toHaveLength(0);
    expect(result.presentation.replyText).toContain("They will call you in about 5 minutes");
  });
});

describe("booking service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-04T11:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns fresh alternatives if the chosen slot was taken", async () => {
    const scheduledJobs: ScheduledJob[] = [
      {
        id: "taken-slot",
        technician: "Dave",
        start: "2026-04-06T17:00:00.000Z",
        end: "2026-04-06T21:00:00.000Z",
        zipCode: "48038",
        title: "Another recessed lighting job",
      },
    ];

    const client = {
      fetchScheduledJobs: vi.fn().mockResolvedValue(scheduledJobs),
      createBooking: vi.fn(),
    } as unknown as {
      fetchScheduledJobs: (start: string, end: string) => Promise<ScheduledJob[]>;
      createBooking: (payload: unknown) => Promise<{ id: string }>;
    };

    const selectedSlot: CandidateSlot = {
      technician: "Dave",
      start: "2026-04-06T17:00:00.000Z",
      end: "2026-04-06T21:00:00.000Z",
      score: 0,
      reason: "Previously offered",
      driveMinutes: 0,
      serviceCategory: "recessed-lighting",
      bookingTarget: "job",
      label: "Tomorrow at 1:00 PM",
    };

    const result = await createBooking(baseRequest, selectedSlot, client as never, config);

    expect(result.status).toBe("slot_unavailable");
    expect(result.alternatives?.length).toBeGreaterThan(0);
    expect(result.presentation.options?.length).toBeGreaterThan(0);
    expect(result.presentation.replyText).toContain("That time just filled up.");
    expect(client.createBooking).not.toHaveBeenCalled();
  });
});
