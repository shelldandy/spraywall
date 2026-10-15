import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router";
import { useAuthStore } from "./lib/store/auth";
import AppChrome from "./components/AppChrome";
import Toaster from "./components/Toaster";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import WallsPage from "./pages/Walls";
import WallDetailPage from "./pages/WallDetail";
import RoutesPage from "./pages/Routes";
import RouteDetailPage from "./pages/RouteDetail";
import RouteCreatePage from "./pages/RouteCreate";
import LogbookPage from "./pages/Logbook";
import SettingsPage from "./pages/Settings";
import InvitePage from "./pages/Invite";

function RootLayout() {
  return (
    <>
      <AppChrome />
      <Outlet />
      <Toaster />
    </>
  );
}

/** Guards logged-in screens. Remembers where the user was headed (e.g. an invite link). */
function RequireAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}

function HomeRedirect() {
  const accessToken = useAuthStore((s) => s.accessToken);
  return <Navigate to={accessToken ? "/walls" : "/login"} replace />;
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomeRedirect /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: "/walls", element: <WallsPage /> },
          { path: "/walls/:wallId", element: <WallDetailPage /> },
          { path: "/routes", element: <RoutesPage /> },
          { path: "/routes/create", element: <RouteCreatePage /> },
          { path: "/routes/:routeId", element: <RouteDetailPage /> },
          { path: "/logbook", element: <LogbookPage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/invite/:token", element: <InvitePage /> },
        ],
      },
      { path: "*", element: <HomeRedirect /> },
    ],
  },
]);
