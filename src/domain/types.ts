export type County = "macomb" | "oakland" | "other";

export type TechnicianName =
  | "Nate"
  | "Steve"
  | "Brandon"
  | "Dave"
  | "Lou";

export type SkillTag =
  | "senior"
  | "commercial"
  | "troubleshooting"
  | "fixtures"
  | "new-plugs"
  | "recessed-lighting"
  | "ev"
  | "service-change"
  | "rough-wiring"
  | "residential";

export type BookingTarget = "job" | "estimate";

export type ServiceCategory =
  | "commercial-troubleshooting"
  | "complex-troubleshooting"
  | "residential-troubleshooting"
  | "fixture-swap"
  | "new-plug"
  | "outlet-repair"
  | "recessed-lighting"
  | "ev-charger"
  | "panel-upgrade"
  | "service-change"
  | "rough-wiring"
  | "renovation"
  | "generic-electrical";

export interface CustomerRequest {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  address?: string;
  zipCode: string;
  requestedService: string;
  notes?: string;
  sameDayRequested?: boolean;
}

export interface ServiceProfile {
  category: ServiceCategory;
  title: string;
  durationMinutes: number;
  requiredSkills: SkillTag[];
  preferredSkills: SkillTag[];
  target: BookingTarget;
  complexityScore: number;
  escalationKeywords?: string[];
}

export interface TechnicianProfile {
  name: TechnicianName;
  skills: SkillTag[];
  seniorityRank: number;
  bookingTargets?: BookingTarget[];
}

export interface ScheduledJob {
  id: string;
  technician: TechnicianName;
  start: string;
  end: string;
  zipCode: string;
  title: string;
}

export interface CandidateSlot {
  technician: TechnicianName;
  start: string;
  end: string;
  score: number;
  reason: string;
  driveMinutes: number;
  serviceCategory: ServiceCategory;
  bookingTarget: BookingTarget;
  label: string;
}

export interface PresentedSlotOption {
  label: string;
  start: string;
  end: string;
  technician: TechnicianName;
  bookingTarget: BookingTarget;
}

export interface ConversationPresentation {
  replyText: string;
  followUpPrompt?: string;
  options?: PresentedSlotOption[];
}

export type AvailabilityStatus =
  | "slots_available"
  | "human_escalation_required";

export type EscalationReason =
  | "emergency_keyword_detected"
  | "no_viable_availability"
  | "outside_service_area";

export interface AvailabilityResponsePayload {
  success: boolean;
  status: AvailabilityStatus;
  message: string;
  service: ServiceProfile;
  slots: CandidateSlot[];
  escalationReason?: EscalationReason;
  presentation: ConversationPresentation;
}

export interface BookingResponsePayload {
  success: boolean;
  status: "booked" | "slot_unavailable" | "human_escalation_required";
  message: string;
  bookingTarget: BookingTarget;
  externalId?: string;
  alternatives?: CandidateSlot[];
  escalationReason?: EscalationReason;
  presentation: ConversationPresentation;
}
