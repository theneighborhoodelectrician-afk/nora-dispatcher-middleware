import { AppConfig } from "../../config.js";
import { HousecallProClient } from "../../integrations/housecallPro.js";
import { HcpAdapter, HcpAvailabilityInput, HcpCreateBookingInput, HcpFindOrCreateCustomerInput } from "./types.js";

export class BookSmartHcpAdapter implements HcpAdapter {
  readonly rawClient: HousecallProClient;

  constructor(config: AppConfig["hcp"] | HousecallProClient) {
    this.rawClient =
      config instanceof HousecallProClient ? config : new HousecallProClient(config);
  }

  async getAvailability(input: HcpAvailabilityInput): Promise<{
    scheduledJobs: Awaited<ReturnType<HousecallProClient["fetchScheduledJobs"]>>;
  }> {
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return {
      scheduledJobs: await this.rawClient.fetchScheduledJobs(
        now.toISOString(),
        rangeEnd.toISOString(),
      ),
    };
  }

  async findOrCreateCustomer(input: HcpFindOrCreateCustomerInput): Promise<{ customerId: string }> {
    const customerId = await this.rawClient.findOrCreateCustomer(input);
    return { customerId };
  }

  async createBooking(input: HcpCreateBookingInput): Promise<{ id: string }> {
    return this.rawClient.createBooking(input);
  }
}
