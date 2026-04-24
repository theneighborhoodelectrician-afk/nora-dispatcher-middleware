export interface NormalizedBlooioMessage {
  sessionId?: string;
  messageId?: string;
  leadSource?: string;
  text?: string;
  mediaUrls?: string[];
  attachments?: Array<{
    type?: string;
    url?: string;
  }>;
  contact?: {
    id?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    address1?: string;
    city?: string;
    postalCode?: string;
  };
  customer?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    zipCode?: string;
  };
  raw: unknown;
}

export function normalizeBlooioInboundPayload(body: Record<string, unknown>): NormalizedBlooioMessage {
  console.log("[BLOOIO RAW]", JSON.stringify(body).slice(0, 500));
  const nestedMessage = asRecord(body.message);
  const nestedContact = asRecord(body.contact);
  const nestedCustomer = asRecord(body.customer);
  const externalId = stringValue(body.external_id);
  const sender = stringValue(body.sender);
  const internalId = stringValue(body.internal_id);
  const contactPhone = stringValue(nestedContact.phone) ?? sender ?? externalId;
  const customerPhone = stringValue(nestedCustomer.phone) ?? externalId ?? sender;

  return {
    sessionId:
      stringValue(body.sessionId) ??
      stringValue(body.conversationId) ??
      stringValue(body.threadId) ??
      normalizeConversationSessionId(externalId ?? sender, internalId) ??
      stringValue(nestedContact.id) ??
      normalizePhoneSessionId(contactPhone) ??
      normalizePhoneSessionId(customerPhone),
    messageId: stringValue(body.messageId) ?? stringValue(body.message_id) ?? stringValue(nestedMessage.id),
    leadSource: stringValue(body.leadSource) ?? stringValue(body.source),
    text: stringValue(body.text) ?? stringValue(body.body) ?? stringValue(nestedMessage.text) ?? stringValue(nestedMessage.body),
    mediaUrls: stringArrayValue(body.mediaUrls),
    attachments: attachmentArrayValue(body.attachments),
    contact: {
      id: stringValue(nestedContact.id) ?? internalId,
      firstName: stringValue(nestedContact.firstName),
      lastName: stringValue(nestedContact.lastName),
      phone: contactPhone,
      email: stringValue(nestedContact.email),
      address1: stringValue(nestedContact.address1),
      city: stringValue(nestedContact.city),
      postalCode: stringValue(nestedContact.postalCode),
    },
    customer: {
      firstName: stringValue(nestedCustomer.firstName),
      lastName: stringValue(nestedCustomer.lastName),
      phone: customerPhone,
      email: stringValue(nestedCustomer.email),
      address: stringValue(nestedCustomer.address),
      city: stringValue(nestedCustomer.city),
      zipCode: stringValue(nestedCustomer.zipCode),
    },
    raw: body,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return items.length ? items : undefined;
}

function attachmentArrayValue(
  value: unknown,
): Array<{ type?: string; url?: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item) => asRecord(item))
    .map((item) => ({
      type: stringValue(item.type),
      url: stringValue(item.url),
    }))
    .filter((item) => item.type || item.url);

  return items.length ? items : undefined;
}

function normalizePhoneSessionId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return undefined;
  }

  return `phone:${digits.slice(-10)}`;
}

function normalizeConversationSessionId(
  customerValue: string | undefined,
  businessValue: string | undefined,
): string | undefined {
  const customer = normalizePhoneDigits(customerValue);
  if (!customer) {
    return undefined;
  }

  const business = normalizePhoneDigits(businessValue);
  return business ? `chat:${customer}:${business}` : `phone:${customer}`;
}

function normalizePhoneDigits(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return undefined;
  }

  return digits.slice(-10);
}
