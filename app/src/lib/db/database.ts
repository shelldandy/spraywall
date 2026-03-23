// This file exists for TypeScript resolution.
// At runtime, Metro uses database.native.ts (iOS/Android) or database.web.ts (web).
import type { SQLiteDatabase } from "expo-sqlite";

export function isDbAvailable(): boolean {
  return false;
}

export function getDb(): SQLiteDatabase {
  throw new Error("SQLite is not available");
}

export function closeDb(): void {
  // no-op
}
