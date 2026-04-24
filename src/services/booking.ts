import { AppConfig } from "../config.js";
import { classifyService } from "../domain/serviceCatalog.js";
import { CandidateSlot, BookingResponsePayload, CustomerRequest } from "../domain/types.js";
import { AppError } from "../lib/errors.js";
import { HousecallProClient } from "../integrations/housecallPro.js";
import { buildBookingPresentation } from "../lib/presentation.js";
import { evaluateAvailability } from "./availability.js";

export async function createBooking(
  customerRequest: CustomerRequest,
  selectedSlot: CandidateSlot,
  hcpClient: HousecallProClient,
  config: AppConfig,
): Promise<BookingResponsePayload> {
  const service = classifyService(customerRequest.requestedService);
  const refreshed = await evaluateAvailability(customerRequest, hcpClient, config);

  if (refreshed.intelligence.isEmergency) {
    return {
      success: false,
      status: "human_escalation_required",
      message: "This request needs a dispatch manager instead of automated booking.",
      bookingTarget: service.target,
      escalationReason: "emergency_keyword_detected",
      presentation: buildBookingPresentation({
        status: "human_escalation_required",
        escalationReason: "emergency_keyword_detected",
      }),
    };
  }

  const stillAvailable = refreshed.allSlots.find(
    (slot) =>
      slot.technician === selectedSlot.technician &&
      slot.start === selectedSlot.start &&
      slot.bookingTarget === (selectedSlot.bookingTarget ?? service.target),
  );

  if (!stillAvailable) {
    const alternatives = refreshed.slots;
    if (!alternatives.length) {
      return {
        success: false,
        status: "human_escalation_required",
        message: "That time is no longer available, and dispatch should review the board for a manual fit.",
        bookingTarget: service.target,
        escalationReason: "no_viable_availability",
        presentation: buildBookingPresentation({
          status: "human_escalation_required",
          escalationReason: "no_viable_availability",
        }),
      };
    }

    return {
      success: false,
      status: "slot_unavailable",
      message: "That time was just taken, so Nora should offer a fresh set of options.",
      bookingTarget: service.target,
      alternatives,
      presentation: buildBookingPresentation({
        status: "slot_unavailable",
        alternatives,
      }),
    };
  }

  const result = await hcpClient.createBooking({
    customer: {
      firstName: customerRequest.firstName,
      lastName: customerRequest.lastName,
      phone: customerRequest.phone,
      email: customerRequest.email,
      address: customerRequest.address,
      zipCode: customerRequest.zipCode,
      bookSmartQualifiers: customerRequest.bookSmartQualifiers,
    },
    serviceName: service.title,
    notes: customerRequest.notes,
    start: stillAvailable.start,
    end: stillAvailable.end,
    technician: stillAvailable.technician,
    target: service.target,
  });

  if (!result.id) {
    throw new AppError("Housecall Pro booking did not return an id", 502);
  }

  return {
    success: true,
    status: "booked",
    message: `Booked successfully as a Housecall Pro ${service.target}.`,
    bookingTarget: service.target,
    externalId: result.id,
    confirmedBooking: {
      technician: result.technician,
      start: result.start,
      end: result.end,
      exactMatch: result.exactMatch,
    },
    presentation: buildBookingPresentation({
      status: "booked",
    }),
  };
}
