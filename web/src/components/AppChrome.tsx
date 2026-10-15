import { useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import styles from "./AppChrome.module.css";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine);
}

/** Banners shown above every screen: offline notice and "new version" prompt. */
export default function AppChrome() {
  const online = useOnline();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <>
      {!online && (
        <div className={styles.offline}>Offline — showing saved data. Changes need a connection.</div>
      )}
      {needRefresh && (
        <div className={styles.update}>
          <span>A new version is available.</span>
          <button className="btn btn-primary" onClick={() => updateServiceWorker(true)}>
            Reload
          </button>
          <button className="btn btn-ghost" onClick={() => setNeedRefresh(false)}>
            Later
          </button>
        </div>
      )}
    </>
  );
}
