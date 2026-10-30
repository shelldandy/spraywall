export const POLL_INTERVAL_MS = 4000;

export function isDetecting(status: string | null | undefined) {
  return status === "pending" || status === "processing";
}

export function wallDetailPollInterval(
  detectionStatus: string | null | undefined,
  pendingResetStatus: string | null | undefined,
  pollPendingReset = false,
): number | false {
  return isDetecting(detectionStatus) || (pollPendingReset && isDetecting(pendingResetStatus))
    ? POLL_INTERVAL_MS
    : false;
}
