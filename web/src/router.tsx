import { createBrowserRouter } from "react-router";
import { RootLayout, RequireAuth, HomeRedirect, TabNavigationLayout } from "./components/Layouts";
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
import OidcCallbackPage from "./pages/OidcCallback";
import ProfilePage from "./pages/Profile";
import CircuitsPage from "./pages/Circuits";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <HomeRedirect /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      { path: "/auth/callback", element: <OidcCallbackPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <TabNavigationLayout />,
            children: [
              { path: "/walls", element: <WallsPage /> },
              { path: "/logbook", element: <LogbookPage /> },
              { path: "/settings", element: <SettingsPage /> },
            ],
          },
          { path: "/walls/:wallId", element: <WallDetailPage /> },
          { path: "/routes", element: <RoutesPage /> },
          { path: "/circuits", element: <CircuitsPage /> },
          { path: "/routes/create", element: <RouteCreatePage /> },
          { path: "/routes/:routeId", element: <RouteDetailPage /> },
          { path: "/profile", element: <ProfilePage /> },
          { path: "/invite/:token", element: <InvitePage /> },
        ],
      },
      { path: "*", element: <HomeRedirect /> },
    ],
  },
]);
