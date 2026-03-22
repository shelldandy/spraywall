import { Platform } from "react-native";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema";

// expo-sqlite doesn't support web (WASM import fails in Metro).
// Lazy-import it only on native platforms.
let SQLite: typeof import("expo-sqlite") | null = null;

function loadSQLite() {
  if (!SQLite) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SQLite = require("expo-sqlite") as typeof import("expo-sqlite");
  }
  return SQLite;
}

let db: ReturnType<typeof import("expo-sqlite").openDatabaseSync> | null = null;

export function isDbAvailable(): boolean {
  return Platform.OS !== "web";
}

export function getDb() {
  if (Platform.OS === "web") {
    throw new Error("SQLite is not available on web");
  }
  if (!db) {
    const sqlite = loadSQLite();
    db = sqlite.openDatabaseSync("spraywall.db");
    db.execSync("PRAGMA journal_mode = WAL;");
    db.execSync("PRAGMA foreign_keys = ON;");
    db.execSync(CREATE_TABLES);
    // Store schema version for future migrations
    db.runSync(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('schema_version', ?)",
      String(SCHEMA_VERSION),
    );
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.closeSync();
    db = null;
  }
}
