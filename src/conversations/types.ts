export type LeadSourceCode =
  | "website"
  | "blooio"
  | "qr_code"
  | "lsa"
  | "gbp"
  | "after_hours_text"
  | "manual_link"
  | "internal_test"
  | "unknown";

export type ConversationStage =
  | "started"
  | "city_collected"
  | "service_identified"
  | "address_collected"
  | "contact_collected"
  | "lead_submitted"
  | "photo_requested"
  | "photo_received"
  | "availability_presented"
  | "slot_selected"
  | "booked"
  | "escalated"
  | "abandoned"
  | "failed";

export type UrgencyLevel = "normal" | "urgent";

export interface LeadSourceRecord {
  code: LeadSourceCode;
  displayName: string;
  active: boolean;
}

export interface ContactRecord {
  contactId: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  updatedAt: number;
}

export interface ConversationRecord {
  conversationId: string;
  contactId?: string;
  leadSource: LeadSourceCode;
  timestampStarted: number;
  timestampLastMessage: number;
  currentStage: ConversationStage;
}

export interface ConversationOutcomeRecord {
  conversationId: string;
  leadSource: LeadSourceCode;
  timestampStarted: number;
  timestampLastMessage: number;
  firstCustomerMessage: string;
  classifiedServiceType?: string;
  urgencyLevel: UrgencyLevel;
  urgencyKeywordsDetected: string[];
  addressCollected: boolean;
  phoneCollected: boolean;
  emailCollected: boolean;
  photoSent: boolean;
  availabilityShown: boolean;
  slotsShownCount: number;
  slotSelected: boolean;
  bookedYesNo: boolean;
  handoffYesNo: boolean;
  abandonmentStage?: string;
  finalHcpJobType?: string;
  finalBookingStatus?: string;
  systemSummary?: string;
}

export interface ConversationStageHistoryRecord {
  conversationId: string;
  stage: ConversationStage;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface SlotExposureRecord {
  conversationId: string;
  slotOptionId: string;
  slotLabel: string;
  slotStart: string;
  slotEnd: string;
  slotOrderPresented: number;
  selectedYesNo: boolean;
  timestamp: number;
}

export interface UrgencyKeywordHitRecord {
  conversationId: string;
  keywordDetected: string;
  mappedUrgencyLevel: UrgencyLevel;
  timestamp: number;
}

export interface ConversationMessageRecord {
  conversationId: string;
  direction: "inbound" | "outbound" | "tool";
  text?: string;
  timestamp: number;
  toolName?: string;
  toolCallSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface BookingEventRecord {
  conversationId: string;
  bookingExternalId?: string;
  finalHcpJobType?: string;
  bookingStatus: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface HandoffEventRecord {
  conversationId: string;
  reason: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
