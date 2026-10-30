import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/fetch";
import { canEditWallHolds, isDetecting, shouldLoadHolds, useCircuits, useHolds, useRoutes, useWallDetail } from "../lib/hooks/queries";
import { toast, toastError } from "../lib/toast";
import { uploadWallImage } from "../lib/hooks/mutations";
import type { Hold, HoldRoles } from "../lib/api/types";
import { parseRouteTags } from "../lib/routeTags";
import HoldOverlay from "../components/HoldOverlay";
import WallImage from "../components/WallImage";
import RouteList from "./RouteList";
import ActivityFeed from "../components/ActivityFeed";
import styles from "./WallDetail.module.css";

type HoldRole = "normal" | "start" | "hand" | "finish" | "foot";
type CreateTool = "start" | "hand" | "finish" | "foot" | "erase";

const THRESHOLDS = [0.1, 0.25, 0.5, 0.75, 0.9];

function initialRouteTags(rawTags: string | null) {
  if (!rawTags) return [];
  try {
    return parseRouteTags(JSON.parse(rawTags) as unknown);
  } catch {
    return [];
  }
}

function initialSelections(editHoldIds: string | null, editHoldRoles: string | null) {
  const map = new Map<string, HoldRole>();
  if (!editHoldIds) return map;
  try {
    const ids: string[] = JSON.parse(editHoldIds);
    const roles = editHoldRoles ? (JSON.parse(editHoldRoles) as HoldRoles) : null;
    for (const id of ids) {
      if (roles?.start?.includes(id)) map.set(id, "start");
      else if (roles?.finish?.includes(id)) map.set(id, "finish");
      else if (roles?.foot?.includes(id)) map.set(id, "foot");
      else map.set(id, "hand");
    }
  } catch {
    // Malformed params: start with no selection.
  }
  return map;
}

export default function WallDetailPage() {
  const { wallId = "" } = useParams<{ wallId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const gymSlug = searchParams.get("gymSlug") ?? undefined;
  const editRouteId = searchParams.get("editRouteId");
  const editName = searchParams.get("editName");
  const editGrade = searchParams.get("editGrade");
  const editDescription = searchParams.get("editDescription");
  const editTags = searchParams.get("editTags");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isEditingRoute = !!editRouteId;
  const isCreateMode = isEditingRoute || searchParams.get("mode") === "create";
  const browseView = searchParams.get("view") === "activity" ? "activity" : "climbs";

  const [editingHoldsImageId, setEditingHoldsImageId] = useState<string | null>(null);
  const [isManagingWall, setIsManagingWall] = useState(false);
  const [editHoldMode, setEditHoldMode] = useState<"delete" | "add">("delete");
  const [holdToDelete, setHoldToDelete] = useState<string | null>(null);
  const [deletingHoldId, setDeletingHoldId] = useState<string | null>(null);
  const [holdDeleteError, setHoldDeleteError] = useState<string | null>(null);
  const [holdSelections, setHoldSelections] = useState<Map<string, HoldRole>>(() =>
    initialSelections(searchParams.get("editHoldIds"), searchParams.get("editHoldRoles")),
  );
  const [createTool, setCreateTool] = useState<CreateTool>(isEditingRoute ? "hand" : "start");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number>();
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.25);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // This screen also polls when an incomplete partial reset is running.
  const wallQuery = useWallDetail(wallId, gymSlug, { pollPendingReset: true });

  const wall = wallQuery.data;
  const detectionStatus = wall?.detection_status;
  const canEdit = wall?.user_role === "setter" || wall?.user_role === "admin";
  const holdsEnabled = shouldLoadHolds(detectionStatus, wall?.user_role);
  const canEditHolds = canEditWallHolds(detectionStatus, wall?.user_role, Boolean(wall?.image));
  const isEditingHolds = editingHoldsImageId === wall?.image?.id && canEditHolds;
  const holdsQuery = useHolds(wallId, holdsEnabled, gymSlug);
  const routesQuery = useRoutes(wallId, gymSlug);
  const circuitsQuery = useCircuits(wallId, gymSlug);

  const handleToggle = useCallback((holdId: string) => {
    setHoldSelections((prev) => {
      const next = new Map(prev);
      const current = next.get(holdId);
      if (!current) next.set(holdId, "normal");
      else if (current === "normal") next.set(holdId, "start");
      else if (current === "start") next.set(holdId, "finish");
      else if (current === "finish") next.set(holdId, "foot");
      else next.delete(holdId);
      return next;
    });
  }, []);

  const handleCreateHold = useCallback(
    (holdId: string) => {
      if (createTool === "erase") {
        setHoldSelections((prev) => {
          const next = new Map(prev);
          next.delete(holdId);
          return next;
        });
        return;
      }

      const role = createTool as Exclude<CreateTool, "erase">;
      const isEndpoint = role === "start" || role === "finish";
      const currentRole = holdSelections.get(holdId);
      const roleCount = [...holdSelections.values()].filter((value) => value === role).length;
      if (isEndpoint && currentRole !== role && roleCount >= 2) {
        toast(`You can select up to 2 ${role} holds.`);
        return;
      }
      setHoldSelections((prev) => new Map(prev).set(holdId, role));
      // Both start holds placed: hand holds are the natural next step.
      if (role === "start" && currentRole !== "start" && roleCount + 1 === 2) {
        setCreateTool("hand");
      }
    },
    [createTool, holdSelections],
  );

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

    setUploading(true);
    try {
      const res = await uploadWallImage(gymSlug ?? "", wallId, file);
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["wall-detail", wallId] });
      queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
      queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      setHoldSelections(new Map());
      setEditingHoldsImageId(null);
    } catch (err) {
      toast(`Upload Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setUploading(false);
    }
  };

  const exitEditMode = () => {
    setEditingHoldsImageId(null);
    setHoldToDelete(null);
    setHoldDeleteError(null);
  };

  const exitWallManagement = () => {
    exitEditMode();
    setIsManagingWall(false);
  };

  const switchEditMode = (mode: "delete" | "add") => {
    setEditHoldMode(mode);
    setHoldToDelete(null);
    setHoldDeleteError(null);
  };

  useEffect(() => {
    document.body.classList.toggle("wall-immersive", isCreateMode || isEditingHolds || isManagingWall);
    return () => document.body.classList.remove("wall-immersive");
  }, [isCreateMode, isEditingHolds, isManagingWall]);

  useEffect(() => {
    if (!wall || !gymSlug) return;
    try {
      localStorage.setItem("spraywall:last-visited-wall", JSON.stringify({ wallId, gymSlug, name: wall.wall.name }));
      window.dispatchEvent(new Event("spraywall:last-visited-wall"));
    } catch { /* Storage may be unavailable; navigation remains usable. */ }
  }, [gymSlug, wall, wallId]);
  const holds = holdsEnabled ? holdsQuery.data ?? [] : [];
  const filteredHolds = holds.filter((h) => h.confidence >= confidenceThreshold);
  const selectedIds = new Set(holdSelections.keys());
  const filteredIds = new Set(filteredHolds.map((h) => h.id));
  const visibleSelectedIds = new Set([...selectedIds].filter((id) => filteredIds.has(id)));

  const openPartialReset = () => {
    if (!wall?.image) return;
    const cameraParams = new URLSearchParams({
      gymSlug: gymSlug ?? "",
      old: wall.image.image_url,
    });
    navigate(`/walls/${wallId}/camera?${cameraParams}`);
  };

  const openResetReview = () => {
    const imageId = wall?.pending_reset?.image_id;
    if (!imageId) return;
    const resetParams = new URLSearchParams({ gymSlug: gymSlug ?? "" });
    navigate(`/walls/${wallId}/reset/${imageId}?${resetParams}`);
  };

  const chooseFullResetImage = () => {
    if (
      wall?.image &&
      !window.confirm("A full reset archives existing climbs. Continue with a new wall photo?")
    ) {
      return;
    }
    fileInputRef.current?.click();
  };

  const visibleRoles = (): HoldRoles => ({
    start: [...holdSelections.entries()]
      .filter(([id, r]) => r === "start" && visibleSelectedIds.has(id))
      .map(([id]) => id),
    finish: [...holdSelections.entries()]
      .filter(([id, r]) => r === "finish" && visibleSelectedIds.has(id))
      .map(([id]) => id),
    foot: [...holdSelections.entries()]
      .filter(([id, r]) => r === "foot" && visibleSelectedIds.has(id))
      .map(([id]) => id),
  });

  const allSelectionRoles = (): HoldRoles => ({
    start: [...holdSelections.entries()].filter(([, role]) => role === "start").map(([id]) => id),
    finish: [...holdSelections.entries()].filter(([, role]) => role === "finish").map(([id]) => id),
    foot: [...holdSelections.entries()].filter(([, role]) => role === "foot").map(([id]) => id),
  });

  const goToCreateRoute = (
    holdIds: Set<string> = visibleSelectedIds,
    roles: HoldRoles = visibleRoles(),
  ) => {
    const params = new URLSearchParams({
      wallId,
      gymSlug: gymSlug ?? "",
      holdIds: JSON.stringify(Array.from(holdIds)),
      holdRoles: JSON.stringify(roles),
    });
    if (isEditingRoute) {
      params.set("routeId", editRouteId);
      params.set("initialName", editName ?? "");
      params.set("initialGrade", editGrade ?? "");
      params.set("initialDescription", editDescription ?? "");
      params.set("initialTags", JSON.stringify(initialRouteTags(editTags)));
    }
    navigate(`/routes/create?${params}`);
  };

  const setBrowseView = (view: "climbs" | "activity") => {
    const next = new URLSearchParams(searchParams);
    if (view === "activity") next.set("view", "activity");
    else next.delete("view");
    setSearchParams(next);
  };

  const closeCreateMode = () => {
    if (isEditingRoute) {
      navigate(`/routes/${editRouteId}?${new URLSearchParams({ wallId, gymSlug: gymSlug ?? "" })}`, { replace: true });
      return;
    }
    navigate(`/walls/${wallId}?${new URLSearchParams({ gymSlug: gymSlug ?? "" })}`, { replace: true });
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

  if (isCreateMode && !isEditingHolds) {
    const startCount = [...holdSelections.values()].filter((role) => role === "start").length;
    const finishCount = [...holdSelections.values()].filter((role) => role === "finish").length;
    const tools: CreateTool[] = ["start", "hand", "finish", "foot", "erase"];
    const toolLabels: Record<CreateTool, string> = {
      start: "Start",
      hand: "Hand",
      finish: "Finish",
      foot: "Foot",
      erase: "Erase",
    };
    const toolColors: Record<CreateTool, string> = {
      start: "#00f51b",
      hand: "#00e5ff",
      finish: "#f000e8",
      foot: "#ffae00",
      erase: "#f2efff",
    };

    return (
      <div className={`screen ${styles.createScreen}`}>
        <header className={styles.createHeader}>
          <button
            type="button"
            className={styles.createExit}
            onClick={closeCreateMode}
            aria-label={isEditingRoute ? "Close edit climb" : "Close new climb"}
          >
            ×
          </button>
          <div className={styles.createTitleBlock}>
            <h1 className={styles.createTitle}>{isEditingRoute ? "Edit climb" : "New climb"}</h1>
            <p className={styles.createCounts}>
              Start: {startCount}/2 · Finish: {finishCount}/2
            </p>
          </div>
          <div className={styles.createActions}>
            <div className={styles.moreWrap}>
              <button
                type="button"
                className={styles.moreButton}
                onClick={() => setShowCreateMenu((shown) => !shown)}
                aria-label="More climb options"
                aria-expanded={showCreateMenu}
              >
                ···
              </button>
              {showCreateMenu && (
                <div className={styles.createMenu}>
                  <button
                    type="button"
                    onClick={() => {
                      setHoldSelections(new Map());
                      setShowCreateMenu(false);
                    }}
                  >
                    Clear selection
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className={styles.createSave}
              onClick={() => goToCreateRoute(selectedIds, allSelectionRoles())}
              disabled={selectedIds.size < 2}
            >
              {isEditingRoute ? "Update" : "Save"}
            </button>
          </div>
        </header>

        <main className={styles.createBoard}>
          {wallQuery.isLoading ? (
            <div className={styles.createLoader}><div className="spinner" /></div>
          ) : wall?.image ? (
            <div className={styles.createImageContainer}>
              <WallImage
                src={wall.image.image_url}
                alt={wall.wall.name}
                fitContainer
                onAspectRatioChange={setImageAspectRatio}
              >
                {holds.length > 0 && (
                  <HoldOverlay
                    holds={holds}
                    selectedIds={selectedIds}
                    onToggle={handleCreateHold}
                    selectedRoleById={holdSelections}
                    coordinateAspectRatio={imageAspectRatio}
                  />
                )}
              </WallImage>
            </div>
          ) : (
            <div className={styles.createNoImage}>
              {wallQuery.isError ? wallQuery.error.message : "No wall photo available"}
            </div>
          )}
        </main>

        <nav className={styles.createToolbar} aria-label="Hold type">
          {tools.map((tool) => (
            <button
              type="button"
              key={tool}
              className={`${styles.toolButton} ${createTool === tool ? styles.toolActive : ""}`}
              onClick={() => setCreateTool(tool)}
              aria-pressed={createTool === tool}
            >
              {tool === "erase" ? (
                <span className={styles.eraserIcon} aria-hidden="true" />
              ) : (
                <span
                  className={styles.toolDot}
                  style={{ backgroundColor: toolColors[tool] }}
                  aria-hidden="true"
                />
              )}
              <span>{toolLabels[tool]}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className={`header ${styles.header}`}>
        <Link className="btn btn-ghost" to="/walls">
          {"< Back"}
        </Link>
        <h1 className={styles.title}>{wall?.wall.name ?? "Wall"}</h1>
        {isEditingHolds || isManagingWall ? (
          <button
            type="button"
            className={`btn btn-ghost ${styles.headerRight}`}
            onClick={isEditingHolds ? exitEditMode : exitWallManagement}
          >
            Done
          </button>
        ) : isCreateMode ? (
          <button type="button" className={`btn btn-ghost ${styles.headerRight}`} onClick={closeCreateMode}>
            Done
          </button>
        ) : canEdit ? (
          <button
            type="button"
            className={`btn btn-ghost ${styles.headerRight} ${styles.manageWallIconButton}`}
            onClick={() => setIsManagingWall(true)}
            aria-label="Manage wall"
            title="Manage wall"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .66.4 1.26 1.02 1.51l.08.03a2 2 0 1 1 0 2.92l-.08.03A1.65 1.65 0 0 0 19.4 15Z" />
            </svg>
          </button>
        ) : (
          <span className={styles.headerRight} aria-hidden="true" />
        )}
      </header>

      {canEdit && wall?.image && detectionStatus === "failed" && (
        <p className="error-text" role="alert">
          Hold detection failed. You can continue by adding holds manually.
        </p>
      )}

      {canEdit && wall?.pending_reset && (
        <button
          type="button"
          className="btn btn-block"
          onClick={openResetReview}
        >
          {isDetecting(wall.pending_reset.detection_status)
            ? "Partial reset: detecting holds…"
            : "Review changes →"}
        </button>
      )}

      {wallQuery.isLoading ? (
        <div className={styles.loader}>
          <div className="spinner" />
        </div>
      ) : isCreateMode || isManagingWall ? (
        <main className={`content ${styles.body}`}>
          {wallQuery.isError && !wall && (
            <p className="error-text">{wallQuery.error.message}</p>
          )}

          {statusBadge()}

          {wall?.image ? (
            <div className={styles.imageContainer}>
              <WallImage src={wall.image.image_url} alt={wall.wall.name}>
                {(isEditingHolds || (!isManagingWall && filteredHolds.length > 0)) && (
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

          {canEdit && wall?.image && isManagingWall && (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={openPartialReset}
              disabled={uploading}
            >
              Partial reset
            </button>
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
                className={`btn btn-block ${wall?.image && !isManagingWall ? "btn-primary" : "btn-ghost"}`}
                onClick={chooseFullResetImage}
                disabled={uploading}
              >
                {uploading ? "Uploading..." : wall?.image ? "Full reset (new photo)" : "Upload Photo"}
              </button>
            </>
          )}

          {canEditHolds && !isEditingHolds && (
            <button
              type="button"
              className={`btn btn-block ${styles.editHoldsButton}`}
              onClick={() => setEditingHoldsImageId(wall?.image?.id ?? null)}
            >
              {detectionStatus === "failed" ? "Edit Holds Manually" : "Edit Holds"}
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

          {!isManagingWall && !isEditingHolds && detectionStatus === "done" && holds.length > 0 && (
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

          {!isManagingWall && !isEditingHolds && visibleSelectedIds.size >= 2 && (
            <button
              type="button"
              className={`btn btn-block ${styles.createRouteButton}`}
              onClick={() => goToCreateRoute()}
            >
              Create Route ({visibleSelectedIds.size} holds)
            </button>
          )}

        </main>
      ) : (
        <main className={`content ${styles.browseBody}`}>
          {wallQuery.isError && !wall && <p className="error-text">{wallQuery.error.message}</p>}
          <div className={styles.browseHeading}>
            <div className={styles.viewToggle} role="group" aria-label="Wall view">
              <button type="button" className={browseView === "climbs" ? styles.viewActive : ""} aria-pressed={browseView === "climbs"} onClick={() => setBrowseView("climbs")}>
                Climbs{routesQuery.data && routesQuery.data.length > 0 && <span className={styles.viewCount}> {routesQuery.data.length}</span>}
              </button>
              <button type="button" className={browseView === "activity" ? styles.viewActive : ""} aria-pressed={browseView === "activity"} onClick={() => setBrowseView("activity")}>Activity</button>
            </div>
            <Link className={`btn btn-ghost ${styles.manageWallButton}`} to={`/circuits?${new URLSearchParams({ wallId, gymSlug: gymSlug ?? "" })}`}>Circuits</Link>
          </div>
          {browseView === "activity" ? (
            <ActivityFeed gymSlug={gymSlug ?? ""} wallId={wallId} showRoute />
          ) : routesQuery.isLoading ? (
            <div className={styles.loader}>
              <div className="spinner" />
            </div>
          ) : routesQuery.isError && !routesQuery.data ? (
            <p className="error-text">{routesQuery.error.message}</p>
          ) : routesQuery.data?.length ? (
            <RouteList
              routes={routesQuery.data}
              holds={holds}
              imageUrl={wall?.image?.image_url ?? null}
              circuits={circuitsQuery.data ?? []}
              circuitsLoaded={circuitsQuery.isSuccess}
              wallId={wallId}
              gymSlug={gymSlug ?? ""}
            />
          ) : (
            <div className={styles.emptyClimbs}>
              <p>No climbs on this wall yet.</p>
              <span className="muted">Tap + to select holds and create the first climb.</span>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
