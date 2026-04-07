import { z } from "zod";

const optionalString = z.string().trim().optional().or(z.literal("").transform(() => undefined));

export const availabilityWebhookSchema = z.object({
  webhookId: optionalString,
  type: optionalString,
  timestamp: optionalString,
  contact: z
    .object({
      firstName: optionalString,
      lastName: optionalString,
      phone: optionalString,
      email: optionalString,
      address1: optionalString,
      postalCode: optionalString,
    })
    .partial()
    .optional(),
  customer: z
    .object({
      firstName: optionalString,
      lastName: optionalString,
      phone: optionalString,
      email: optionalString,
      address: optionalString,
      zipCode: optionalString,
    })
    .partial()
    .optional(),
  data: z.record(z.any()).optional(),
  firstName: optionalString,
  lastName: optionalString,
  phone: optionalString,
  email: optionalString,
  address: optionalString,
  zipCode: optionalString,
  requestedService: optionalString,
  service: optionalString,
  notes: optionalString,
  sameDayRequested: z.coerce.boolean().optional(),
});

export const bookingWebhookSchema = availabilityWebhookSchema.extend({
  selectedSlot: z.object({
    technician: z.string(),
    start: z.string(),
    end: z.string().optional(),
    bookingTarget: z.enum(["job", "estimate"]).optional(),
  }),
});
