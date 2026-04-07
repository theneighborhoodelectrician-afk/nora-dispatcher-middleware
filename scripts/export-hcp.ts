import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../src/config.js";
import { HousecallJobResponse, HousecallProClient } from "../src/integrations/housecallPro.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.start || !args.end) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const config = getConfig();
  if (!config.hcp.token) {
    console.error("HCP_API_TOKEN is not configured.");
    process.exitCode = 1;
    return;
  }

  const client = new HousecallProClient(config.hcp);
  const rawPages = await client.fetchSchedulePages(args.start, args.end);
  const normalized = await client.fetchScheduledJobs(args.start, args.end);

  const outputDir = args.outDir ?? path.resolve(process.cwd(), "fixtures/hcp");
  await fs.mkdir(outputDir, { recursive: true });

  const slug = `${safeStamp(args.start)}_${safeStamp(args.end)}`;
  const rawPath = path.join(outputDir, `schedule.raw.${slug}.json`);
  const normalizedPath = path.join(outputDir, `schedule.normalized.${slug}.json`);

  await fs.writeFile(rawPath, JSON.stringify(rawPages, null, 2));
  await fs.writeFile(normalizedPath, JSON.stringify(normalized, null, 2));

  console.log(`Saved raw schedule pages to ${rawPath}`);
  console.log(`Saved normalized schedule data to ${normalizedPath}`);
  console.log(`Pages fetched: ${rawPages.length}`);
  console.log(`Normalized jobs: ${normalized.length}`);
  printShapeHints(rawPages);
}

function parseArgs(argv: string[]): {
  start?: string;
  end?: string;
  outDir?: string;
} {
  const parsed: { start?: string; end?: string; outDir?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--start") {
      parsed.start = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--end") {
      parsed.end = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--out-dir") {
      parsed.outDir = path.resolve(process.cwd(), argv[index + 1] ?? "");
      index += 1;
    }
  }

  return parsed;
}

function safeStamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function printShapeHints(rawPages: HousecallJobResponse[]): void {
  const firstPage = rawPages[0];
  if (!firstPage) {
    console.log("No pages returned from Housecall Pro.");
    return;
  }

  const keys = Object.keys(firstPage);
  console.log(`Top-level keys on first page: ${keys.join(", ")}`);

  const firstJob = (firstPage.jobs ?? firstPage.data ?? [])[0];
  if (firstJob) {
    console.log(`Top-level keys on first job: ${Object.keys(firstJob).join(", ")}`);
  }
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run hcp:export -- --start 2026-04-06T00:00:00.000Z --end 2026-04-10T00:00:00.000Z");
}

main().catch((error) => {
  console.error("Housecall Pro export failed.");
  console.error(error);
  if (error && typeof error === "object" && "details" in error) {
    console.error("Error details:");
    console.error(JSON.stringify((error as { details?: unknown }).details, null, 2));
  }
  process.exitCode = 1;
});
