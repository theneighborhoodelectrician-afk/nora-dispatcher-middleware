import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../src/config.js";
import { HousecallProClient } from "../src/integrations/housecallPro.js";
import { parseBookingRequest } from "../src/lib/requestParsing.js";
import { createBooking } from "../src/services/booking.js";

const REQUIRED_CONFIRMATION = "CREATE_LIVE_HCP_BOOKING";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.webhook) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.confirm !== REQUIRED_CONFIRMATION) {
    console.error("Live booking test blocked.");
    console.error(`Re-run with --confirm ${REQUIRED_CONFIRMATION} if you want to create a real Housecall Pro record.`);
    process.exitCode = 1;
    return;
  }

  const config = getConfig();
  if (!config.hcp.token) {
    console.error("HCP_API_TOKEN is not configured.");
    process.exitCode = 1;
    return;
  }

  const payload = await readJsonFile(args.webhook);
  const parsed = parseBookingRequest(payload);

  console.log("About to run a live Housecall Pro booking test with:");
  console.log(JSON.stringify({
    customer: {
      firstName: parsed.request.firstName,
      lastName: parsed.request.lastName,
      phone: parsed.request.phone,
      zipCode: parsed.request.zipCode,
    },
    requestedService: parsed.request.requestedService,
    selectedSlot: parsed.selectedSlot,
  }, null, 2));

  const client = new HousecallProClient(config.hcp);
  const result = await createBooking(parsed.request, parsed.selectedSlot, client, config);
  console.log("Live booking result:");
  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv: string[]): {
  webhook?: string;
  confirm?: string;
} {
  const parsed: { webhook?: string; confirm?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--webhook") {
      parsed.webhook = path.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (value === "--confirm") {
      parsed.confirm = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents) as unknown;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run hcp:live-booking-test -- --webhook fixtures/ghl/booking.real.json --confirm CREATE_LIVE_HCP_BOOKING");
}

main().catch((error) => {
  console.error("Live booking test failed.");
  console.error(error);
  if (error && typeof error === "object" && "details" in error) {
    console.error("Error details:");
    console.error(JSON.stringify((error as { details?: unknown }).details, null, 2));
  }
  process.exitCode = 1;
});
