export function shouldLoadHolds(status: string | null | undefined, userRole: string | undefined) {
  return status === "done" ||
    (status === "failed" && (userRole === "setter" || userRole === "admin"));
}

export function canEditWallHolds(
  status: string | null | undefined,
  userRole: string | undefined,
  hasActiveImage: boolean,
) {
  return hasActiveImage &&
    (userRole === "setter" || userRole === "admin") &&
    (status === "done" || status === "failed");
}
