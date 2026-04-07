import { getConfig } from "../src/config.js";

const CANDIDATE_PATHS = [
  "/public/v1/jobs",
  "/v1/jobs",
  "/jobs",
  "/api/v1/jobs",
  "/public/jobs",
];

async function main(): Promise<void> {
  const config = getConfig();
  if (!config.hcp.token) {
    console.error("HCP_API_TOKEN is not configured.");
    process.exitCode = 1;
    return;
  }

  const start = "2026-04-06T00:00:00.000Z";
  const end = "2026-04-10T00:00:00.000Z";

  for (const path of CANDIDATE_PATHS) {
    const url = new URL(path, config.hcp.baseUrl);
    url.searchParams.set("scheduled_start_min", start);
    url.searchParams.set("scheduled_start_max", end);
    url.searchParams.set("page_size", "1");

    try {
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${config.hcp.token}`,
          accept: "application/json",
          ...(config.hcp.companyId ? { "x-company-id": config.hcp.companyId } : {}),
        },
      });

      const body = await response.text();
      console.log(`PATH ${path}`);
      console.log(`STATUS ${response.status}`);
      console.log(`BODY ${truncate(body)}`);
      console.log("");
    } catch (error) {
      console.log(`PATH ${path}`);
      console.log(`STATUS request_failed`);
      console.log(`BODY ${String(error)}`);
      console.log("");
    }
  }
}

function truncate(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
