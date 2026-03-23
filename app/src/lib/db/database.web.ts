// SQLite is not available on web — expo-sqlite requires WASM which Metro can't bundle.
// All functions are no-ops or throw so the rest of the app can fall back to network fetches.

export function isDbAvailable(): boolean {
  return false;
}

export function getDb(): never {
  throw new Error("SQLite is not available on web");
}

export function closeDb() {
  // no-op
}
