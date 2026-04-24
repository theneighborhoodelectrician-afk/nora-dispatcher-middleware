import { describe, expect, it } from "vitest";
import { classifyService } from "../src/domain/serviceCatalog.js";
import {
  buildCandidateSlots,
  SchedulingSettings,
  technicianAcceptsServiceTarget,
} from "../src/domain/scheduling.js";
import { CustomerRequest, ScheduledJob } from "../src/domain/types.js";

const settings: SchedulingSettings = {
  timezone: "America/Detroit",
  openingHour: 9,
  closingHour: 18,
  defaultSlotCount: 3,
  maxLookaheadDays: 3,
  maxLookaheadTotalDays: 60,
  minLeadHours: 2,
  bufferMinutes: 30,
};

describe("service classification", () => {
  it("routes commercial troubleshooting to senior tech logic", () => {
    const service = classifyService("Commercial office troubleshoot for flickering lights");
    expect(service.category).toBe("commercial-troubleshooting");
    expect(service.target).toBe("job");
  });

  it("sends EV charger work to estimate flow", () => {
    const service = classifyService("Install a Tesla EV charger");
    expect(service.category).toBe("ev-charger");
    expect(service.target).toBe("estimate");
  });
});

describe("slot building", () => {
  it("returns ranked slots inside supported counties", () => {
    const request: CustomerRequest = {
      firstName: "Nate",
      phone: "555-111-2222",
      zipCode: "48038",
      requestedService: "Install recessed lights in living room",
    };

    const jobs: ScheduledJob[] = [
      {
        id: "job-1",
        technician: "Dave",
        start: "2026-04-08T14:00:00.000Z",
        end: "2026-04-08T15:00:00.000Z",
        zipCode: "48035",
        title: "Fixture replacement",
      },
    ];

    const service = classifyService(request.requestedService);
    // Monday, April 6, 2026 — 12:00 America/Detroit (EDT) during business hours
    const slots = buildCandidateSlots(
      request,
      service,
      jobs,
      settings,
      new Date("2026-04-06T16:00:00.000Z"),
    );

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]?.technician).toBe("Brandon");
    expect(slots[0]?.bookingTarget).toBe("job");
  });

  it("aligns offered slots to named day blocks (Morning / Midday / Afternoon)", () => {
    const request: CustomerRequest = {
      firstName: "Nate",
      phone: "555-111-2222",
      zipCode: "48038",
      requestedService: "Install recessed lights in living room",
    };

    const service = classifyService(request.requestedService);
    const slots = buildCandidateSlots(
      request,
      service,
      [],
      settings,
      new Date("2026-04-06T16:00:00.000Z"),
    );

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.label).toMatch(/Today|Tomorrow|—/);
    expect(new Date(slots[0]!.start).getUTCSeconds()).toBe(0);
  });

  it("spreads the top three slots across different calendar days when available", () => {
    const request: CustomerRequest = {
      firstName: "Nate",
      phone: "555-111-2222",
      zipCode: "48038",
      requestedService: "Install recessed lights in living room",
    };
    const service = classifyService(request.requestedService);
    const spreadSettings = { ...settings, defaultSlotCount: 3, maxLookaheadDays: 7 };
    const slots = buildCandidateSlots(
      request,
      service,
      [],
      spreadSettings,
      new Date("2026-04-06T16:00:00.000Z"),
    );
    expect(slots).toHaveLength(3);
    const dayKeys = slots.map((s) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: spreadSettings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(s.start)),
    );
    expect(new Set(dayKeys).size).toBe(3);
  });

  it("filters out unsupported counties", () => {
    const request: CustomerRequest = {
      firstName: "Nate",
      phone: "555-111-2222",
      zipCode: "48104",
      requestedService: "Replace a chandelier",
    };

    const service = classifyService(request.requestedService);
    const slots = buildCandidateSlots(
      request,
      service,
      [],
      settings,
      new Date("2026-04-06T16:00:00.000Z"),
    );

    expect(slots).toHaveLength(0);
  });

  it("rejects estimate-only techs for job targets", () => {
    expect(
      technicianAcceptsServiceTarget(
        {
          name: "Nate",
          seniorityRank: 1,
          skills: ["residential"],
          bookingTargets: ["estimate"],
        },
        "job",
      ),
    ).toBe(false);
    expect(
      technicianAcceptsServiceTarget(
        {
          name: "Nate",
          seniorityRank: 1,
          skills: ["residential"],
          bookingTargets: ["estimate"],
        },
        "estimate",
      ),
    ).toBe(true);
  });

  it("never puts an estimate-only technician on job slots", () => {
    const request: CustomerRequest = {
      firstName: "Test",
      phone: "555-111-2222",
      zipCode: "48038",
      requestedService: "Lights flickering in the kitchen",
    };
    const service = classifyService(request.requestedService);
    expect(service.target).toBe("job");
    const slots = buildCandidateSlots(
      request,
      service,
      [],
      settings,
      new Date("2026-04-06T16:00:00.000Z"),
    );
    expect(slots.some((s) => s.technician === "Nate")).toBe(false);
  });

  it("includes Nate for estimate work only", () => {
    const request: CustomerRequest = {
      firstName: "Nate",
      phone: "555-111-2222",
      zipCode: "48038",
      requestedService: "Install a Tesla EV charger",
    };

    const service = classifyService(request.requestedService);
    const slots = buildCandidateSlots(
      request,
      service,
      [],
      settings,
      new Date("2026-04-06T16:00:00.000Z"),
    );

    expect(slots.some((slot) => slot.technician === "Nate")).toBe(true);
    expect(slots.every((slot) => slot.bookingTarget === "estimate")).toBe(true);
  });

  it("does not label Saturday slots as Today on a Friday evening boundary", () => {
    const request: CustomerRequest = {
      firstName: "Test",
      phone: "555-111-2222",
      zipCode: "48315",
      requestedService: "Outlet or switch issue",
    };

    const service = classifyService(request.requestedService);
    const boundarySettings = { ...settings, maxLookaheadDays: 5 };
    // Friday, November 6, 2026 at 8:30 PM in America/Detroit.
    const slots = buildCandidateSlots(
      request,
      service,
      [],
      boundarySettings,
      new Date("2026-11-07T01:30:00.000Z"),
    );

    expect(slots).toHaveLength(3);
    expect(slots[0]?.label).toBe("Monday — Morning (9–12)");
    expect(
      new Intl.DateTimeFormat("en-US", {
        timeZone: boundarySettings.timezone,
        weekday: "long",
      }).format(new Date(slots[0]!.start)),
    ).toBe("Monday");
    expect(slots.some((slot) => /Today|Saturday|Sunday/.test(slot.label))).toBe(false);
  });
});
