import { useLocation } from "react-router";
import { oidcLoginUrl } from "../lib/oidc";
import { useAuthConfig, useMe } from "../lib/hooks/queries";
import styles from "./AdminLapsedBanner.module.css";

export default function AdminLapsedBanner() {
  const me = useMe();
  const authConfig = useAuthConfig();
  const location = useLocation();

  if (!me.data?.admin_lapsed) return null;

  const providerName = authConfig.data?.oidc.name || "Pocket ID";
  const redirect = `${location.pathname}${location.search}`;

  return (
    <aside className={styles.banner} role="status" aria-label="Admin access notice">
      <p>Admin access expired — sign in with {providerName} to restore.</p>
      <a className="btn btn-primary" href={oidcLoginUrl(redirect)}>
        Sign in with {providerName}
      </a>
    </aside>
  );
}
