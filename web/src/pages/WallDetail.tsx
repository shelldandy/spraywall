import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/fetch";
import { useHolds } from "../lib/hooks/queries";
import { toast, toastError } from "../lib/toast";
import type { Hold, HoldRoles, WallDetail } from "../lib/api/types";
import HoldOverlay from "../components/HoldOverlay";
import WallImage from "../components/WallImage";
import styles from "./WallDetail.module.css";

type HoldRole = "normal" | "start" | "finish";

const THRESHOLDS = [0.1, 0.25, 0.5, 0.75, 0.9];
const POLL_INTERVAL_MS = 4000;

function isDetecting(status: string | null | undefined) {
  return status === "pending" || status === "processing";
}

function initialSelections(editHoldIds: string | null, editHoldRoles: string | null) {
  const map = new Map<string, HoldRole>();
  if (!editHoldIds) return map;
  try {
    const ids: string[] = JSON.parse(editHoldIds);
    const roles = editHoldRoles ? (JSON.parse(editHoldRoles) as HoldRoles) : null;
    for (const id of ids) {
      if (roles?.start.includes(id)) map.set(id, "start");
      else if (roles?.finish.includes(id)) map.set(id, "finish");
      else map.set(id, "normal");
    }
  } catch {
    // Malformed params: start with no selection.
  }
  return map;
}

export default function WallDetailPage() {
  const { wallId = "" } = useParams<{ wallId: string }>();
  const [searchParams] = useSearchParams();
  const gymSlug = searchParams.get("gymSlug") ?? undefined;
  const editRouteId = searchParams.get("editRouteId");
  const editName = searchParams.get("editName");
  const editGrade = searchParams.get("editGrade");
  const editDescription = searchParams.get("editDescription");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isEditingRoute = !!editRouteId;

  const [isEditingHolds, setIsEditingHolds] = useState(false);
  const [editHoldMode, setEditHoldMode] = useState<"delete" | "add">("delete");
  const [holdToDelete, setHoldToDelete] = useState<string | null>(null);
  const [deletingHoldId, setDeletingHoldId] = useState<string | null>(null);
  const [holdDeleteError, setHoldDeleteError] = useState<string | null>(null);
  const [holdSelections, setHoldSelections] = useState<Map<string, HoldRole>>(() =>
    initialSelections(searchParams.get("editHoldIds"), searchParams.get("editHoldRoles")),
  );
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Same key and fetcher as useWallDetail, plus polling while detection runs
  // (the native app relied on its background sync engine for this).
  const wallQuery = useQuery<WallDetail | null>({
    queryKey: ["wall-detail", wallId],
    queryFn: async () => {
      if (!gymSlug) return null;
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}`);
      if (!res.ok) throw new Error("Failed to fetch wall");
      return res.json();
    },
    refetchInterval: (query) =>
      isDetecting(query.state.data?.detection_status) ? POLL_INTERVAL_MS : false,
  });

  const holdsQuery = useHolds(wallId, wallQuery.data?.detection_status === "done", gymSlug);

  const handleToggle = useCallback((holdId: string) => {
    setHoldSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(holdId);
      if (!current) next.set(holdId, "normal");
      else if (current === "normal") next.set(holdId, "start");
      else if (current === "start") next.set(holdId, "finish");
      else next.delete(holdId);
      return next;
    });
  }, []);

  const deleteHold = async (holdId: string) => {
    setDeletingHoldId(holdId);
    setHoldDeleteError(null);
    // Optimistic removal
    queryClient.setQueryData<Hold[] | undefined>(["holds", wallId], (old) =>
      old ? old.filter((h) => h.id !== holdId) : old,
    );
    try {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds/${holdId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Failed to delete hold (${res.status})`);
      }
      setHoldSelections((prev) => {
        const next = new Map(prev);
        next.delete(holdId);
        return next;
      });
      setHoldToDelete(null);
    } catch (err) {
      setHoldDeleteError(err instanceof Error ? err.message : "Failed to delete hold");
    } finally {
      queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
      setDeletingHoldId(null);
    }
  };

  const handleEditToggle = useCallback(
    (holdId: string) => {
      if (editHoldMode === "delete") {
        setHoldToDelete(holdId);
        setHoldDeleteError(null);
      }
    },
    [editHoldMode],
  );

  const addHold = async (normX: number, normY: number) => {
    const size = 0.05;
    const x = Math.max(0, normX - size / 2);
    const y = Math.max(0, normY - size / 2);
    const bbox = { x, y, w: Math.min(size, 1 - x), h: Math.min(size, 1 - y) };
    try {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/holds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bbox }),
      });
      if (!res.ok) throw new Error("Failed to add hold");
      queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
    } catch (err) {
      toastError(err);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file, file.name || "photo.jpg");

    setUploading(true);
    try {
      const res = await apiFetch(`/gyms/${gymSlug}/walls/${wallId}/images`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["wall-detail", wallId] });
      queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
      setHoldSelections(new Map());
    } catch (err) {
      toast(`Upload Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const exitEditMode = () => {
    setIsEditingHolds(false);
    setHoldToDelete(null);
    setHoldDeleteError(null);
  };

  const switchEditMode = (mode: "delete" | "add") => {
    setEditHoldMode(mode);
    setHoldToDelete(null);
    setHoldDeleteError(null);
  };

  const wall = wallQuery.data;
  const holds = holdsQuery.data ?? [];
  const filteredHolds = holds.filter((h) => h.confidence >= confidenceThreshold);
  const filteredIds = new Set(filteredHolds.map((h) => h.id));
  const selectedIds = new Set(holdSelections.keys());
  const visibleSelectedIds = new Set([...selectedIds].filter((id) => filteredIds.has(id)));
  const detectionStatus = wall?.detection_status;
  const canEdit = wall?.user_role === "setter" || wall?.user_role === "admin";

  const visibleRoles = (): HoldRoles => ({
    start: [...holdSelections.entries()]
      .filter(([id, r]) => r === "start" && visibleSelectedIds.has(id))
      .map(([id]) => id),
    finish: [...holdSelections.entries()]
      .filter(([id, r]) => r === "finish" && visibleSelectedIds.has(id))
      .map(([id]) => id),
  });

  const goToCreateRoute = () => {
    const params = new URLSearchParams({
      wallId,
      gymSlug: gymSlug ?? "",
      holdIds: JSON.stringify(Array.from(visibleSelectedIds)),
      holdRoles: JSON.stringify(visibleRoles()),
    });
    if (isEditingRoute) {
      params.set("routeId", editRouteId);
      params.set("initialName", editName ?? "");
      params.set("initialGrade", editGrade ?? "");
      params.set("initialDescription", editDescription ?? "");
    }
    navigate(`/routes/create?${params}`);
  };

  const goToRoutes = () => {
    const params = new URLSearchParams({ wallId, gymSlug: gymSlug ?? "" });
    navigate(`/routes?${params}`);
  };

  const statusBadge = () => {
    if (!detectionStatus) return null;
    let variant = styles.badgeNeutral;
    let label = detectionStatus;
    if (isDetecting(detectionStatus)) {
      variant = styles.badgePending;
      label = "Detecting holds...";
    } else if (detectionStatus === "done") {
      variant = styles.badgeDone;
      label = "Holds detected";
    } else if (detectionStatus === "failed") {
      variant = styles.badgeFailed;
      label = "Detection failed";
    }
    return <span className={`${styles.badge} ${variant}`}>{label}</span>;
  };

  return (
    <div className="screen">
      <header className={`header ${styles.header}`}>
        <button type="button" className="btn btn-ghost" onClick={() => navigate("/walls")}>
          {"< Back"}
        </button>
        <h1 className={styles.title}>{wall?.wall.name ?? "Wall"}</h1>
        {isEditingHolds ? (
          <button type="button" className={`btn btn-ghost ${styles.headerRight}`} onClick={exitEditMode}>
            Done
          </button>
        ) : (
          <span className={styles.headerRight}>
            {visibleSelectedIds.size > 0 ? `${visibleSelectedIds.size} selected` : ""}
          </span>
        )}
      </header>

      {wallQuery.isLoading ? (
        <div className={styles.loader}>
          <div className="spinner" />
        </div>
      ) : (
        <main className={`content ${styles.body}`}>
          {wallQuery.isError && !wall && (
            <p className="error-text">{wallQuery.error.message}</p>
          )}

          {statusBadge()}

          {wall?.image ? (
            <div className={styles.imageContainer}>
              <WallImage src={wall.image.image_url} alt={wall.wall.name}>
                {(isEditingHolds || filteredHolds.length > 0) && (
                  <HoldOverlay
                    holds={isEditingHolds ? holds : filteredHolds}
                    selectedIds={isEditingHolds ? new Set() : selectedIds}
                    onToggle={isEditingHolds ? handleEditToggle : handleToggle}
                    mode={isEditingHolds ? "edit" : undefined}
                    editHoldMode={editHoldMode}
                    holdToDelete={holdToDelete}
                    onBackgroundPress={editHoldMode === "add" ? addHold : undefined}
                    holdRoles={holdSelections.size > 0 ? visibleRoles() : null}
                  />
                )}
              </WallImage>
            </div>
          ) : (
            <div className={styles.noImage}>
              <span>No photo uploaded yet</span>
            </div>
          )}

          {canEdit && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : "Upload Photo"}
              </button>
            </>
          )}

          {canEdit && detectionStatus === "done" && !isEditingHolds && (
            <button
              type="button"
              className={`btn btn-block ${styles.editHoldsButton}`}
              onClick={() => setIsEditingHolds(true)}
            >
              Edit Holds
            </button>
          )}

          {isEditingHolds && (
            <div className={styles.editToolbar}>
              <button
                type="button"
                className={`btn ${styles.editTool} ${editHoldMode === "delete" ? styles.editToolActive : ""}`}
                onClick={() => switchEditMode("delete")}
              >
                Delete
              </button>
              <button
                type="button"
                className={`btn ${styles.editTool} ${editHoldMode === "add" ? styles.editToolActive : ""}`}
                onClick={() => switchEditMode("add")}
              >
                Add
              </button>
            </div>
          )}

          {isEditingHolds && editHoldMode === "add" && (
            <p className={`muted ${styles.hint}`}>Tap the image to add a hold.</p>
          )}

          {isEditingHolds &&
            editHoldMode === "delete" &&
            (holdToDelete ? (
              <button
                type="button"
                className="btn btn-danger btn-block"
                onClick={() => deleteHold(holdToDelete)}
                disabled={deletingHoldId !== null}
              >
                {deletingHoldId ? "Deleting..." : "Delete selected hold"}
              </button>
            ) : (
              <p className={`muted ${styles.hint}`}>Tap a hold to select it for deletion.</p>
            ))}

          {isEditingHolds && holdDeleteError && <p className="error-text">{holdDeleteError}</p>}

          {!isEditingHolds && detectionStatus === "done" && holds.length > 0 && (
            <>
              <div className={styles.threshold}>
                <span className={styles.thresholdLabel}>Confidence threshold</span>
                <div className={styles.thresholdButtons}>
                  {THRESHOLDS.map((t) => (
                    <button
                      type="button"
                      key={t}
                      className={`${styles.chip} ${confidenceThreshold === t ? styles.chipActive : ""}`}
                      onClick={() => setConfidenceThreshold(t)}
                    >
                      {Math.round(t * 100)}%
                    </button>
                  ))}
                </div>
              </div>
              <p className={`muted ${styles.holdCount}`}>
                {filteredHolds.length} of {holds.length} hold{holds.length !== 1 ? "s" : ""} (
                {"≥"} {Math.round(confidenceThreshold * 100)}%)
              </p>
            </>
          )}

          {!isEditingHolds && visibleSelectedIds.size >= 2 && (
            <button
              type="button"
              className={`btn btn-block ${styles.createRouteButton}`}
              onClick={goToCreateRoute}
            >
              {isEditingRoute ? "Update" : "Create"} Route ({visibleSelectedIds.size} holds)
            </button>
          )}

          {!isEditingHolds && (
            <button
              type="button"
              className={`btn btn-block ${styles.viewRoutesButton}`}
              onClick={goToRoutes}
            >
              View Routes
            </button>
          )}
        </main>
      )}
    </div>
  );
}
