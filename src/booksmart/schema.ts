import { z } from "zod";

export const bookSmartServiceCategorySchema = z.enum(["service_call", "estimate", "urgent"]);
export const bookSmartSkillTagSchema = z.enum([
  "service_calls",
  "troubleshooting",
  "panel_work",
  "ev_chargers",
  "lighting",
  "remodel_estimates",
  "generators",
  "smart_home",
  "recessed_lighting",
]);

export const bookSmartServiceTypeIdSchema = z.enum([
  "outlet_switch_issue",
  "breaker_tripping",
  "flickering_lights",
  "power_loss_partial",
  "fixture_repair_or_replace",
  "troubleshooting_general",
  "dedicated_circuit",
  "smoke_co_detector",
  "outdoor_receptacle",
  "fan_or_fixture_install",
  "ev_charger_install",
  "panel_upgrade",
  "service_upgrade",
  "remodel_project",
  "recessed_lighting_add",
  "whole_home_rewire",
  "generator_or_interlock",
  "subpanel_install",
  "surge_protection_upgrade",
  "smart_home_or_lutron",
  "burning_smell",
  "sparks_or_arcing",
  "hot_panel",
  "emergency_power_issue",
  "service_mast_or_meter_issue",
  "unsafe_panel_condition",
]);

export const serviceTypeConfigSchema = z.object({
  id: bookSmartServiceTypeIdSchema,
  displayName: z.string().min(1),
  category: bookSmartServiceCategorySchema,
  target: z.enum(["job", "estimate"]),
  requiredSkills: z.array(bookSmartSkillTagSchema),
  photoRequest: z.enum(["never", "recommended"]),
  priorityLevel: z.number().int().nonnegative(),
  classifierPhrases: z.array(z.string().min(1)),
  requestedServiceLabel: z.string().min(1),
  durationSlots: z.number().int().positive().optional(),
  consecutiveSlots: z.boolean().optional(),
  askCeilingHeight: z.boolean().optional(),
});

export const bookSmartConfigSchema = z.object({
  serviceTypes: z.array(serviceTypeConfigSchema).min(1),
  serviceAreas: z.object({
    outsideAreaBehavior: z.literal("handoff"),
  }),
  urgencyKeywords: z.array(z.object({
    phrase: z.string().min(1),
    level: z.literal("urgent"),
  })),
  bookingRules: z.object({
    sameDayAllowed: z.boolean(),
    minimumNoticeHours: z.number().int().nonnegative(),
    allowedWindows: z.array(z.enum(["morning", "afternoon"])).min(1),
  }),
  conversation: z.object({
    openingQuestion: z.string().min(1),
    afterHoursBehavior: z.enum(["handoff", "continue"]),
    requestPhotosFor: z.array(bookSmartServiceCategorySchema),
    handoffMessage: z.string().min(1),
  }),
});

export type BookSmartConfigInput = z.infer<typeof bookSmartConfigSchema>;
