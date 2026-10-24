import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import ResetDiffOverlay from "../components/ResetDiffOverlay";
import WallImage from "../components/WallImage";
import { useApplyReset, useDiscardReset, useMatchResetHold, useRestoreResetHold } from "../lib/hooks/mutations";
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
  const apply = useApplyReset(gymSlug ?? "", wallId, imageId);
  const discard = useDiscardReset(gymSlug ?? "", wallId, imageId);

  const [showNew, setShowNew] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [selectedOld, setSelectedOld] = useState<string | null>(null);
  const [selectedWasKept, setSelectedWasKept] = useState(false);

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

  const wallUrl = `/walls/${wallId}?gymSlug=${gymSlug ?? ""}`;
  const clearSelection = () => {
    setSelectedOld(null);
    setSelectedWasKept(false);
  };
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
  const handleNewHoldSelect = (newHoldId: string) => {
    if (!selectedOld) return;
    match.mutate({ old_hold_id: selectedOld, new_hold_id: newHoldId });
    clearSelection();
  };
  const markChanged = () => {
    if (!selectedOld) return;
    match.mutate({ old_hold_id: selectedOld, new_hold_id: null });
    clearSelection();
  };
  const restoreHold = () => {
    if (!selectedOld) return;
    restore.mutate({ old_hold_id: selectedOld });
    clearSelection();
  };
  const togglePhoto = () => {
    if (showNew) clearSelection();
    setShowNew(!showNew);
  };

  return (
    <div className={`screen ${styles.review}`}>
      <header className="header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          Back
        </button>
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
              selectedOldHoldId={selectedOld}
              onRemovedSelect={(oldHoldId) => {
                setSelectedOld(oldHoldId);
                setSelectedWasKept(false);
              }}
              onNewSelect={handleNewHoldSelect}
              onChanged={(oldHoldId) => {
                setSelectedOld(oldHoldId);
                setSelectedWasKept(true);
              }}
            />
          )}
        </WallImage>
      </div>

      <main className={`content ${styles.controls}`}>
        <button type="button" className="btn" onClick={togglePhoto}>
          {showNew ? "Show old photo" : "Show new photo"}
        </button>

        {selectedOld && showNew && (
          <div className={styles.selected}>
            <p>Old hold selected. Tap a new hold to match it.</p>
            {selectedWasKept ? (
              <button type="button" className="btn" onClick={markChanged} disabled={match.isPending}>
                Changed
              </button>
            ) : (
              <button type="button" className="btn" onClick={restoreHold} disabled={restore.isPending}>
                Still there
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
