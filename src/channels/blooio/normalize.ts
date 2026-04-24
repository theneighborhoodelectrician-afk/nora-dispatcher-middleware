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
  const channel = resolveChannelFromSenderOrExternalId(sender, externalId);
  const nestedPhoneContact = stringValue(nestedContact.phone);
  const nestedPhoneCustomer = stringValue(nestedCustomer.phone);
  const nestedEmailContact = stringValue(nestedContact.email);
  const nestedEmailCustomer = stringValue(nestedCustomer.email);
  // Never put an email into phone fields. Phone comes from nested + channel only when it looks like a phone.
  const contactPhone = nestedPhoneContact ?? (channel?.kind === "phone" ? channel.raw : undefined);
  const customerPhone = nestedPhoneCustomer ?? (channel?.kind === "phone" ? channel.raw : undefined);
  const fromChannelEmail = channel?.kind === "email" ? channel.email : undefined;
  const contactEmail = nestedEmailContact ?? fromChannelEmail;
  const customerEmail = nestedEmailCustomer ?? fromChannelEmail;

  return {
    sessionId:
      stringValue(body.sessionId) ??
      stringValue(body.conversationId) ??
      stringValue(body.threadId) ??
      buildChatSessionId(sender, externalId, internalId) ??
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
      email: contactEmail,
      address1: stringValue(nestedContact.address1),
      city: stringValue(nestedContact.city),
      postalCode: stringValue(nestedContact.postalCode),
    },
    customer: {
      firstName: stringValue(nestedCustomer.firstName),
      lastName: stringValue(nestedCustomer.lastName),
      phone: customerPhone,
      email: customerEmail,
      address: stringValue(nestedCustomer.address),
      city: stringValue(nestedCustomer.city),
      zipCode: stringValue(nestedCustomer.zipCode),
    },
    raw: body,
  };
}

type ChannelFromPayload =
  | { kind: "phone"; raw: string; digits10: string }
  | { kind: "email"; email: string };

function resolveChannelFromSenderOrExternalId(
  sender: string | undefined,
  externalId: string | undefined,
): ChannelFromPayload | undefined {
  for (const raw of [stringValue(sender), stringValue(externalId)]) {
    if (!raw) {
      continue;
    }
    if (isLikelyChannelPhone(raw)) {
      const d = normalizeToTenDigitPhone(raw);
      if (d) {
        return { kind: "phone", raw, digits10: d };
      }
    }
    if (isLikelyChannelEmail(raw)) {
      return { kind: "email", email: raw.trim() };
    }
  }
  return undefined;
}

function isLikelyChannelPhone(value: string): boolean {
  return value.replace(/\D/g, "").length >= 10;
}

function isLikelyChannelEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function buildChatSessionId(
  sender: string | undefined,
  externalId: string | undefined,
  businessInternalId: string | undefined,
): string | undefined {
  const internalSegment = stringValue(businessInternalId);
  if (!internalSegment) {
    return undefined;
  }
  // Stable key: 10-digit US local part when the business id is phone-like, else literal (e.g. th-m1).
  const inId = normalizeToTenDigitPhone(internalSegment) ?? internalSegment;
  const ch = resolveChannelFromSenderOrExternalId(sender, externalId);
  if (ch?.kind === "phone") {
    return `chat:${ch.digits10}:${inId}`;
  }
  if (ch?.kind === "email") {
    return `chat:${ch.email.toLowerCase()}:${inId}`;
  }
  return undefined;
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

  const d = normalizeToTenDigitPhone(value);
  if (!d) {
    return undefined;
  }

  return `phone:${d}`;
}

function normalizeToTenDigitPhone(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) {
    return undefined;
  }

  return digits.slice(-10);
}
