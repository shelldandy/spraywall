import { Navigate, Outlet, useLocation } from "react-router";
import { useAuthStore } from "../lib/store/auth";
import AppChrome from "./AppChrome";
import Toaster from "./Toaster";
import BottomNav from "./BottomNav";

export function RootLayout() {
  const { pathname, search } = useLocation();
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);
  const wallDetail = /^\/walls\/[^/]+$/.test(normalizedPathname);
  const wallImmersive = wallDetail && (params.get("mode") === "create" || params.has("editRouteId"));
  const navVisible = ["/walls", "/logbook", "/circuits"].includes(normalizedPathname) || (wallDetail && !wallImmersive);

  return (
    <div className={`app-layout${navVisible ? " nav-visible" : ""}`}>
      <AppChrome />
      <Outlet />
      <BottomNav />
      <Toaster />
    </div>
  );
}

/** Guards logged-in screens. Remembers where the user was headed (e.g. an invite link). */
export function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

export function HomeRedirect() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return <Navigate to={accessToken ? "/walls" : "/login"} replace />;
}
