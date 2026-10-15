import { Navigate, Outlet, useLocation } from "react-router";
import { useAuthStore } from "../lib/store/auth";
import AppChrome from "./AppChrome";
import Toaster from "./Toaster";

export function RootLayout() {
  return (
    <>
      <AppChrome />
      <Outlet />
      <Toaster />
    </>
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
