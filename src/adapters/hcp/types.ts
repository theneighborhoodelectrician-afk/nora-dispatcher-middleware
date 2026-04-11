import { CustomerRequest } from "../../domain/types.js";
import { HousecallProClient } from "../../integrations/housecallPro.js";

export interface HcpAvailabilityInput {
  customerRequest: CustomerRequest;
}

export interface HcpFindOrCreateCustomerInput {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  address?: string;
  zipCode: string;
}

export interface HcpCreateBookingInput {
  customer: HcpFindOrCreateCustomerInput;
  serviceName: string;
  notes?: string;
  start: string;
  end: string;
  technician: string;
  target: "job" | "estimate";
}

export interface HcpCreateLeadInput {
  customer: HcpFindOrCreateCustomerInput & {
    city?: string;
  };
  serviceName: string;
  requestedWindow?: "morning" | "afternoon";
  leadSource?: string;
  notes?: string;
}

export interface HcpAdapter {
  readonly rawClient: HousecallProClient;
  getAvailability(input: HcpAvailabilityInput): Promise<{
    scheduledJobs: Awaited<ReturnType<HousecallProClient["fetchScheduledJobs"]>>;
  }>;
  findOrCreateCustomer(input: HcpFindOrCreateCustomerInput): Promise<{ customerId: string }>;
  createBooking(input: HcpCreateBookingInput): Promise<{ id: string }>;
  createLead(input: HcpCreateLeadInput): Promise<{ id: string }>;
}
