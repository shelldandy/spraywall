import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useCreateRoute, useUpdateRoute } from "../lib/hooks/mutations";
import type { HoldRoles } from "../lib/api/types";
import GradePicker from "../components/GradePicker";
import { formatGrade, gradeIdFromV } from "../lib/grades";
import styles from "./RouteCreate.module.css";
import { hasHistory, useGoBack } from "../lib/nav";

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Name/grade/description form for a route whose holds were picked on the wall screen.
 * Edits an existing route when a `routeId` param is passed.
 */
export default function RouteCreatePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const wallId = params.get("wallId") ?? "";
  const gymSlug = params.get("gymSlug") ?? "";
  const routeId = params.get("routeId") ?? "";
  const holdIdsParam = params.get("holdIds");
  const holdRolesParam = params.get("holdRoles");
  const isEditing = !!routeId;

  const parsedHoldIds = useMemo(() => parseJson<string[]>(holdIdsParam, []), [holdIdsParam]);
  const parsedHoldRoles = useMemo(() => parseJson<HoldRoles | null>(holdRolesParam, null), [holdRolesParam]);

  const [name, setName] = useState(params.get("initialName") ?? "");
  const [gradeId, setGradeId] = useState<number | null>(() => {
    const initialGrade = params.get("initialGrade");
    return initialGrade ? gradeIdFromV(initialGrade) : null;
  });
  const [description, setDescription] = useState(params.get("initialDescription") ?? "");

  const createRouteMutation = useCreateRoute(gymSlug, wallId);
  const updateRouteMutation = useUpdateRoute(gymSlug, wallId, routeId);
  const isPending = createRouteMutation.isPending || updateRouteMutation.isPending;
  const canSave = !!name.trim() && !isPending;

  const goBack = useGoBack(`/walls/${wallId}?${new URLSearchParams({ gymSlug })}`);

  const save = (status: "draft" | "published") => {
    const routeParams = {
      name: name.trim(),
      grade: gradeId !== null ? formatGrade(gradeId, "v") : null,
      description: description.trim() || null,
      hold_ids: parsedHoldIds,
      hold_roles: parsedHoldRoles,
      status,
    };
    const mutation = isEditing ? updateRouteMutation : createRouteMutation;
    mutation.mutate(routeParams, {
      onSuccess: () => {
        if (isEditing) {
          navigate(`/routes/${routeId}?${new URLSearchParams({ wallId, gymSlug })}`, { replace: true });
        } else if (hasHistory()) {
          navigate(-1);
        } else {
          navigate(`/routes?${new URLSearchParams({ wallId, gymSlug })}`, { replace: true });
        }
      },
    });
  };

  return (
    <div className="screen">
      <header className="header">
        <button type="button" className={`btn btn-ghost ${styles.side}`} onClick={goBack}>
          {"< Back"}
        </button>
        <h1 className={styles.title}>{isEditing ? "Edit Route" : "Create Route"}</h1>
        <span className={styles.side} />
      </header>

      <main className={`content ${styles.body}`}>
        <span className={styles.holdsBadge}>{parsedHoldIds.length} holds selected</span>

        <label className={styles.label} htmlFor="route-name">
          Name *
        </label>
        <input
          id="route-name"
          className={`input ${styles.field}`}
          placeholder="Route name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={!isEditing}
          enterKeyHint="done"
        />

        <span className={styles.label}>Grade</span>
        <GradePicker selectedGradeId={gradeId} onSelect={setGradeId} />

        <label className={styles.label} htmlFor="route-description">
          Description
        </label>
        <textarea
          id="route-description"
          className={`input ${styles.field} ${styles.textArea}`}
          placeholder="Optional description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />

        <div className={styles.buttonRow}>
          <button
            type="button"
            className={`btn ${styles.draftButton}`}
            onClick={() => save("draft")}
            disabled={!canSave}
          >
            Save Draft
          </button>
          <button
            type="button"
            className={`btn btn-primary ${styles.saveButton}`}
            onClick={() => save("published")}
            disabled={!canSave}
          >
            {isPending ? "Saving..." : "Publish Route"}
          </button>
        </div>
      </main>
    </div>
  );
}
