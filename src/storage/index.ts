import { Pool } from "pg";
import { AppConfig } from "../config.js";
import { MemoryStorageAdapter } from "./memory.js";
import { PostgresStorageAdapter } from "./postgres.js";
import { STORAGE_SCHEMA_STATEMENTS } from "./schema.js";
import { StorageAdapter } from "./types.js";

let cachedStorage: StorageAdapter | undefined;
let cachedPool: Pool | undefined;
let cachedMode: "memory" | "postgres" | undefined;
let schemaEnsured = false;

export function getStorageAdapter(config: AppConfig): StorageAdapter {
  if (cachedStorage) {
    return cachedStorage;
  }

  if (config.storage.postgresUrl) {
    cachedPool ??= new Pool({
      connectionString: config.storage.postgresUrl,
      max: 3,
    });
    cachedStorage = new PostgresStorageAdapter(cachedPool);
    cachedMode = "postgres";
    return cachedStorage;
  }

  cachedStorage = new MemoryStorageAdapter();
  cachedMode = "memory";
  return cachedStorage;
}

export function getStorageMode(config: AppConfig): "memory" | "postgres" {
  if (cachedMode) {
    return cachedMode;
  }
  return config.storage.postgresUrl ? "postgres" : "memory";
}

export async function ensureStorageSchema(config: AppConfig): Promise<{
  mode: "memory" | "postgres";
  schemaReady: boolean;
}> {
  const mode = getStorageMode(config);
  if (mode === "memory") {
    return {
      mode,
      schemaReady: false,
    };
  }

  cachedPool ??= new Pool({
    connectionString: config.storage.postgresUrl,
    max: 3,
  });

  if (!schemaEnsured) {
    for (const statement of STORAGE_SCHEMA_STATEMENTS) {
      await cachedPool.query(statement);
    }
    schemaEnsured = true;
  }

  return {
    mode,
    schemaReady: true,
  };
}

export async function prepareStorage(config: AppConfig): Promise<{
  mode: "memory" | "postgres";
  schemaReady: boolean;
}> {
  const mode = getStorageMode(config);
  if (mode === "memory") {
    return {
      mode,
      schemaReady: false,
    };
  }

  if (!config.storage.autoInit) {
    return {
      mode,
      schemaReady: schemaEnsured,
    };
  }

  return ensureStorageSchema(config);
}
