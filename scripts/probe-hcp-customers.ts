import { getConfig } from "../src/config.js";

const CANDIDATE_PATHS = [
  "/customers",
  "/customer",
  "/public/v1/customers",
  "/v1/customers",
  "/api/v1/customers",
];

async function main(): Promise<void> {
  const config = getConfig();
  if (!config.hcp.token) {
    console.error("HCP_API_TOKEN is not configured.");
    process.exitCode = 1;
    return;
  }

  for (const path of CANDIDATE_PATHS) {
    const url = new URL(path, config.hcp.baseUrl);
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
