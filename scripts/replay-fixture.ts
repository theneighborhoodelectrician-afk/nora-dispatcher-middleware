import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../src/config.js";
import { ScheduledJob } from "../src/domain/types.js";
import { replayAvailability, replayBooking } from "../src/replay.js";

type ReplayMode = "availability" | "booking";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !args.webhook) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const config = getConfig();
  const webhookPayload = await readJsonFile(args.webhook);
  const scheduledJobs = args.schedule ? await readJsonFile<ScheduledJob[]>(args.schedule) : [];

  const result =
    args.mode === "availability"
      ? await replayAvailability(webhookPayload, scheduledJobs, config)
      : await replayBooking(webhookPayload, scheduledJobs, config);

  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv: string[]): {
  mode?: ReplayMode;
  webhook?: string;
  schedule?: string;
} {
  const parsed: { mode?: ReplayMode; webhook?: string; schedule?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--mode") {
      parsed.mode = argv[index + 1] as ReplayMode;
      index += 1;
      continue;
    }
    if (value === "--webhook") {
      parsed.webhook = resolvePath(argv[index + 1]);
      index += 1;
      continue;
    }
    if (value === "--schedule") {
      parsed.schedule = resolvePath(argv[index + 1]);
      index += 1;
    }
  }

  return parsed;
}

function resolvePath(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  return path.resolve(process.cwd(), input);
}

async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents) as T;
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run replay -- --mode availability --webhook fixtures/ghl/availability.sample.json --schedule fixtures/hcp/schedule.sample.json");
  console.log("  npm run replay -- --mode booking --webhook fixtures/ghl/booking.sample.json --schedule fixtures/hcp/schedule.sample.json");
}

main().catch((error) => {
  console.error("Replay failed.");
  console.error(error);
  process.exitCode = 1;
});
