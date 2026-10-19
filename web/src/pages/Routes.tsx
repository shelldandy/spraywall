import { useSearchParams } from "react-router";
import { useHolds, useRoutes, useWallDetail } from "../lib/hooks/queries";
import RouteList from "./RouteList";
import styles from "./Routes.module.css";
import { useGoBack } from "../lib/nav";
import { parseRouteTags } from "../lib/routeTags";

export default function RoutesPage() {
  const [params] = useSearchParams();
  const wallId = params.get("wallId") ?? "";
  const gymSlug = params.get("gymSlug") ?? undefined;

  const routesQuery = useRoutes(wallId, gymSlug);
  const wallQuery = useWallDetail(wallId, gymSlug);
  const holdsQuery = useHolds(wallId, wallQuery.data?.detection_status === "done", gymSlug);

  const routes = routesQuery.data ?? [];
  const holds = holdsQuery.data ?? [];
  const imageUrl = wallQuery.data?.image?.image_url ?? null;

  const fallbackParams = new URLSearchParams(params);
  fallbackParams.set("wallId", wallId);
  fallbackParams.set("gymSlug", gymSlug ?? "");
  fallbackParams.delete("tag");
  for (const tag of parseRouteTags(params.getAll("tag"))) fallbackParams.append("tag", tag);
  const goBack = useGoBack(`/walls/${wallId}?${fallbackParams}`);

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className={`btn btn-ghost ${styles.side}`} onClick={goBack}>
          {"< Back"}
        </button>
        <h1 className={styles.title}>Routes</h1>
        <span className={styles.side} />
      </header>

      <main className={`content ${styles.body}`}>
        {routesQuery.isLoading ? (
          <div className={styles.loader}>
            <div className="spinner" />
          </div>
        ) : routesQuery.isError && !routesQuery.data ? (
          <p className={`error-text ${styles.empty}`}>{routesQuery.error.message}</p>
        ) : routes.length === 0 ? (
          <p className={styles.empty}>No routes yet. Select holds on the wall to create one.</p>
        ) : (
          <RouteList
            routes={routes}
            holds={holds}
            imageUrl={imageUrl}
            wallId={wallId}
            gymSlug={gymSlug ?? ""}
          />
        )}
      </main>
    </div>
  );
}
