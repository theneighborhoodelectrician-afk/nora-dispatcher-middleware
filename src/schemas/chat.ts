import { z } from "zod";

export const chatWebhookSchema = z.object({
  sessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  threadId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  leadSource: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  mediaUrls: z.array(z.string().min(1)).optional(),
  attachments: z.array(z.object({
    type: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  }).partial()).optional(),
  message: z.object({
    id: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
  }).partial().optional(),
  contact: z.object({
    id: z.string().min(1).optional(),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
    address1: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    postalCode: z.string().min(1).optional(),
  }).partial().optional(),
  customer: z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().email().optional(),
    address: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    zipCode: z.string().min(1).optional(),
  }).partial().optional(),
}).passthrough();

export type ChatWebhookInput = z.infer<typeof chatWebhookSchema>;
