import { useNavigate } from "react-router";

/** True when there's an in-app page to go back to (react-router keeps the index in history.state). */
export function hasHistory() {
  return ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
}

/**
 * Back button behaviour: go back in history, or replace to `fallback` when the page was
 * opened directly (deep link, installed PWA launch) so "back" never leaves the app.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return () => {
    if (hasHistory()) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}
