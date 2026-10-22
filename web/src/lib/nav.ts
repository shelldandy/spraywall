import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

export function useNavVisibility(routeKey: string) {
  const [state, setState] = useState({ routeKey, visible: true });
  useEffect(() => {
    let previous = window.scrollY;
    const onScroll = () => {
      const current = window.scrollY;
      if (Math.abs(current - previous) > 4) {
        setState({ routeKey, visible: current < 40 || current < previous });
      }
      previous = current;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [routeKey]);
  return state.routeKey !== routeKey || state.visible;
}

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
