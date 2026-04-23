export type BookSmartServiceCategory = "service_call" | "estimate" | "urgent";

export type BookSmartSkillTag =
  | "service_calls"
  | "troubleshooting"
  | "panel_work"
  | "ev_chargers"
  | "lighting"
  | "recessed_lighting"
  | "remodel_estimates"
  | "generators"
  | "smart_home";

export type BookSmartServiceTypeId =
  | "outlet_switch_issue"
  | "breaker_tripping"
  | "flickering_lights"
  | "power_loss_partial"
  | "fixture_repair_or_replace"
  | "troubleshooting_general"
  | "dedicated_circuit"
  | "smoke_co_detector"
  | "outdoor_receptacle"
  | "fan_or_fixture_install"
  | "ev_charger_install"
  | "panel_upgrade"
  | "service_upgrade"
  | "remodel_project"
  | "recessed_lighting_add"
  | "whole_home_rewire"
  | "generator_or_interlock"
  | "subpanel_install"
  | "surge_protection_upgrade"
  | "smart_home_or_lutron"
  | "burning_smell"
  | "sparks_or_arcing"
  | "hot_panel"
  | "emergency_power_issue"
  | "service_mast_or_meter_issue"
  | "unsafe_panel_condition";

export type BookSmartBookingTarget = "job" | "estimate";

export interface ServiceTypeConfig {
  id: BookSmartServiceTypeId;
  displayName: string;
  category: BookSmartServiceCategory;
  /** HCP / scheduling intent: in-home job visit vs. estimate. */
  target: BookSmartBookingTarget;
  requiredSkills: BookSmartSkillTag[];
  photoRequest: "never" | "recommended";
  priorityLevel: number;
  classifierPhrases: string[];
  requestedServiceLabel: string;
  /** How many named day blocks (Morning/Midday/Afternoon) the job needs; Jess can bump e.g. 7+ recessed lights to 2. */
  durationSlots?: number;
  consecutiveSlots?: boolean;
  askCeilingHeight?: boolean;
}

export interface ServiceAreaConfig {
  allowedCities: string[];
  restrictedCities: string[];
  outsideAreaBehavior: "handoff";
}

export interface ConversationSettingsConfig {
  openingQuestion: string;
  afterHoursBehavior: "handoff" | "continue";
  requestPhotosFor: BookSmartServiceCategory[];
  handoffMessage: string;
}

export interface BookingRulesConfig {
  sameDayAllowed: boolean;
  minimumNoticeHours: number;
  allowedWindows: Array<"morning" | "afternoon">;
}

export interface BookSmartConfig {
  serviceTypes: ServiceTypeConfig[];
  serviceAreas: ServiceAreaConfig;
  urgencyKeywords: Array<{
    phrase: string;
    level: "urgent";
  }>;
  bookingRules: BookingRulesConfig;
  conversation: ConversationSettingsConfig;
}

export interface ServiceTypeMatch {
  matched: boolean;
  serviceType: ServiceTypeConfig;
}
