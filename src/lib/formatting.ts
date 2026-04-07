export function formatSlotLabel(startIso: string, timezone: string, now: Date): string {
  const start = new Date(startIso);
  const dayLabel = describeDay(start, now, timezone);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(start);

  return `${dayLabel} at ${timeLabel}`;
}

function describeDay(date: Date, now: Date, timezone: string): string {
  const dateParts = getDateParts(date, timezone);
  const nowParts = getDateParts(now, timezone);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowParts = getDateParts(tomorrow, timezone);

  if (sameDateParts(dateParts, nowParts)) {
    return "Today";
  }
  if (sameDateParts(dateParts, tomorrowParts)) {
    return "Tomorrow";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
}

function getDateParts(date: Date, timezone: string): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "",
    month: parts.find((part) => part.type === "month")?.value ?? "",
    day: parts.find((part) => part.type === "day")?.value ?? "",
  };
}

function sameDateParts(
  left: { year: string; month: string; day: string },
  right: { year: string; month: string; day: string },
): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}
