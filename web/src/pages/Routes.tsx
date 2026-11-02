import { Link, useSearchParams } from "react-router";
import { shouldLoadHolds, useCircuits, useHolds, useRoutes, useWallDetail } from "../lib/hooks/queries";
import RouteList from "./RouteList";
import styles from "./Routes.module.css";
import { parseRouteTags } from "../lib/routeTags";

export default function RoutesPage() {
  const [params] = useSearchParams();
  const wallId = params.get("wallId") ?? "";
  const routesQuery = useRoutes(wallId);
  const circuitsQuery = useCircuits(wallId);
  const wallQuery = useWallDetail(wallId);
  const holdsEnabled = shouldLoadHolds(wallQuery.data?.detection_status, wallQuery.data?.user_role);
  const holdsQuery = useHolds(wallId, holdsEnabled);

  const routes = routesQuery.data ?? [];
  const holds = holdsEnabled ? holdsQuery.data ?? [] : [];
  const imageUrl = wallQuery.data?.image?.image_url ?? null;

  const fallbackParams = new URLSearchParams(params);
  fallbackParams.set("wallId", wallId);
  fallbackParams.delete("gymSlug");
  fallbackParams.delete("tag");
  for (const tag of parseRouteTags(params.getAll("tag"))) fallbackParams.append("tag", tag);
  const backUrl = `/walls/${wallId}?${fallbackParams}`;

  return (
    <div className="screen">
      <header className="header">
        <Link className={`btn btn-ghost ${styles.side}`} to={backUrl}>
          {"< Back"}
        </Link>
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
            circuits={circuitsQuery.data ?? []}
            circuitsLoaded={circuitsQuery.isSuccess}
          />
        )}
      </main>
    </div>
  );
}
