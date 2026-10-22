import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useMe } from "../lib/hooks/queries";
import styles from "./BottomNav.module.css";

const LAST_WALL_KEY = "spraywall:last-visited-wall";
function lastWall(): { wallId: string; gymSlug: string; name: string } | null {
  try { return JSON.parse(localStorage.getItem(LAST_WALL_KEY) ?? "null"); } catch { return null; }
}

export default function BottomNav() {
  const location = useLocation();
  const pathname = location.pathname.replace(/\/+$/, "") || "/";
  const profile = useMe();
  const [showActions, setShowActions] = useState(false);
  const [wall, setWall] = useState(lastWall);
  const [wallImmersive, setWallImmersive] = useState(() => document.body.classList.contains("wall-immersive"));
  useEffect(() => {
    const observer = new MutationObserver(() => setWallImmersive(document.body.classList.contains("wall-immersive")));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const syncLastWall = () => setWall(lastWall());
    window.addEventListener("storage", syncLastWall);
    window.addEventListener("spraywall:last-visited-wall", syncLastWall);
    return () => {
      window.removeEventListener("storage", syncLastWall);
      window.removeEventListener("spraywall:last-visited-wall", syncLastWall);
    };
  }, []);
  const hide = pathname === "/settings" || pathname === "/profile" ||
    pathname.startsWith("/routes/") || pathname === "/routes" ||
    pathname === "/invite" || pathname.startsWith("/invite/") ||
    (pathname.startsWith("/walls/") && new URLSearchParams(location.search).get("mode") === "create") ||
    (pathname.startsWith("/walls/") && new URLSearchParams(location.search).has("editRouteId"));
  if (hide || wallImmersive) return null;
  const routeForWall = `/walls/${wall?.wallId ?? ""}?gymSlug=${encodeURIComponent(wall?.gymSlug ?? "")}`;
  const avatar = profile.data?.avatar_url;
  return <>
    <nav className={styles.nav} aria-label="Primary navigation">
      <NavLink to="/walls" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ""}`}><Icon type="wall"/><span>Walls</span></NavLink>
      <NavLink to="/logbook" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ""}`}><Icon type="book"/><span>Logbook</span></NavLink>
      <button type="button" className={styles.add} aria-label="Create" onClick={() => setShowActions(true)}><Icon type="plus"/></button>
      {wall ? <NavLink to={`/circuits?wallId=${encodeURIComponent(wall.wallId)}&gymSlug=${encodeURIComponent(wall.gymSlug)}`} className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ""}`}><Icon type="circuit"/><span>Circuits</span></NavLink> : <button type="button" className={`${styles.item} ${styles.disabled}`} disabled><Icon type="circuit"/><span>Circuits</span></button>}
      <NavLink to="/profile" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ""}`}>{avatar ? <img className={styles.avatar} src={avatar} alt=""/> : <Icon type="profile"/>}<span>Profile</span></NavLink>
    </nav>
    {showActions && <div className={styles.overlay} onClick={() => setShowActions(false)}><section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Create" onClick={e => e.stopPropagation()}>
      <div className={styles.grabber}/>
      {wall && <Link to={`${routeForWall}&mode=create`} onClick={() => setShowActions(false)}>New climb on {wall.name}</Link>}
      <Link to="/walls" onClick={() => setShowActions(false)}>Add wall</Link>
      <Link to="/walls" onClick={() => setShowActions(false)}>Add gym</Link>
      <button type="button" onClick={() => setShowActions(false)}>Cancel</button>
    </section></div>}
  </>;
}

function Icon({ type }: { type: "wall" | "book" | "plus" | "circuit" | "profile" }) {
  const paths = { wall: <><path d="M4 20V5l16-2v17H4Z"/><path d="m8 9 1-1m4 1 1-1m-6 6 1-1m4 1 1-1"/></>, book: <><path d="M5 4h14v16H5z"/><path d="M8 8h8m-8 4h8m-8 4h5"/></>, plus: <path d="M12 5v14M5 12h14"/>, circuit: <><circle cx="6" cy="7" r="2"/><circle cx="18" cy="17" r="2"/><path d="M8 7h5a3 3 0 0 1 0 6h-2a3 3 0 0 0 0 6h5"/></>, profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></> };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}
