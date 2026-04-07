import { getConfig } from "../src/config.js";
import { getStorageMode } from "../src/storage/index.js";

async function main(): Promise<void> {
  const config = getConfig();
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!config.hcp.token) {
    issues.push("Missing HCP_API_TOKEN");
  }
  if (config.hcp.baseUrl !== "https://api.housecallpro.com") {
    warnings.push(`HCP_API_BASE_URL is set to ${config.hcp.baseUrl}`);
  }
  if (config.hcp.customerPath !== "/customers") {
    warnings.push(`HCP_CUSTOMER_PATH is ${config.hcp.customerPath}, expected /customers from live validation`);
  }
  if (config.hcp.schedulePath !== "/jobs") {
    warnings.push(`HCP_SCHEDULE_PATH is ${config.hcp.schedulePath}, expected /jobs from live validation`);
  }
  if (config.hcp.createJobPath !== "/jobs") {
    warnings.push(`HCP_CREATE_JOB_PATH is ${config.hcp.createJobPath}, expected /jobs from live validation`);
  }
  if (!config.ghl.webhookSecret) {
    warnings.push("GHL_WEBHOOK_SECRET is not set yet");
  }

  const storageMode = getStorageMode(config);
  if (storageMode === "memory") {
    warnings.push("POSTGRES_URL is not configured; idempotency and logs will be in-memory only");
  }

  if (config.scheduling.defaultSlotCount !== 3) {
    warnings.push(`DEFAULT_SLOT_COUNT is ${config.scheduling.defaultSlotCount}; business rule target is 3`);
  }

  console.log("Deployment readiness check");
  console.log("");
  console.log("Resolved configuration:");
  console.log(JSON.stringify({
    environment: config.environment,
    hcpBaseUrl: config.hcp.baseUrl,
    hcpCustomerPath: config.hcp.customerPath,
    hcpSchedulePath: config.hcp.schedulePath,
    hcpCreateJobPath: config.hcp.createJobPath,
    hcpCreateEstimatePath: config.hcp.createEstimatePath,
    storageMode,
    autoInitStorage: config.storage.autoInit,
    timezone: config.scheduling.timezone,
    slotCount: config.scheduling.defaultSlotCount,
  }, null, 2));
  console.log("");

  if (issues.length) {
    console.log("Blocking issues:");
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
  } else {
    console.log("Blocking issues:");
    console.log("- none");
  }
  console.log("");

  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  } else {
    console.log("Warnings:");
    console.log("- none");
  }
  console.log("");

  if (issues.length) {
    process.exitCode = 1;
    return;
  }

  console.log("Status: ready to continue deployment hardening");
}

main().catch((error) => {
  console.error("Deployment check failed.");
  console.error(error);
  process.exitCode = 1;
});
