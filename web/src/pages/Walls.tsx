import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/fetch";
import type { Wall } from "../lib/api/types";
import { useMe, useWalls } from "../lib/hooks/queries";
import { toast } from "../lib/toast";
import styles from "./Walls.module.css";

export default function WallsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const profile = useMe();
  const wallsQuery = useWalls();
  const [showWallForm, setShowWallForm] = useState(false);
  const [wallName, setWallName] = useState("");
  const wallFormRef = useRef<HTMLFormElement>(null);
  const canManageWalls = profile.data?.role === "setter" || profile.data?.role === "admin";

  useEffect(() => {
    if (searchParams.get("create") !== "wall") return;
    // oxlint-disable-next-line react/set-state-in-effect -- URL params initialize inline-form state before they are cleared.
    setShowWallForm(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!showWallForm || wallsQuery.isLoading) return;
    wallFormRef.current?.scrollIntoView({ block: "center" });
    wallFormRef.current?.querySelector("input")?.focus({ preventScroll: true });
  }, [showWallForm, wallsQuery.isLoading]);

  const createWall = useMutation<Wall, Error, string>({
    mutationFn: async (name) => {
      const response = await apiFetch("/walls", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to create wall");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["walls"] });
      setShowWallForm(false);
      setWallName("");
    },
    onError: (error) => toast(error.message, "error"),
  });

  const handleDeleteWall = async (wall: Wall) => {
    if (!window.confirm(`Delete "${wall.name}"? All routes and sends on this wall will be permanently deleted.`)) return;
    try {
      const response = await apiFetch(`/walls/${wall.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const data = await response.json().catch(() => null);
        toast(data?.error || "Failed to delete wall", "error");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["walls"] });
      queryClient.removeQueries({ queryKey: ["wall-detail", wall.id] });
      queryClient.removeQueries({ queryKey: ["holds", wall.id] });
      queryClient.removeQueries({ queryKey: ["routes", wall.id] });
      queryClient.removeQueries({ queryKey: ["circuits", wall.id] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    } catch {
      toast("Failed to delete wall", "error");
    }
  };

  const submitWall = (event: FormEvent) => {
    event.preventDefault();
    if (!wallName.trim() || createWall.isPending) return;
    createWall.mutate(wallName.trim());
  };

  const walls = wallsQuery.data ?? [];

  return (
    <div className={`screen ${styles.page}`}>
      <header className="header">
        <h1>
          <span className={styles.brand}>
            <img src="/logo-128.png" srcSet="/logo-256.png 2x" alt="" width={28} height={28} />
            <span className={styles.wordmark}>Spraywall</span>
          </span>
        </h1>
      </header>

      <main className="content">
        {wallsQuery.isLoading ? (
          <div className={styles.loader}><div className="spinner" /></div>
        ) : (
          <>
            {wallsQuery.isError && (
              <p className={`error-text ${styles.listError}`} role="alert">
                {walls.length > 0
                  ? `Could not refresh the wall list. Showing previously loaded data. ${wallsQuery.error.message}`
                  : wallsQuery.error.message}
              </p>
            )}
            {!wallsQuery.isError && walls.length === 0 && <p className={styles.empty}>No walls yet.</p>}

            <ul className={styles.wallGrid}>
              {walls.map((wall) => (
                <WallCard
                  key={wall.id}
                  wall={wall}
                  canDelete={canManageWalls}
                  onDelete={() => void handleDeleteWall(wall)}
                />
              ))}
            </ul>

            {canManageWalls && (showWallForm ? (
              <form ref={wallFormRef} className={styles.inlineForm} onSubmit={submitWall}>
                <input
                  className="input"
                  placeholder="Wall name"
                  value={wallName}
                  onChange={(event) => setWallName(event.target.value)}
                  autoFocus
                  enterKeyHint="go"
                />
                <div className={styles.formButtons}>
                  <button type="button" className={`btn btn-ghost ${styles.cancel}`} onClick={() => { setShowWallForm(false); setWallName(""); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!wallName.trim() || createWall.isPending}>
                    {createWall.isPending ? "Creating..." : "Add"}
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className={`btn btn-ghost ${styles.addWall}`} onClick={() => setShowWallForm(true)}>
                + Add wall
              </button>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

function WallCard({ wall, canDelete, onDelete }: { wall: Wall; canDelete: boolean; onDelete: () => void }) {
  return (
    <li className={styles.wallTile}>
      <Link to={`/walls/${wall.id}`} className={styles.wallCard}>
        <span className={styles.wallPreview}>
          {wall.preview_image_url ? (
            <img src={wall.preview_image_url} alt={wall.name} loading="lazy" />
          ) : (
            <span className={styles.imagePlaceholder} aria-hidden="true"><WallIcon /><span>No photo yet</span></span>
          )}
        </span>
        <span className={styles.wallName}>{wall.name}</span>
      </Link>
      {canDelete && (
        <button type="button" className={`btn btn-ghost ${styles.deleteBtn} ${styles.wallDelete}`} onClick={onDelete} aria-label={`Delete wall ${wall.name}`} title="Delete wall">
          <TrashIcon />
        </button>
      )}
    </li>
  );
}

function WallIcon() {
  return <svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 36V10l28-3v29H8Z" /><path d="m15 17 2-1m8 0 2-1m-13 9 2-1m8 0 2-1m-13 9 2-1m8 0 2-1" /></svg>;
}

function TrashIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></svg>;
}
