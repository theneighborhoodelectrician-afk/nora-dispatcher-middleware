import { getConfig } from "../src/config.js";
import { ensureStorageSchema, getStorageMode } from "../src/storage/index.js";

async function main(): Promise<void> {
  const config = getConfig();
  const mode = getStorageMode(config);

  if (mode !== "postgres") {
    console.error("POSTGRES_URL is not configured. Database initialization skipped.");
    process.exitCode = 1;
    return;
  }

  const result = await ensureStorageSchema(config);
  console.log(`Storage mode: ${result.mode}`);
  console.log(`Schema ready: ${String(result.schemaReady)}`);
}

main().catch((error) => {
  console.error("Failed to initialize storage schema.");
  console.error(error);
  process.exitCode = 1;
});
