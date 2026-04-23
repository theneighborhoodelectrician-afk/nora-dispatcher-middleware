import { detectCounty } from "../domain/geography.js";
import { analyzeRequest } from "../domain/intelligence.js";
import { classifyService } from "../domain/serviceCatalog.js";
import { buildCandidateSlots, isAfterHoursOrWeekend } from "../domain/scheduling.js";
import { AvailabilityResponsePayload, CustomerRequest } from "../domain/types.js";
import { HousecallProClient } from "../integrations/housecallPro.js";
import { AppConfig } from "../config.js";
import { buildAvailabilityPresentation } from "../lib/presentation.js";

export async function getAvailability(
  customerRequest: CustomerRequest,
  hcpClient: HousecallProClient,
  config: AppConfig,
): Promise<AvailabilityResponsePayload> {
  const decision = await evaluateAvailability(customerRequest, hcpClient, config);

  if (decision.intelligence.isEmergency) {
    return {
      success: false,
      status: "human_escalation_required",
      message:
        "This sounds urgent, so Nora should hand it to dispatch right away instead of offering online booking.",
      service: decision.service,
      slots: [],
      escalationReason: "emergency_keyword_detected",
      diagnostics: decision.diagnostics,
      presentation: buildAvailabilityPresentation({
        status: "human_escalation_required",
        slots: [],
        escalationReason: "emergency_keyword_detected",
      }),
    };
  }

  if (decision.bookingWindowClosed) {
    return {
      success: false,
      status: "human_escalation_required",
      message: "After hours or weekend — do not offer slots; lead follow-up only.",
      service: decision.service,
      slots: [],
      escalationReason: "after_hours_or_weekend",
      diagnostics: decision.diagnostics,
      presentation: buildAvailabilityPresentation({
        status: "human_escalation_required",
        slots: [],
        escalationReason: "after_hours_or_weekend",
      }),
    };
  }

  if (detectCounty(customerRequest.zipCode) === "other") {
    return {
      success: false,
      status: "human_escalation_required",
      message:
        "This address falls outside the current Macomb and Oakland routing rules, so dispatch should review it manually.",
      service: decision.service,
      slots: [],
      escalationReason: "outside_service_area",
      diagnostics: decision.diagnostics,
      presentation: buildAvailabilityPresentation({
        status: "human_escalation_required",
        slots: [],
        escalationReason: "outside_service_area",
      }),
    };
  }

  if (!decision.slots.length) {
    return {
      success: false,
      status: "human_escalation_required",
      message:
        "I couldn’t find three clean options that fit the job length, route, and technician skill rules, so dispatch should take over.",
      service: decision.service,
      slots: [],
      escalationReason: "no_viable_availability",
      diagnostics: decision.diagnostics,
      presentation: buildAvailabilityPresentation({
        status: "human_escalation_required",
        slots: [],
        escalationReason: "no_viable_availability",
      }),
    };
  }

  return {
    success: true,
    status: "slots_available",
    message:
      "Here are the three best options based on technician skill, contiguous job time, and route efficiency.",
    service: decision.service,
    slots: decision.slots,
    diagnostics: decision.diagnostics,
    presentation: buildAvailabilityPresentation({
      status: "slots_available",
      slots: decision.slots,
    }),
  };
}

export async function evaluateAvailability(
  customerRequest: CustomerRequest,
  hcpClient: HousecallProClient,
  config: AppConfig,
): Promise<{
  service: ReturnType<typeof classifyService>;
  intelligence: ReturnType<typeof analyzeRequest>;
  slots: AvailabilityResponsePayload["slots"];
  allSlots: AvailabilityResponsePayload["slots"];
  diagnostics: NonNullable<AvailabilityResponsePayload["diagnostics"]>;
  bookingWindowClosed: boolean;
}> {
  const service = classifyService(customerRequest.requestedService);
  const intelligence = analyzeRequest(customerRequest, service);
  const now = new Date();
  const bookingWindowClosed = isAfterHoursOrWeekend(now, config.scheduling.timezone);
  if (bookingWindowClosed) {
    return {
      service,
      intelligence,
      slots: [],
      allSlots: [],
      bookingWindowClosed: true,
      diagnostics: {
        requestZipCode: customerRequest.zipCode,
        requestCounty: detectCounty(customerRequest.zipCode),
        fetchedScheduledJobs: 0,
        matchingTechnicians: [],
        candidateSlotCount: 0,
        returnedSlotCount: 0,
        preferredWindow: customerRequest.preferredWindow,
        serviceCategory: service.category,
      },
    };
  }
  const rangeEnd = new Date(
    now.getTime() + config.scheduling.maxLookaheadDays * 24 * 60 * 60 * 1000,
  );
  const scheduledJobs = await hcpClient.fetchScheduledJobs(now.toISOString(), rangeEnd.toISOString());
  const allSlots = buildCandidateSlots(
    customerRequest,
    service,
    scheduledJobs,
    config.scheduling,
    now,
    50,
  );
  const slots = allSlots.slice(0, config.scheduling.defaultSlotCount);
  return {
    service,
    intelligence,
    slots,
    allSlots,
    bookingWindowClosed: false,
    diagnostics: {
      requestZipCode: customerRequest.zipCode,
      requestCounty: detectCounty(customerRequest.zipCode),
      fetchedScheduledJobs: scheduledJobs.length,
      matchingTechnicians: [...new Set(allSlots.map((slot) => slot.technician))],
      candidateSlotCount: allSlots.length,
      returnedSlotCount: slots.length,
      preferredWindow: customerRequest.preferredWindow,
      serviceCategory: service.category,
    },
  };
}
