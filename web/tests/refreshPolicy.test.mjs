import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRefreshResponse,
  createSingleFlight,
  MAX_RETRY_DELAY_MS,
  queryRetryDelay,
  refreshSession,
  refreshSessionWithLock,
  RetriableRefreshError,
} from "../src/lib/api/refreshPolicy.ts";

test("refresh responses separate confirmed invalid credentials from retryable failures", () => {
  assert.deepEqual(classifyRefreshResponse(200), { kind: "success" });
  assert.deepEqual(classifyRefreshResponse(400), { kind: "invalid" });
  assert.deepEqual(classifyRefreshResponse(401), { kind: "invalid" });
  assert.deepEqual(classifyRefreshResponse(503), { kind: "retryable", retryAfterMs: undefined });
  assert.deepEqual(classifyRefreshResponse(429, "12"), { kind: "retryable", retryAfterMs: 12_000 });
});

test("Retry-After supports HTTP dates and caps invalid or excessive delays", () => {
  const now = Date.parse("Wed, 21 Oct 2015 07:27:00 GMT");
  const policy = classifyRefreshResponse(429, "Wed, 21 Oct 2015 07:27:08 GMT", now);
  assert.deepEqual(policy, { kind: "retryable", retryAfterMs: 8_000 });
  assert.equal(
    classifyRefreshResponse(429, "Wed, 21 Oct 2015 07:37:00 GMT", now).retryAfterMs,
    MAX_RETRY_DELAY_MS,
  );
  assert.equal(classifyRefreshResponse(429, "9".repeat(400)).retryAfterMs, MAX_RETRY_DELAY_MS);
  assert.equal(classifyRefreshResponse(429, "not a retry delay").retryAfterMs, undefined);
  assert.equal(queryRetryDelay(0, new RetriableRefreshError("try later", 8_000)), 8_000);
  assert.equal(
    queryRetryDelay(0, new RetriableRefreshError("try later", Number.POSITIVE_INFINITY)),
    1_000,
  );
  assert.equal(queryRetryDelay(0, new RetriableRefreshError("try later", 90_000)), MAX_RETRY_DELAY_MS);
  assert.equal(queryRetryDelay(2, new Error("other error")), 4_000);
});

function refreshResponse(status, data, retryAfter = null) {
  return {
    status,
    headers: { get: (name) => name === "Retry-After" ? retryAfter : null },
    json: async () => data,
  };
}

test("refresh success stores rotated tokens; confirmed invalid credentials log out", async () => {
  let tokens = null;
  let logouts = 0;
  const onTokens = (access, refresh) => { tokens = [access, refresh]; };
  const onInvalid = async () => { logouts += 1; };

  assert.equal(await refreshSession(
    "old-refresh",
    async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), { refresh_token: "old-refresh" });
      return refreshResponse(200, { access_token: "new-access", refresh_token: "new-refresh" });
    },
    onTokens,
    onInvalid,
  ), true);
  assert.deepEqual(tokens, ["new-access", "new-refresh"]);
  assert.equal(logouts, 0);

  for (const status of [400, 401]) {
    const refreshed = await refreshSession(
      "bad-refresh",
      async () => refreshResponse(status, { error: "invalid" }),
      onTokens,
      onInvalid,
    );
    assert.equal(refreshed, false);
  }
  assert.equal(logouts, 2);
  assert.deepEqual(tokens, ["new-access", "new-refresh"]);
});

test("offline and transient responses retain tokens and produce retriable errors", async () => {
  let logouts = 0;
  const keepTokens = () => assert.fail("transient failure must not replace tokens");
  const onInvalid = async () => { logouts += 1; };

  await assert.rejects(
    refreshSession("current-refresh", async () => { throw new TypeError("offline"); }, keepTokens, onInvalid),
    (error) => error instanceof RetriableRefreshError,
  );
  for (const [status, retryAfter, expectedDelay] of [[429, "7", 7_000], [503, null, undefined]]) {
    await assert.rejects(
      refreshSession("current-refresh", async () => refreshResponse(status, {}, retryAfter), keepTokens, onInvalid),
      (error) => error instanceof RetriableRefreshError && error.retryAfterMs === expectedDelay,
    );
  }
  assert.equal(logouts, 0);
});

test("cross-tab lock reloads rotated tokens before refreshing", async () => {
  let tokens = { accessToken: "old-access", refreshToken: "old-refresh" };
  let calls = 0;
  let tail = Promise.resolve();
  const withLock = async (task) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  };
  const refresh = () => refreshSessionWithLock(
    "old-access",
    withLock,
    async () => {},
    () => tokens,
    async () => {
      calls += 1;
      return refreshResponse(200, { access_token: "new-access", refresh_token: "new-refresh" });
    },
    (accessToken, refreshToken) => { tokens = { accessToken, refreshToken }; },
    async () => {},
  );

  assert.deepEqual(await Promise.all([refresh(), refresh()]), [true, true]);
  assert.equal(calls, 1);
  assert.deepEqual(tokens, { accessToken: "new-access", refreshToken: "new-refresh" });
});

test("stale refresh failure does not invalidate a newer session", async () => {
  let tokens = { accessToken: "old-access", refreshToken: "old-refresh" };
  let rehydrates = 0;
  let invalidations = 0;
  let attemptedRefreshToken;

  const refreshed = await refreshSessionWithLock(
    "old-access",
    (task) => task(),
    async () => {
      rehydrates += 1;
      if (rehydrates === 2) tokens = { accessToken: "new-access", refreshToken: "new-refresh" };
    },
    () => tokens,
    async (_url, init) => {
      attemptedRefreshToken = JSON.parse(init.body).refresh_token;
      return refreshResponse(401, { error: "rotated elsewhere" });
    },
    () => assert.fail("invalid refresh must not store tokens"),
    async () => { invalidations += 1; },
  );

  assert.equal(refreshed, false);
  assert.equal(attemptedRefreshToken, "old-refresh");
  assert.equal(invalidations, 0);
  assert.deepEqual(tokens, { accessToken: "new-access", refreshToken: "new-refresh" });
});

test("concurrent refresh callers share one request and later calls can retry", async () => {
  let calls = 0;
  let respond;
  const fetcher = () => {
    calls += 1;
    return new Promise((resolve) => { respond = resolve; });
  };
  const singleFlight = createSingleFlight(() => refreshSession(
    "refresh-token",
    fetcher,
    () => {},
    async () => {},
  ));

  const first = singleFlight();
  const second = singleFlight();
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  respond(refreshResponse(200, { access_token: "access", refresh_token: "rotated" }));
  assert.deepEqual(await Promise.all([first, second]), [true, true]);

  const later = singleFlight();
  assert.equal(calls, 2);
  respond(refreshResponse(200, { access_token: "access-2", refresh_token: "rotated-2" }));
  assert.equal(await later, true);
});
