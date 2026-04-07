import { CustomerRequest, ServiceProfile } from "./types.js";

const EMERGENCY_KEYWORDS = [
  "fire",
  "smoke",
  "burning",
  "sparks",
  "sparking",
  "hot panel",
  "burning smell",
];

export interface RequestIntelligence {
  isEmergency: boolean;
  matchedEmergencyKeyword?: string;
}

export function analyzeRequest(
  request: CustomerRequest,
  service: ServiceProfile,
): RequestIntelligence {
  const searchText = [request.requestedService, request.notes].filter(Boolean).join(" ").toLowerCase();
  const matchedEmergencyKeyword = [...EMERGENCY_KEYWORDS, ...(service.escalationKeywords ?? [])].find(
    (keyword) => searchText.includes(keyword.toLowerCase()),
  );

  return {
    isEmergency: Boolean(matchedEmergencyKeyword),
    matchedEmergencyKeyword,
  };
}
