export const MAX_RETRY_DELAY_MS = 30_000;

export type RefreshResponsePolicy =
  | { kind: "success" }
  | { kind: "invalid" }
  | { kind: "retryable"; retryAfterMs?: number };

export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.min(MAX_RETRY_DELAY_MS, seconds * 1000) : MAX_RETRY_DELAY_MS;
  }
  const date = Date.parse(trimmed);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, date - now));
}

export function classifyRefreshResponse(
  status: number,
  retryAfter?: string | null,
  now = Date.now(),
): RefreshResponsePolicy {
  if (status >= 200 && status < 300) return { kind: "success" };
  if (status === 400 || status === 401) return { kind: "invalid" };
  return { kind: "retryable", retryAfterMs: parseRetryAfter(retryAfter, now) };
}

export async function refreshSession(
  refreshToken: string | null,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  onTokens: (accessToken: string, refreshToken: string) => void,
  onInvalid: () => Promise<unknown>,
  endpoint = "/api/auth/refresh",
): Promise<boolean> {
  if (!refreshToken) return false;

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    throw new RetriableRefreshError("Could not refresh your session. Please try again.");
  }

  const policy = classifyRefreshResponse(response.status, response.headers.get("Retry-After"));
  if (policy.kind === "invalid") {
    await onInvalid();
    return false;
  }
  if (policy.kind === "retryable") {
    throw new RetriableRefreshError(
      "Could not refresh your session. Please try again.",
      policy.retryAfterMs,
    );
  }

  let data: { access_token?: unknown; refresh_token?: unknown };
  try {
    data = await response.json();
  } catch {
    throw new RetriableRefreshError("The server returned an invalid session response.");
  }
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new RetriableRefreshError("The server returned an invalid session response.");
  }
  onTokens(data.access_token, data.refresh_token);
  return true;
}

export class RetriableRefreshError extends Error {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = "RetriableRefreshError";
    this.retryAfterMs = retryAfterMs;
  }
}

export function queryRetryDelay(attemptIndex: number, error: unknown): number {
  const retryAfterMs = error instanceof RetriableRefreshError ? error.retryAfterMs : undefined;
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs)) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAfterMs));
  }
  return Math.min(1000 * 2 ** attemptIndex, MAX_RETRY_DELAY_MS);
}

export function createSingleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = task().finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}
