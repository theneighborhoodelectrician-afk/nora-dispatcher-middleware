/**
 * Best-effort first name when the customer free-texts instead of answering "what's your first name?"
 * cleanly. Avoids treating greetings / "So …" sentence starters / obvious service jargon as names.
 */

const EMAIL_LOCAL_DENYLIST = new Set([
  "info",
  "contact",
  "support",
  "sales",
  "admin",
  "hello",
  "help",
  "team",
  "office",
  "booking",
  "service",
  "noreply",
  "no-reply",
  "mail",
  "email",
]);

const TOKEN_DENYLIST = new Set([
  ...EMAIL_LOCAL_DENYLIST,
  "hi",
  "hey",
  "hello",
  "yo",
  "hiya",
  "howdy",
  "sup",
  "greetings",
  "there",
  "so",
  "well",
  "ok",
  "okay",
  "yeah",
  "yes",
  "yep",
  "yup",
  "nope",
  "nah",
  "thanks",
  "thank",
  "pls",
  "please",
  "sorry",
  "um",
  "uh",
  "er",
  "hmm",
  "oh",
  "ah",
  "btw",
  "just",
  "really",
  "actually",
  "basically",
  "literally",
  "like",
  "i",
  "im",
  "ive",
  "ill",
  "id",
  "we",
  "our",
  "us",
  "my",
  "your",
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "but",
  "not",
  "no",
  "can",
  "could",
  "would",
  "should",
  "will",
  "wont",
  "dont",
  "did",
  "do",
  "does",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "get",
  "got",
  "need",
  "want",
  "wanted",
  "looking",
  "trying",
  "hoping",
  "wondering",
  "help",
  "with",
  "someone",
  "something",
  "anything",
  "idk",
  "dunno",
  "tech",
  "technician",
  "customer",
  "customers",
  "call",
  "calls",
  "arrival",
  "arrivals",
  "onsite",
  "upon",
]);

/** Words that strongly suggest they're describing work, not their name */
const SERVICE_CONTEXT_WORDS = new Set([
  "breaker",
  "breakers",
  "tripping",
  "trips",
  "outlet",
  "outlets",
  "switch",
  "switches",
  "flickering",
  "lights",
  "light",
  "lighting",
  "fixture",
  "fixtures",
  "fan",
  "panel",
  "wiring",
  "rewire",
  "circuit",
  "circuits",
  "gfci",
  "ev",
  "charger",
  "generator",
  "interlock",
  "subpanel",
  "mast",
  "meter",
  "smoke",
  "detector",
  "whole",
  "home",
  "remodel",
  "recessed",
  "surge",
  "spark",
  "sparks",
  "arcing",
  "burning",
  "urgent",
  "emergency",
  "electric",
  "electrical",
  "electrician",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SERVICE_HINT_RE = new RegExp(
  `\\b(?:${[...SERVICE_CONTEXT_WORDS].map(escapeRegExp).join("|")})\\b`,
  "i",
);

function capitalizeNameToken(value: string): string {
  if (!value) {
    return value;
  }
  return value
    .toLowerCase()
    .split("'")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("'");
}

function stripLeadingFriendlyNoise(text: string): string {
  let rest = text.trim();
  for (let i = 0; i < 6; i += 1) {
    const before = rest;
    rest = rest
      .replace(
        /^(hi|hey|hello|yo|hiya|howdy|good\s+(?:morning|afternoon|evening)|greetings)\b[!.,'\s]*/iu,
        "",
      )
      .trim();
    rest = rest
      .replace(
        /^(so|well|ok|okay|yeah|yes|thanks|thank you|thank u|sorry|btw)[!.,\s]*/iu,
        "",
      )
      .trim();
    if (rest === before) {
      break;
    }
  }
  return rest;
}

function extractIntroductionName(text: string): string | undefined {
  const t = text.trim();
  const patterns: RegExp[] = [
    /\b(?:i'?m|i\s+am)\s+([a-z][a-z'\-]{0,24})\b/i,
    /\b(?:my\s+name\s+is|my\s+name'?s)\s+([a-z][a-z'\-]{0,24})\b/i,
    /\b(?:call\s+me|this\s+is|it'?s)\s+([a-z][a-z'\-]{0,24})\b/i,
    /\bname\s+is\s+([a-z][a-z'\-]{0,24})\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    const raw = m?.[1];
    if (raw && !TOKEN_DENYLIST.has(raw.toLowerCase()) && !SERVICE_CONTEXT_WORDS.has(raw.toLowerCase())) {
      return capitalizeNameToken(raw);
    }
  }
  return undefined;
}

function looksLikeServiceDescriptionInner(text: string): boolean {
  return SERVICE_HINT_RE.test(text);
}

/** Exported for intake routing: true when the customer text looks like a job description, not just a name line. */
export function messageLooksLikeServiceJob(text: string): boolean {
  return looksLikeServiceDescriptionInner(text.trim());
}

function firstCandidateFromWords(text: string): string | undefined {
  const stripped = stripLeadingFriendlyNoise(text);
  const cleaned = stripped.replace(/[^a-zA-Z\s'-]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower.length < 2) {
      continue;
    }
    if (TOKEN_DENYLIST.has(lower) || SERVICE_CONTEXT_WORDS.has(lower)) {
      continue;
    }
    return capitalizeNameToken(w);
  }
  return undefined;
}

function firstNameFromEmailLocal(email: string): string | undefined {
  const local = email.trim().split("@")[0]?.toLowerCase();
  if (!local) {
    return undefined;
  }
  const firstSegment = local.split(/[._-]/)[0]?.replace(/\d+$/, "") ?? "";
  if (
    firstSegment.length >= 2 &&
    firstSegment.length <= 15 &&
    /^[a-z]+$/i.test(firstSegment) &&
    !EMAIL_LOCAL_DENYLIST.has(firstSegment.toLowerCase())
  ) {
    return capitalizeNameToken(firstSegment);
  }
  return undefined;
}

/**
 * Infer a display first name from a free-form message, optionally using channel email when the
 * customer describes a problem instead of giving their name.
 */
export function inferCustomerFirstName(message: string, emailHint?: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return fallbackFromEmail(emailHint);
  }

  const intro = extractIntroductionName(trimmed);
  if (intro) {
    return intro;
  }

  /** Do not pull a "name" from phrases that are clearly about the job; that produced "So" / "Hi" / "We're". */
  const serviceish = looksLikeServiceDescriptionInner(trimmed);
  if (serviceish) {
    const fromEmail = emailHint ? firstNameFromEmailLocal(emailHint) : undefined;
    return fromEmail ?? "Neighbor";
  }

  const fromWords = firstCandidateFromWords(trimmed);
  if (fromWords) {
    return fromWords;
  }

  return fallbackFromEmail(emailHint);
}

function fallbackFromEmail(emailHint?: string): string {
  const fromEmail = emailHint ? firstNameFromEmailLocal(emailHint) : undefined;
  return fromEmail ?? "Neighbor";
}

/** Inference fallbacks that should not win once we have a real email local (e.g. johnk8684@… → Johnk). */
const PLACEHOLDER_FIRST_NAMES = new Set(["neighbor", "looking"]);

/** True when we still need to collect a real first name (missing or channel junk like “Looking”). */
export function needsExplicitFirstNameCollection(firstName: string | undefined): boolean {
  const t = firstName?.trim().toLowerCase();
  return !t || PLACEHOLDER_FIRST_NAMES.has(t);
}

/** True when we still need a last name for CRM / HCP. */
export function needsExplicitLastNameCollection(lastName: string | undefined): boolean {
  return !lastName?.trim();
}

const INVALID_INTRODUCED_LAST_TOKEN = new Set([
  "in",
  "at",
  "from",
  "here",
  "the",
  "a",
  "an",
  "on",
  "of",
  "to",
  "for",
  "and",
  "or",
  "near",
]);

function isPlausibleIntroducedNameToken(raw: string): boolean {
  const lower = raw.toLowerCase();
  if (lower.length < 2 || lower.length > 24) {
    return false;
  }
  if (TOKEN_DENYLIST.has(lower) || SERVICE_CONTEXT_WORDS.has(lower) || PLACEHOLDER_FIRST_NAMES.has(lower)) {
    return false;
  }
  if (INVALID_INTRODUCED_LAST_TOKEN.has(lower)) {
    return false;
  }
  return true;
}

/**
 * First + last from clear intros ("Hi this is Janet Waters", "I'm Pat Smith") before single-name
 * intro patterns (which would otherwise only capture the first token).
 */
export function tryParseIntroducedFirstLast(message: string): { firstName: string; lastName: string } | undefined {
  const t = message.trim();
  const patterns: RegExp[] = [
    /\b(?:hi|hello)\s*[,!]?\s*(?:this\s+is|it'?s)\s+([A-Za-z][A-Za-z'\-]*)\s+([A-Za-z][A-Za-z'\-]*)\b/i,
    /\bthis\s+is\s+([A-Za-z][A-Za-z'\-]*)\s+([A-Za-z][A-Za-z'\-]*)\b/i,
    /\b(?:i'?m|i\s+am)\s+([A-Za-z][A-Za-z'\-]*)\s+([A-Za-z][A-Za-z'\-]*)\b/i,
    /\b(?:my\s+name\s+is|my\s+name'?s)\s+([A-Za-z][A-Za-z'\-]*)\s+([A-Za-z][A-Za-z'\-]*)\b/i,
    /\b(?:call\s+me)\s+([A-Za-z][A-Za-z'\-]*)\s+([A-Za-z][A-Za-z'\-]*)\b/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    const a = m?.[1];
    const b = m?.[2];
    if (a && b && isPlausibleIntroducedNameToken(a) && isPlausibleIntroducedNameToken(b)) {
      return { firstName: capitalizeNameToken(a), lastName: capitalizeNameToken(b) };
    }
  }
  return undefined;
}

export type AcceptedContactName = {
  firstName: string;
  lastName?: string;
};

/** Parsed first (and optional last) when the customer volunteered it clearly enough to skip asking. */
export function tryAcceptContactName(message: string): AcceptedContactName | undefined {
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }

  const pair = tryParseIntroducedFirstLast(trimmed);
  if (pair) {
    return pair;
  }

  const introSingle = extractIntroductionName(trimmed);
  if (introSingle) {
    return { firstName: introSingle };
  }

  const stripped = stripLeadingFriendlyNoise(trimmed);
  const cleaned = stripped.replace(/[^a-zA-Z\s'-]/g, " ").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);

  if (words.length !== 1) {
    return undefined;
  }

  const w = words[0]!;
  const lower = w.toLowerCase();
  if (
    lower.length < 2 ||
    TOKEN_DENYLIST.has(lower) ||
    SERVICE_CONTEXT_WORDS.has(lower) ||
    PLACEHOLDER_FIRST_NAMES.has(lower)
  ) {
    return undefined;
  }

  return { firstName: capitalizeNameToken(w) };
}

/**
 * Accept a first name only (backward compatible). Prefer tryAcceptContactName when you need last.
 */
export function tryAcceptFirstNameWithoutAsking(message: string): string | undefined {
  return tryAcceptContactName(message)?.firstName;
}

/**
 * Final first name for CRM / HCP when email may disambiguate bad inference (e.g. "Looking" from a
 * sentence starter or "Neighbor" before channel email was linked).
 */
export function resolveCustomerFirstName(firstName: string | undefined, email: string | undefined): string {
  const fromEmail = email?.trim() ? firstNameFromEmailLocal(email) : undefined;
  const t = firstName?.trim().toLowerCase();
  if (fromEmail && (!t || PLACEHOLDER_FIRST_NAMES.has(t))) {
    return fromEmail;
  }
  if (firstName?.trim()) {
    return firstName.trim();
  }
  return fromEmail ?? "Neighbor";
}
