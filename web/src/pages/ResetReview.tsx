import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import ResetDiffOverlay from "../components/ResetDiffOverlay";
import { resetHoldColors, type HoldColor } from "../components/resetHoldColors";
import WallImage from "../components/WallImage";
import {
  useApplyReset,
  useDeleteResetHold,
  useDiscardReset,
  useMatchResetHold,
  useRestoreResetHold,
} from "../lib/hooks/mutations";
import { useResetDiff, useWallDetail } from "../lib/hooks/queries";
import { toast } from "../lib/toast";
import styles from "./ResetReview.module.css";

export default function ResetReviewPage() {
  const { wallId = "", imageId = "" } = useParams();
  const [params] = useSearchParams();
  const gymSlug = params.get("gymSlug") ?? undefined;
  const navigate = useNavigate();

  const diff = useResetDiff(gymSlug, wallId, imageId);
  const wall = useWallDetail(wallId, gymSlug);
  const match = useMatchResetHold(gymSlug ?? "", wallId, imageId);
  const restore = useRestoreResetHold(gymSlug ?? "", wallId, imageId);
  const deleteHold = useDeleteResetHold(gymSlug ?? "", wallId, imageId);
  const apply = useApplyReset(gymSlug ?? "", wallId, imageId);
  const discard = useDiscardReset(gymSlug ?? "", wallId, imageId);

  const [showNew, setShowNew] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [selection, setSelection] = useState<{
    kind: HoldColor;
    holdId: string;
    oldHoldId?: string;
  } | null>(null);

  if (diff.isLoading || wall.isLoading) {
    return (
      <div className="screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!diff.data || !wall.data) {
    return (
      <div className="screen">
        <p className="error-text">
          {diff.error?.message ?? wall.error?.message ?? "Reset review unavailable"}
        </p>
      </div>
    );
  }

  const data = diff.data;
  const oldImage = wall.data.image?.image_url;
  const newImage = wall.data.pending_reset?.image_url;
  if (!oldImage || !newImage) {
    return (
      <div className="screen">
        <p className="error-text">Reset photos are unavailable.</p>
      </div>
    );
  }

  const keptCount = data.new_holds.filter((hold) => hold.matched_old_hold_id).length;
  const legend: { color: HoldColor; label: string; count: number }[] = [
    { color: "kept", label: "Kept", count: keptCount },
    { color: "new", label: "New", count: data.new_holds.length - keptCount },
    { color: "removed", label: "Removed", count: data.removed_holds.length },
  ];

  const wallUrl = `/walls/${wallId}?gymSlug=${gymSlug ?? ""}`;
  const clearSelection = () => setSelection(null);
  const finish = async () => {
    try {
      const result = await apply.mutateAsync();
      toast(`Wall reset applied: ${result.kept} kept, ${result.archived} archived`);
      navigate(wallUrl);
    } catch {
      // The mutation reports the error.
    }
  };
  const discardReset = async () => {
    try {
      await discard.mutateAsync();
      navigate(wallUrl);
    } catch {
      // The mutation reports the error.
    }
  };
  const selectHold = (kind: HoldColor, holdId: string, oldHoldId?: string) => {
    if (!selection || selection.kind === kind) {
      setSelection({ kind, holdId, oldHoldId });
      return;
    }

    if (selection.kind === "removed" && kind === "new") {
      match.mutate({ old_hold_id: selection.holdId, new_hold_id: holdId });
      clearSelection();
    } else if (selection.kind === "new" && kind === "removed") {
      match.mutate({ old_hold_id: holdId, new_hold_id: selection.holdId });
      clearSelection();
    } else if (selection.kind === "kept" && kind === "new" && selection.oldHoldId) {
      match.mutate({ old_hold_id: selection.oldHoldId, new_hold_id: holdId });
      clearSelection();
    } else {
      setSelection({ kind, holdId, oldHoldId });
    }
  };
  const markChanged = () => {
    if (selection?.kind !== "kept" || !selection.oldHoldId) return;
    match.mutate({ old_hold_id: selection.oldHoldId, new_hold_id: null });
    clearSelection();
  };
  const restoreHold = () => {
    if (selection?.kind !== "removed") return;
    restore.mutate({ old_hold_id: selection.holdId });
    clearSelection();
  };
  const discardSelectedHold = () => {
    if (selection?.kind !== "new" && selection?.kind !== "kept") return;
    deleteHold.mutate(selection.holdId);
    clearSelection();
  };
  const togglePhoto = () => {
    if (showNew) clearSelection();
    setShowNew(!showNew);
  };

  return (
    <div className={`screen ${styles.review}`}>
      <header className="header">
        <Link className="btn btn-ghost" to={wallUrl}>
          Back
        </Link>
        <h1>Review reset</h1>
      </header>

      {!data.alignment.ok && (
        <p className={`error-text ${styles.notice}`}>
          Wall alignment is uncertain. Review hold matches carefully.
        </p>
      )}

      <div className={styles.stage}>
        <WallImage
          src={showNew ? newImage : oldImage}
          alt={showNew ? "New wall photo" : "Previous wall photo"}
          fitContainer
          onAspectRatioChange={setAspectRatio}
        >
          {showNew && (
            <ResetDiffOverlay
              diff={data}
              aspectRatio={aspectRatio}
              selected={selection ? { kind: selection.kind, id: selection.holdId } : null}
              onSelect={selectHold}
            />
          )}
        </WallImage>
      </div>

      <main className={`content ${styles.controls}`}>
        {showNew && (
          <>
            <ul className={styles.legend}>
              {legend.map(({ color, label, count }) => (
                <li key={color}>
                  <span
                    className={styles.swatch}
                    style={{
                      background: resetHoldColors[color].fill,
                      borderColor: resetHoldColors[color].stroke,
                      borderStyle: color === "removed" ? "dashed" : "solid",
                    }}
                  />
                  {label} · {count}
                </li>
              ))}
            </ul>
            <p className="muted">Tap any hold to fix it.</p>
          </>
        )}
        <button type="button" className="btn" onClick={togglePhoto}>
          {showNew ? "Show old photo" : "Show new photo"}
        </button>

        {selection && showNew && (
          <div className={styles.selected}>
            <p>
              {selection.kind === "removed" && "Tap the blue hold it became, or mark it as still there."}
              {selection.kind === "new" && "Tap the red hold it replaced, or mark it as not a hold."}
              {selection.kind === "kept" && "Tap a blue hold to re-match it, or mark it changed."}
            </p>
            {selection.kind === "removed" && (
              <button type="button" className="btn" onClick={restoreHold} disabled={restore.isPending}>
                Still there
              </button>
            )}
            {selection.kind === "kept" && (
              <button type="button" className="btn" onClick={markChanged} disabled={match.isPending}>
                Changed
              </button>
            )}
            {(selection.kind === "new" || selection.kind === "kept") && (
              <button type="button" className="btn" onClick={discardSelectedHold} disabled={deleteHold.isPending}>
                Not a hold
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={clearSelection}>
              Cancel
            </button>
          </div>
        )}

        <p>
          {data.kept_route_count} climbs kept · {data.affected_routes.length} climbs will be archived
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide" : "Show"} affected climbs
        </button>
        {expanded &&
          data.affected_routes.map((route) => (
            <p key={route.id}>
              {route.name}
              {route.grade ? ` · ${route.grade}` : ""} — {route.missing_hold_ids.length} missing holds
            </p>
          ))}

        {data.detection_status !== "done" && (
          <p className="muted">Hold detection is still running. Apply will be available when it finishes.</p>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={apply.isPending || data.detection_status !== "done"}
          onClick={() => void finish()}
        >
          {apply.isPending ? "Applying…" : "Apply reset"}
        </button>
        <button
          type="button"
          className="btn btn-block"
          disabled={discard.isPending}
          onClick={() => void discardReset()}
        >
          {discard.isPending ? "Discarding…" : "Discard reset"}
        </button>
      </main>
    </div>
  );
}
