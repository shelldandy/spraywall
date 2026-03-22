import * as SQLite from "expo-sqlite";
import { CREATE_TABLES, SCHEMA_VERSION } from "./schema";

let db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync("spraywall.db");
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
