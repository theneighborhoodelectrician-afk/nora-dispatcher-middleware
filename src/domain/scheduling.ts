import { TECHNICIANS } from "./technicians.js";
import { detectCounty, estimateDriveMinutes, normalizeZip } from "./geography.js";
import {
  CandidateSlot,
  CustomerRequest,
  ScheduledJob,
  ServiceProfile,
  TechnicianProfile,
} from "./types.js";
import { formatSlotLabel } from "../lib/formatting.js";

export interface SchedulingSettings {
  timezone: string;
  openingHour: number;
  closingHour: number;
  defaultSlotCount: number;
  maxLookaheadDays: number;
  minLeadHours: number;
  bufferMinutes: number;
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
  const slots: CandidateSlot[] = [];

  for (const technician of technicians) {
    const techJobs = scheduledJobs
      .filter((job) => job.technician === technician.name)
      .sort((a, b) => a.start.localeCompare(b.start));

    for (let dayOffset = 0; dayOffset < settings.maxLookaheadDays; dayOffset += 1) {
      const dayStart = startOfBusinessDay(now, dayOffset, settings.openingHour);
      const dayEnd = endOfBusinessDay(now, dayOffset, settings.closingHour);

      if (request.sameDayRequested && dayOffset > 0) {
        break;
      }

      const earliestAllowed = new Date(now.getTime() + settings.minLeadHours * 60 * 60 * 1000);
      const existing = techJobs.filter((job) => sameDate(job.start, dayStart));
      let pointer = new Date(Math.max(dayStart.getTime(), earliestAllowed.getTime()));

      if (!existing.length) {
        maybePushSlot(slots, {
          request,
          service,
          technician,
          windowStart: pointer,
          dayEnd,
          previousJob: undefined,
          nextJob: undefined,
          settings,
          now,
        });
        continue;
      }

      for (let index = 0; index <= existing.length; index += 1) {
        const previousJob = existing[index - 1];
        const nextJob = existing[index];

        if (previousJob) {
          const previousEnd = new Date(previousJob.end);
          const driveAfterPrevious = estimateDriveMinutes(previousJob.zipCode, normalizedZip);
          pointer = new Date(
            previousEnd.getTime() + (driveAfterPrevious + settings.bufferMinutes) * 60_000,
          );
        }

        maybePushSlot(slots, {
          request,
          service,
          technician,
          windowStart: pointer,
          dayEnd,
          previousJob,
          nextJob,
          settings,
          now,
        });
      }
    }
  }

  return dedupeAndRankSlots(slots, limit);
}

function maybePushSlot(
  slots: CandidateSlot[],
  {
    request,
    service,
    technician,
    windowStart,
    dayEnd,
    previousJob,
    nextJob,
    settings,
    now,
  }: {
  request: CustomerRequest;
  service: ServiceProfile;
  technician: TechnicianProfile;
  windowStart: Date;
  dayEnd: Date;
  previousJob?: ScheduledJob;
  nextJob?: ScheduledJob;
  settings: SchedulingSettings;
  now: Date;
}): void {
  const sameDayBaseline = now;
  const candidateStart = roundUpToSlotWindow(windowStart);
  const requestZip = normalizeZip(request.zipCode);
  const driveBefore = previousJob
    ? estimateDriveMinutes(previousJob.zipCode, requestZip)
    : startingDriveMinutes(requestZip);
  const candidateEnd = new Date(
    candidateStart.getTime() + (service.durationMinutes + settings.bufferMinutes) * 60_000,
  );

  if (candidateEnd > dayEnd) {
    return;
  }

  if (nextJob) {
    const nextStart = new Date(nextJob.start);
    const driveToNext = estimateDriveMinutes(requestZip, nextJob.zipCode);
    const latestAllowed = new Date(
      nextStart.getTime() - (driveToNext + settings.bufferMinutes) * 60_000,
    );
    if (candidateEnd > latestAllowed) {
      return;
    }
  }

  const county = detectCounty(requestZip);
  if (county === "other") {
    return;
  }

  const skillScore = technician.seniorityRank === 1 ? 20 : 10;
  const preferenceScore = service.preferredSkills.some((skill) => technician.skills.includes(skill))
    ? 10
    : 0;
  const sameDayScore =
    request.sameDayRequested && sameDate(candidateStart.toISOString(), sameDayBaseline)
      ? 8
      : 0;
  const travelPenalty = Math.round((driveBefore / 10) * -1);
  const complexityBoost = Math.max(0, service.complexityScore - technician.seniorityRank * 2);

  slots.push({
    technician: technician.name,
    start: candidateStart.toISOString(),
    end: new Date(candidateStart.getTime() + service.durationMinutes * 60_000).toISOString(),
    score: skillScore + preferenceScore + sameDayScore + travelPenalty + complexityBoost,
    reason: buildReason(technician.name, service.title, driveBefore, county),
    driveMinutes: driveBefore,
    serviceCategory: service.category,
    bookingTarget: service.target,
    label: formatSlotLabel(candidateStart.toISOString(), settings.timezone, now),
  });
}

function buildReason(
  technician: string,
  serviceTitle: string,
  driveMinutes: number,
  county: string,
): string {
  return `${technician} is qualified for ${serviceTitle.toLowerCase()} with an estimated ${driveMinutes}-minute drive in ${county} county coverage.`;
}

function sameDate(leftIso: string, right: Date): boolean;
function sameDate(leftIso: string, rightIso: string): boolean;
function sameDate(leftIso: string, right: Date | string): boolean {
  const left = new Date(leftIso);
  const rightDate = typeof right === "string" ? new Date(right) : right;
  return (
    left.getUTCFullYear() === rightDate.getUTCFullYear() &&
    left.getUTCMonth() === rightDate.getUTCMonth() &&
    left.getUTCDate() === rightDate.getUTCDate()
  );
}

function startOfBusinessDay(now: Date, dayOffset: number, openingHour: number): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(openingHour + 4, 0, 0, 0);
  return date;
}

function endOfBusinessDay(now: Date, dayOffset: number, closingHour: number): Date {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(closingHour + 4, 0, 0, 0);
  return date;
}

function startingDriveMinutes(zipCode: string): number {
  return detectCounty(zipCode) === "macomb" ? 20 : 25;
}

function roundUpToSlotWindow(date: Date, incrementMinutes = 30): Date {
  const rounded = new Date(date);
  rounded.setUTCSeconds(0, 0);

  const minutes = rounded.getUTCMinutes();
  const remainder = minutes % incrementMinutes;

  if (remainder === 0) {
    return rounded;
  }

  rounded.setUTCMinutes(minutes + (incrementMinutes - remainder), 0, 0);
  return rounded;
}

function technicianMatchesService(
  technician: TechnicianProfile,
  service: ServiceProfile,
): boolean {
  if (technician.bookingTargets && !technician.bookingTargets.includes(service.target)) {
    return false;
  }
  return service.requiredSkills.every((skill) => technician.skills.includes(skill));
}

function dedupeAndRankSlots(slots: CandidateSlot[], limit: number): CandidateSlot[] {
  const seen = new Set<string>();
  return slots
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.start.localeCompare(b.start);
    })
    .filter((slot) => {
      const key = `${slot.technician}:${slot.start}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
