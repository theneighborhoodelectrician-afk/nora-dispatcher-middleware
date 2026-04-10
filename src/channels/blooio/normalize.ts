export interface NormalizedBlooioMessage {
  sessionId?: string;
  messageId?: string;
  text?: string;
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
  const nestedMessage = asRecord(body.message);
  const nestedContact = asRecord(body.contact);
  const nestedCustomer = asRecord(body.customer);

  return {
    sessionId: stringValue(body.sessionId) ?? stringValue(body.conversationId) ?? stringValue(body.threadId) ?? stringValue(nestedContact.id),
    messageId: stringValue(body.messageId) ?? stringValue(nestedMessage.id),
    text: stringValue(body.text) ?? stringValue(body.body) ?? stringValue(nestedMessage.text) ?? stringValue(nestedMessage.body),
    contact: {
      id: stringValue(nestedContact.id),
      firstName: stringValue(nestedContact.firstName),
      lastName: stringValue(nestedContact.lastName),
      phone: stringValue(nestedContact.phone),
      email: stringValue(nestedContact.email),
      address1: stringValue(nestedContact.address1),
      city: stringValue(nestedContact.city),
      postalCode: stringValue(nestedContact.postalCode),
    },
    customer: {
      firstName: stringValue(nestedCustomer.firstName),
      lastName: stringValue(nestedCustomer.lastName),
      phone: stringValue(nestedCustomer.phone),
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
