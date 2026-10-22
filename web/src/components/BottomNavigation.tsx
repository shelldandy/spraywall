import { NavLink } from "react-router";
import styles from "./BottomNavigation.module.css";

const tabs = [
  { to: "/walls", label: "Walls", icon: WallsIcon },
  { to: "/logbook", label: "Logbook", icon: LogbookIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function BottomNavigation() {
  return (
    <nav className={styles.navigation} aria-label="Primary">
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => `${styles.tab}${isActive ? ` ${styles.active}` : ""}`}
        >
          <Icon />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function WallsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V5l16-2v17H4Z" />
      <path d="m8 9 1.5-.3m4-.5 1.5-.2M8 14l1.5-.3m4-.5 1.5-.2" />
    </svg>
  );
}

function LogbookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H20v18H7.5A2.5 2.5 0 0 1 5 17.5v-13Z" />
      <path d="M5 17.5A2.5 2.5 0 0 1 7.5 15H20M9 7h7m-7 4h7" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
    </svg>
  );
}
