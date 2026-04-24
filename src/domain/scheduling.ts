import { TECHNICIANS } from "./technicians.js";
import { detectCounty, normalizeZip } from "./geography.js";
import {
  CandidateSlot,
  CustomerRequest,
  ScheduledJob,
  ServiceProfile,
  TechnicianProfile,
} from "./types.js";

export const SLOT_BLOCKS = [
  { label: "Morning", startHour: 9, endHour: 12 },
  { label: "Midday", startHour: 12, endHour: 14 },
  { label: "Afternoon", startHour: 14, endHour: 17 },
] as const;

export interface SchedulingSettings {
  timezone: string;
  openingHour: number;
  closingHour: number;
  defaultSlotCount: number;
  /** First chunk of days to search when looking for open slots; extended in 7-day steps up to `maxLookaheadTotalDays`. */
  maxLookaheadDays: number;
  /** Do not look further than this many days from “now” when extending availability. */
  maxLookaheadTotalDays: number;
  minLeadHours: number;
  bufferMinutes: number;
}

function effectiveSlotBlockSpan(service: ServiceProfile, request: CustomerRequest): 1 | 2 | 3 {
  if (service.category === "recessed-lighting") {
    return request.recessedSlotBlocks === 2 ? 2 : 1;
  }
  return service.slotBlockSpan ?? 1;
}

export function buildCandidateSlots(
  request: CustomerRequest,
  service: ServiceProfile,
  scheduledJobs: ScheduledJob[],
  settings: SchedulingSettings,
  now: Date = new Date(),
  limit = settings.defaultSlotCount,
): CandidateSlot[] {
  const normalizedZip = normalizeZip(request.zipCode);
  const technicians = TECHNICIANS.filter((tech) => technicianMatchesService(tech, service));
  const blockSpan = effectiveSlotBlockSpan(service, request);
  const needConsecutive =
    service.requireConsecutiveBlocks === true ||
    (blockSpan > 1 && (service.category === "ev-charger" || service.category === "recessed-lighting"));
  const slots: CandidateSlot[] = [];

  for (const technician of technicians) {
    const techJobs = scheduledJobs
      .filter((job) => job.technician === technician.name)
      .sort((a, b) => a.start.localeCompare(b.start));

    for (let dayOffset = 0; dayOffset < settings.maxLookaheadDays; dayOffset += 1) {
      // Never offer Saturday (6) or Sunday (0) — weekdays only. See isWeekendInTimeZone.
      if (isWeekendInTimeZone(now, dayOffset, settings.timezone)) {
        continue;
      }

      if (request.sameDayRequested && dayOffset > 0) {
        break;
      }

      const dayLabel = buildDayPartLabel(now, dayOffset, settings.timezone);
      const earliestAllowed = new Date(now.getTime() + settings.minLeadHours * 60 * 60 * 1000);

      if (blockSpan === 3) {
        const start = startOfZonedDayHour(now, dayOffset, SLOT_BLOCKS[0]!.startHour, settings.timezone);
        const end = startOfZonedDayHour(now, dayOffset, SLOT_BLOCKS[2]!.endHour, settings.timezone);
        if (end <= earliestAllowed) {
          continue;
        }
        const pointer = new Date(Math.max(start.getTime(), earliestAllowed.getTime()));
        if (pointer >= end) {
          continue;
        }
        if (!fitsBetweenJobs(now, techJobs, pointer, end, dayOffset, settings)) {
          continue;
        }
        const b0 = SLOT_BLOCKS[0]!;
        const b2 = SLOT_BLOCKS[2]!;
        const label = `${dayLabel} — Full day (${b0.startHour}–${b2.endHour})`;
        pushBlockSlot(
          slots,
          request,
          service,
          technician,
          pointer,
          end,
          label,
          dayOffset,
          normalizedZip,
          settings,
        );
        continue;
      }

      if (blockSpan === 2 && needConsecutive) {
        for (let i = 0; i < SLOT_BLOCKS.length - 1; i += 1) {
          const a = SLOT_BLOCKS[i]!;
          const b = SLOT_BLOCKS[i + 1]!;
          const start = startOfZonedDayHour(now, dayOffset, a.startHour, settings.timezone);
          const end = startOfZonedDayHour(now, dayOffset, b.endHour, settings.timezone);
          if (end <= earliestAllowed) {
            continue;
          }
          const pointer = new Date(Math.max(start.getTime(), earliestAllowed.getTime()));
          if (pointer >= end) {
            continue;
          }
          if (!fitsBetweenJobs(now, techJobs, pointer, end, dayOffset, settings)) {
            continue;
          }
          const label = `${dayLabel} — ${a.label} + ${b.label} (${formatHourRange(a.startHour, b.endHour)})`;
          pushBlockSlot(
            slots,
            request,
            service,
            technician,
            pointer,
            end,
            label,
            dayOffset,
            normalizedZip,
            settings,
          );
        }
        continue;
      }

      for (const block of SLOT_BLOCKS) {
        const start = startOfZonedDayHour(now, dayOffset, block.startHour, settings.timezone);
        const end = startOfZonedDayHour(now, dayOffset, block.endHour, settings.timezone);
        if (end <= earliestAllowed) {
          continue;
        }
        const pointer = new Date(Math.max(start.getTime(), earliestAllowed.getTime()));
        if (pointer >= end) {
          continue;
        }
        if (!fitsBetweenJobs(now, techJobs, pointer, end, dayOffset, settings)) {
          continue;
        }
        const labelFixed = `${dayLabel} — ${block.label} (${formatHourRange(block.startHour, block.endHour)})`;
        pushBlockSlot(
          slots,
          request,
          service,
          technician,
          pointer,
          end,
          labelFixed,
          dayOffset,
          normalizedZip,
          settings,
        );
      }
    }
  }

  return dedupeAndRankSlots(slots, limit, settings.timezone);
}

function formatHourRange(start: number, end: number): string {
  const fmt = (h: number) => (h > 12 ? `${h - 12}` : `${h}`);
  return `${fmt(start)}–${fmt(end)}`;
}

/**
 * Excludes Sunday (calendar weekday long name) and Saturday in the scheduling IANA time zone.
 * (JS convention for day-of-week is 0=Sunday, 6=Saturday; this uses tz-local calendar days.)
 */
function isWeekendInTimeZone(now: Date, dayOffset: number, timeZone: string): boolean {
  const t = new Date(now);
  t.setDate(t.getDate() + dayOffset);
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" });
  const long = dtf.format(t);
  if (long === "Saturday" || long === "Sunday") {
    return true;
  }
  // Defense in depth: also match short names (Sat / Sun) in the same time zone
  const shortName = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(t);
  return shortName === "Sat" || shortName === "Sun";
}

function buildDayPartLabel(now: Date, dayOffset: number, timeZone: string): string {
  if (dayOffset === 0) {
    return "Today";
  }
  if (dayOffset === 1) {
    return "Tomorrow";
  }
  const t = new Date(now);
  t.setDate(t.getDate() + dayOffset);
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(t);
}

/** Approximate America/Detroit wall time as UTC by shifting from plain local date (see legacy startOfBusinessDay). */
function startOfZonedDayHour(now: Date, dayOffset: number, hour: number, _timeZone: string): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour + 4, 0, 0, 0);
  return date;
}

function fitsBetweenJobs(
  now: Date,
  techJobs: ScheduledJob[],
  windowStart: Date,
  windowEnd: Date,
  dayOffset: number,
  settings: SchedulingSettings,
): boolean {
  const dayStart = startOfZonedDayHour(now, dayOffset, 6, settings.timezone);
  const existing = techJobs.filter((job) => sameDateLocal(job.start, dayStart));
  if (!existing.length) {
    return true;
  }
  for (const job of existing) {
    const js = new Date(job.start);
    const je = new Date(job.end);
    if (windowStart < je && windowEnd > js) {
      return false;
    }
  }
  return true;
}

function sameDateLocal(iso: string, dayStart: Date): boolean {
  return new Date(iso).toDateString() === dayStart.toDateString();
}

function pushBlockSlot(
  slots: CandidateSlot[],
  request: CustomerRequest,
  service: ServiceProfile,
  technician: TechnicianProfile,
  start: Date,
  end: Date,
  label: string,
  _dayOffset: number,
  requestZip: string,
  _settings: SchedulingSettings,
): void {
  const county = detectCounty(request.zipCode);
  if (county === "other") {
    return;
  }
  const driveBefore = startingDriveMinutes(requestZip);
  const skillScore = technician.seniorityRank === 1 ? 20 : 10;
  const preferenceScore = service.preferredSkills.some((skill) => technician.skills.includes(skill))
    ? 10
    : 0;
  const complexityBoost = Math.max(0, service.complexityScore - technician.seniorityRank * 2);
  slots.push({
    technician: technician.name,
    start: start.toISOString(),
    end: end.toISOString(),
    score: skillScore + preferenceScore + complexityBoost,
    reason: `${technician.name} is qualified for ${service.title} (${label}).`,
    driveMinutes: driveBefore,
    serviceCategory: service.category,
    bookingTarget: service.target,
    label,
  });
}

/**
 * A technician with `bookingTargets` is only offered for services whose `target` is listed.
 * Estimate-only techs (e.g. `bookingTargets: ["estimate"]`) are never used for `service.target === "job"`.
 * Unrestricted techs omit `bookingTargets` and are eligible for any target their skills allow.
 */
export function technicianAcceptsServiceTarget(
  technician: TechnicianProfile,
  serviceTarget: ServiceProfile["target"],
): boolean {
  if (!technician.bookingTargets || technician.bookingTargets.length === 0) {
    return true;
  }
  return technician.bookingTargets.includes(serviceTarget);
}

function technicianMatchesService(technician: TechnicianProfile, service: ServiceProfile): boolean {
  console.log(
    "[TECH MATCH]",
    technician.name,
    "target:",
    service.target,
    "bookingTargets:",
    technician.bookingTargets,
    "accepts:",
    technicianAcceptsServiceTarget(technician, service.target),
  );
  if (!technicianAcceptsServiceTarget(technician, service.target)) {
    return false;
  }
  return service.requiredSkills.every((skill) => technician.skills.includes(skill));
}

function compareScoreThenStart(a: CandidateSlot, b: CandidateSlot): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.start.localeCompare(b.start);
}

function dayKeyInTimeZone(isoStart: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoStart));
}

function dedupeByTechStart(slots: CandidateSlot[]): CandidateSlot[] {
  const seen = new Set<string>();
  return slots
    .sort(compareScoreThenStart)
    .filter((slot) => {
      const key = `${slot.technician}:${slot.start}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

/**
 * Picks the highest-scoring slot per calendar day (scheduling time zone) on distinct days first,
 * in chronological day order, then backfills to `limit` from remaining candidates by score.
 */
function dedupeAndRankSlots(slots: CandidateSlot[], limit: number, timeZone: string): CandidateSlot[] {
  if (limit <= 0) {
    return [];
  }
  const unique = dedupeByTechStart(slots);
  if (unique.length === 0) {
    return [];
  }

  const byDay = new Map<string, CandidateSlot[]>();
  for (const slot of unique) {
    const k = dayKeyInTimeZone(slot.start, timeZone);
    const list = byDay.get(k) ?? [];
    list.push(slot);
    byDay.set(k, list);
  }
  for (const list of byDay.values()) {
    list.sort(compareScoreThenStart);
  }

  const dayKeys = [...byDay.keys()].sort();
  const fromDistinctDays: CandidateSlot[] = [];
  for (const k of dayKeys) {
    const best = byDay.get(k)?.[0];
    if (best) {
      fromDistinctDays.push(best);
    }
  }

  if (fromDistinctDays.length >= limit) {
    return fromDistinctDays.slice(0, limit);
  }

  const chosen = new Set(fromDistinctDays.map((s) => `${s.technician}:${s.start}`));
  const out = [...fromDistinctDays];
  for (const slot of unique.sort(compareScoreThenStart)) {
    if (out.length >= limit) {
      break;
    }
    const key = `${slot.technician}:${slot.start}`;
    if (chosen.has(key)) {
      continue;
    }
    chosen.add(key);
    out.push(slot);
  }
  return out.slice(0, limit);
}

function startingDriveMinutes(zipCode: string): number {
  return detectCounty(zipCode) === "macomb" ? 20 : 25;
}
