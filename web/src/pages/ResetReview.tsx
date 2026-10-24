import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useResetDiff, useWallDetail } from "../lib/hooks/queries";
import { useApplyReset, useDiscardReset, useMatchResetHold, useRestoreResetHold } from "../lib/hooks/mutations";
import { toast } from "../lib/toast";
import WallImage from "../components/WallImage";
import ResetDiffOverlay from "../components/ResetDiffOverlay";
import styles from "./ResetReview.module.css";

export default function ResetReviewPage() {
  const { wallId = "", imageId = "" } = useParams();
  const [params] = useSearchParams(); const gymSlug = params.get("gymSlug") ?? undefined;
  const diff = useResetDiff(gymSlug, wallId, imageId); const wall = useWallDetail(wallId, gymSlug);
  const match = useMatchResetHold(gymSlug ?? "", wallId, imageId); const restore = useRestoreResetHold(gymSlug ?? "", wallId, imageId);
  const apply = useApplyReset(gymSlug ?? "", wallId, imageId); const discard = useDiscardReset(gymSlug ?? "", wallId, imageId);
  const [showNew, setShowNew] = useState(true); const [expanded, setExpanded] = useState(false); const [aspectRatio, setAspectRatio] = useState(1); const [selectedOld, setSelectedOld] = useState<string | null>(null); const [selectedWasKept, setSelectedWasKept] = useState(false); const navigate = useNavigate();
  if (diff.isLoading) return <div className="screen"><div className="spinner" /></div>;
  if (!diff.data || !wall.data) return <div className="screen"><p className="error-text">{diff.error?.message ?? "Reset review unavailable"}</p></div>;
  const data = diff.data; const oldImage = wall.data.image?.image_url; const newImage = wall.data.pending_reset?.image_url;
  const finish = async () => { try { const result = await apply.mutateAsync(); toast(`Wall reset applied: ${result.kept} kept, ${result.archived} archived`); navigate(`/walls/${wallId}?gymSlug=${gymSlug}`); } catch { /* mutation reports the error */ } };
  return <div className={`screen ${styles.review}`}>
    <header className="header"><button className="btn btn-ghost" onClick={() => navigate(-1)}>Back</button><h1>Review reset</h1></header>
    {!data.alignment.ok && <p className={`error-text ${styles.notice}`}>Wall alignment is uncertain. Review hold matches carefully.</p>}
    <div className={styles.stage}>
      <WallImage src={(showNew ? newImage : oldImage) ?? ""} alt="Wall reset comparison" fitContainer onAspectRatioChange={setAspectRatio}>
        {showNew && oldImage && <img src={oldImage} className={styles.ghost} alt="Previous wall photo"/>}
        <ResetDiffOverlay diff={data} aspectRatio={aspectRatio} selectedOldHoldId={selectedOld}
          onRemovedSelect={oldHoldId => { setSelectedOld(oldHoldId); setSelectedWasKept(false); }}
          onNewSelect={newHoldId => { if (selectedOld) { match.mutate({ old_hold_id: selectedOld, new_hold_id: newHoldId }); setSelectedOld(null); setSelectedWasKept(false); } }}
          onChanged={oldHoldId => { setSelectedOld(oldHoldId); setSelectedWasKept(true); }}/>
      </WallImage>
    </div>
    <main className={`content ${styles.controls}`}>
      <button className="btn" onClick={() => setShowNew(v => !v)}>{showNew ? "Show old photo" : "Show new photo"}</button>
      {selectedOld && <div className={styles.selected}><p>Old hold selected. Tap a new hold to match it.</p>{selectedWasKept ? <button className="btn" onClick={() => { match.mutate({ old_hold_id: selectedOld, new_hold_id: null }); setSelectedWasKept(false); }}>Changed</button> : <button className="btn" disabled={restore.isPending} onClick={() => { restore.mutate({ old_hold_id: selectedOld }); setSelectedOld(null); }}>Still there</button>}<button className="btn btn-ghost" onClick={() => setSelectedOld(null)}>Cancel</button></div>}
      <p>{data.kept_route_count} climbs kept · {data.affected_routes.length} climbs will be archived</p><button className="btn btn-ghost" onClick={() => setExpanded(v => !v)}>{expanded ? "Hide" : "Show"} affected climbs</button>
      {expanded && data.affected_routes.map(r => <p key={r.id}>{r.name}{r.grade ? ` · ${r.grade}` : ""} — {r.missing_hold_ids.length} missing holds</p>)}
      <button className="btn btn-primary btn-block" disabled={apply.isPending || data.detection_status !== "done"} onClick={finish}>Apply reset</button>
      <button className="btn btn-block" disabled={discard.isPending} onClick={async () => { await discard.mutateAsync(); navigate(`/walls/${wallId}?gymSlug=${gymSlug}`); }}>Discard reset</button>
    </main>
  </div>;
}
