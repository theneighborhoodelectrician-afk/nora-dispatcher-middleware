import { describe, expect, it } from "vitest";
import { MemoryStorageAdapter } from "../src/storage/memory.js";
import { trackAvailabilityRequest, trackBookingRequest } from "../src/conversations/webhookTracking.js";
import { CandidateSlot, CustomerRequest } from "../src/domain/types.js";

describe("webhook tracking", () => {
  it("tracks availability webhook outcomes into structured conversation records", async () => {
    const storage = new MemoryStorageAdapter();
    const request: CustomerRequest = {
      firstName: "Jane",
      phone: "555-111-2222",
      city: "Sterling Heights",
      address: "123 Main St",
      zipCode: "48313",
      requestedService: "Install recessed lights in the kitchen",
    };

    await trackAvailabilityRequest({
      storage,
      conversationId: "conv-avail-1",
      leadSource: "website",
      request,
      timestamp: Date.now(),
      response: {
        success: true,
        status: "slots_available",
        message: "ok",
        service: {
          category: "recessed-lighting",
          title: "Recessed lighting",
          durationMinutes: 240,
          requiredSkills: ["recessed-lighting", "residential"],
          preferredSkills: [],
          target: "job",
          complexityScore: 6,
        },
        slots: [],
        presentation: {
          replyText: "I have a few options.",
          options: [
            {
              label: "Tomorrow at 9:00 AM",
              start: "2026-04-05T13:00:00.000Z",
              end: "2026-04-05T17:00:00.000Z",
              technician: "Dave",
              bookingTarget: "job",
            },
          ],
        },
      },
    });

    const conversation = await storage.getConversation("conv-avail-1");
    const outcome = await storage.getConversationOutcome("conv-avail-1");
    const stages = await storage.listConversationStages("conv-avail-1");
    const slots = await storage.listSlotExposures("conv-avail-1");

    expect(conversation?.leadSource).toBe("website");
    expect(outcome?.availabilityShown).toBe(true);
    expect(outcome?.slotsShownCount).toBe(1);
    expect(stages.some((stage) => stage.stage === "availability_presented")).toBe(true);
    expect(slots).toHaveLength(1);
  });

  it("tracks booking webhook selections and booking outcomes", async () => {
    const storage = new MemoryStorageAdapter();
    const request: CustomerRequest = {
      firstName: "Jane",
      phone: "555-111-2222",
      city: "Sterling Heights",
      address: "123 Main St",
      zipCode: "48313",
      requestedService: "Breaker tripping",
    };
    const selectedSlot: CandidateSlot = {
      technician: "Dave",
      start: "2026-04-05T13:00:00.000Z",
      end: "2026-04-05T15:00:00.000Z",
      score: 0,
      reason: "Confirmed by customer",
      driveMinutes: 0,
      serviceCategory: "generic-electrical",
      bookingTarget: "job",
      label: "Tomorrow at 9:00 AM",
    };

    await trackBookingRequest({
      storage,
      conversationId: "conv-book-1",
      leadSource: "manual_link",
      request,
      selectedSlot,
      timestamp: Date.now(),
      response: {
        success: true,
        status: "booked",
        message: "Booked",
        bookingTarget: "job",
        externalId: "hcp-123",
        presentation: {
          replyText: "Booked",
        },
      },
    });

    const outcome = await storage.getConversationOutcome("conv-book-1");
    const stages = await storage.listConversationStages("conv-book-1");
    const slots = await storage.listSlotExposures("conv-book-1");
    const bookingEvents = await storage.listBookingEvents("conv-book-1");

    expect(outcome?.bookedYesNo).toBe(true);
    expect(outcome?.slotSelected).toBe(true);
    expect(stages.some((stage) => stage.stage === "slot_selected")).toBe(true);
    expect(stages.some((stage) => stage.stage === "booked")).toBe(true);
    expect(slots[0]?.selectedYesNo).toBe(true);
    expect(bookingEvents[0]?.bookingExternalId).toBe("hcp-123");
  });
});
