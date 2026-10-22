import { useLocation, useSearchParams, NavLink } from "react-router";
import { useNavVisibility } from "../lib/nav";
import styles from "./PrimaryNav.module.css";

const icons: Record<string, React.ReactNode> = {
  walls: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4h16v16M4 10h16M10 4v6m4 0v10" /></svg>,
  logbook: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /></svg>,
  settings: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2m9-9h-2M5 12H3m15.36-6.36-1.41 1.41M7.05 16.95l-1.41 1.41m12.72 0-1.41-1.41M7.05 7.05 5.64 5.64" /></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h14" /></svg>,
  board: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM8 8h8v8H8z" /></svg>,
  climbs: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20 10 5l4 8 2-4 3 11M4 20h16" /></svg>,
  circuits: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4v8l6 5" /></svg>,
};

export default function PrimaryNav() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const [params] = useSearchParams();
  const wallDetail = pathname.match(/^\/walls\/([^/]+)$/);
  const wallId = wallDetail?.[1] ?? params.get("wallId");
  const gymSlug = params.get("gymSlug") ?? "";
  const hiddenMode = pathname === "/routes/create" ||
    (pathname.startsWith("/walls/") && (params.get("mode") === "create" || params.has("editRouteId")));
  const visible = useNavVisibility();
  if (hiddenMode || pathname === "/profile" || pathname.startsWith("/routes/") || pathname.startsWith("/invite/")) return null;
  const contextual = !!wallId && (wallDetail !== null || pathname === "/routes" || pathname === "/circuits");
  const suffix = `?${new URLSearchParams({ wallId: wallId ?? "", gymSlug })}`;
  const links = contextual ? [
    { to: "/walls", label: "Walls", icon: "back", end: true },
    { to: `/walls/${wallId}${suffix}`, label: "Board", icon: "board", end: false },
    { to: `/routes${suffix}`, label: "Climbs", icon: "climbs", end: true },
    { to: `/circuits${suffix}`, label: "Circuits", icon: "circuits", end: true },
  ] : [
    { to: "/walls", label: "Walls", icon: "walls", end: true },
    { to: "/logbook", label: "Logbook", icon: "logbook", end: true },
    { to: "/settings", label: "Settings", icon: "settings", end: true },
  ];
  return <nav className={`${styles.dock} primary-nav-dock ${visible ? "" : styles.hidden}`} aria-label="Primary" style={{ "--active-index": Math.max(0, links.findIndex((link) => pathname === link.to.split("?")[0])) } as React.CSSProperties}>
    <span className={styles.activePill} />
    {links.map((link) => <NavLink key={link.label} to={link.to} end={link.end} aria-label={link.label} className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}>
      {icons[link.icon]}<span>{link.label}</span>
    </NavLink>)}
  </nav>;
}
