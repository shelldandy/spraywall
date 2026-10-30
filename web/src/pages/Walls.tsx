import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api/fetch";
import type { Gym, Wall } from "../lib/api/types";
import { useGymsWithWalls, type GymWithWalls } from "../lib/hooks/queries";
import { toast } from "../lib/toast";
import styles from "./Walls.module.css";

export default function WallsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showGymForm, setShowGymForm] = useState(false);
  const [gymName, setGymName] = useState("");
  const [gymSlug, setGymSlug] = useState("");

  const [wallFormGymSlug, setWallFormGymSlug] = useState<string | null>(null);
  const [wallName, setWallName] = useState("");
  const [formToScroll, setFormToScroll] = useState<"gym" | "wall" | null>(null);
  const gymFormRef = useRef<HTMLFormElement>(null);
  const wallFormRef = useRef<HTMLFormElement>(null);

  const gymsWithWallsQuery = useGymsWithWalls();

  useEffect(() => {
    const create = searchParams.get("create");
    if (create === "gym") {
      // oxlint-disable-next-line react/set-state-in-effect -- URL params initialize inline-form state before they are cleared.
      setShowGymForm(true);
      setFormToScroll("gym");
      setSearchParams({}, { replace: true });
    } else if (create === "wall") {
      const slug = searchParams.get("gymSlug");
      if (slug) {
        setWallFormGymSlug(slug);
        setWallName("");
        setFormToScroll("wall");
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // One-shot: once the requested form has rendered, bring it into view and focus it.
  useEffect(() => {
    if (!formToScroll || gymsWithWallsQuery.isLoading) return;
    const form = formToScroll === "gym" ? gymFormRef.current : wallFormRef.current;
    form?.scrollIntoView({ block: "center" });
    form?.querySelector("input")?.focus({ preventScroll: true });
    // oxlint-disable-next-line react/set-state-in-effect -- Clears the one-shot scroll request after it runs.
    setFormToScroll(null);
  }, [formToScroll, gymsWithWallsQuery.isLoading]);

  const createGymMutation = useMutation<Gym, Error, { name: string; slug: string }>({
    mutationFn: async ({ name, slug }) => {
      const res = await apiFetch("/gyms", {
        method: "POST",
        body: JSON.stringify({ name, slug }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create gym");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      queryClient.invalidateQueries({ queryKey: ["gyms"] });
      setShowGymForm(false);
      setGymName("");
      setGymSlug("");
    },
    onError: (err) => toast(err.message, "error"),
  });

  const createWallMutation = useMutation<Wall, Error, { gymSlug: string; name: string }>({
    mutationFn: async ({ gymSlug, name }) => {
      const res = await apiFetch(`/gyms/${gymSlug}/walls`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || "Failed to create wall");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      setWallFormGymSlug(null);
      setWallName("");
    },
    onError: (err) => toast(err.message, "error"),
  });

  const handleInvite = async (gym: GymWithWalls) => {
    let message: string;
    let inviteLink: string;
    try {
      const res = await apiFetch(`/gyms/${gym.slug}/invites`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Failed to create invite", "error");
        return;
      }
      const data = await res.json();
      inviteLink = `${window.location.origin}/invite/${data.token}`;
      message = `Join ${gym.name} on Spraywall!`;
    } catch {
      toast("Failed to create invite", "error");
      return;
    }

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Spraywall invite", text: message, url: inviteLink });
        return;
      } catch (err) {
        // The user dismissed the share sheet: nothing to do.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Otherwise fall through to copying the link.
      }
    }

    try {
      await navigator.clipboard.writeText(`${message} ${inviteLink}`);
      toast("Invite link copied to clipboard.");
    } catch {
      toast(`Could not copy the invite link: ${inviteLink}`, "error");
    }
  };

  const handleDeleteGym = async (gym: GymWithWalls) => {
    const ok = window.confirm(
      `Are you sure you want to delete "${gym.name}"? All walls, routes, and sends will be permanently deleted.`,
    );
    if (!ok) return;
    try {
      const res = await apiFetch(`/gyms/${gym.slug}`, { method: "DELETE" });
      // 404 means already deleted on the server: just refresh the list.
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Failed to delete gym", "error");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      queryClient.invalidateQueries({ queryKey: ["gyms"] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    } catch {
      toast("Failed to delete gym", "error");
    }
  };

  const handleDeleteWall = async (gym: GymWithWalls, wallId: string, wallName: string) => {
    const ok = window.confirm(
      `Are you sure you want to delete "${wallName}"? All routes and sends on this wall will be permanently deleted.`,
    );
    if (!ok) return;
    try {
      const res = await apiFetch(`/gyms/${gym.slug}/walls/${wallId}`, { method: "DELETE" });
      // 404 means already deleted on the server: just refresh the list.
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Failed to delete wall", "error");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["gyms-with-walls"] });
      queryClient.removeQueries({ queryKey: ["wall-detail", wallId] });
      queryClient.removeQueries({ queryKey: ["holds", wallId] });
      queryClient.removeQueries({ queryKey: ["routes", wallId] });
      queryClient.invalidateQueries({ queryKey: ["logbook"] });
    } catch {
      toast("Failed to delete wall", "error");
    }
  };

  const submitWall = (e: FormEvent, gym: GymWithWalls) => {
    e.preventDefault();
    if (!wallName.trim() || createWallMutation.isPending) return;
    createWallMutation.mutate({ gymSlug: gym.slug, name: wallName.trim() });
  };

  const submitGym = (e: FormEvent) => {
    e.preventDefault();
    if (!gymName.trim() || !gymSlug.trim() || createGymMutation.isPending) return;
    createGymMutation.mutate({ name: gymName.trim(), slug: gymSlug.trim() });
  };

  const data = gymsWithWallsQuery.data ?? [];

  return (
    <div className={`screen ${styles.page}`}>
      <header className="header">
        <h1>
          <span className={styles.brand}>
            <img
              src="/logo-128.png"
              srcSet="/logo-256.png 2x"
              alt=""
              width={28}
              height={28}
            />
            <span className={styles.wordmark}>Spraywall</span>
          </span>
        </h1>
      </header>

      <main className="content">
        {gymsWithWallsQuery.isLoading ? (
          <div className={styles.loader}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            {gymsWithWallsQuery.isError && (
              <p className={`error-text ${styles.listError}`} role="alert">
                {data.length > 0
                  ? `Could not refresh the wall list. Showing previously loaded data. ${gymsWithWallsQuery.error.message}`
                  : gymsWithWallsQuery.error.message}
              </p>
            )}
            {!gymsWithWallsQuery.isError && data.length === 0 && (
              <p className={styles.empty}>No gyms yet. Create one to get started.</p>
            )}

            {data.map((gym) => {
              const isAdmin = gym.user_role === "admin";
              const canEditWalls = isAdmin || gym.user_role === "setter";
              return (
                <section key={gym.id} className={styles.gymSection}>
                  <div className={styles.gymHeader}>
                    <h2 className={styles.gymName}>{gym.name}</h2>
                    {isAdmin && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => handleInvite(gym)}
                      >
                        Invite
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        type="button"
                        className={`btn btn-ghost ${styles.deleteBtn}`}
                        onClick={() => handleDeleteGym(gym)}
                        aria-label={`Delete gym ${gym.name}`}
                        title="Delete gym"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>

                  <ul className={styles.wallGrid}>
                    {gym.walls.map((wall) => (
                      <WallCard
                        key={wall.id}
                        wall={wall}
                        gymSlug={gym.slug}
                        canDelete={canEditWalls}
                        onDelete={() => handleDeleteWall(gym, wall.id, wall.name)}
                      />
                    ))}
                  </ul>

                  {canEditWalls &&
                    (wallFormGymSlug === gym.slug ? (
                      <form ref={wallFormRef} className={styles.inlineForm} onSubmit={(e) => submitWall(e, gym)}>
                        <input
                          className="input"
                          placeholder="Wall name"
                          value={wallName}
                          onChange={(e) => setWallName(e.target.value)}
                          autoFocus
                          enterKeyHint="go"
                        />
                        <div className={styles.formButtons}>
                          <button
                            type="button"
                            className={`btn btn-ghost ${styles.cancel}`}
                            onClick={() => {
                              setWallFormGymSlug(null);
                              setWallName("");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={!wallName.trim() || createWallMutation.isPending}
                          >
                            {createWallMutation.isPending ? "Creating..." : "Add"}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn-ghost ${styles.addWall}`}
                        onClick={() => {
                          setWallFormGymSlug(gym.slug);
                          setWallName("");
                        }}
                      >
                        + Add Wall
                      </button>
                    ))}
                </section>
              );
            })}

            {showGymForm ? (
              <form ref={gymFormRef} className={styles.gymForm} onSubmit={submitGym}>
                <h3 className={styles.formTitle}>New Gym</h3>
                <input
                  className="input"
                  placeholder="Gym name"
                  value={gymName}
                  onChange={(e) => setGymName(e.target.value)}
                  autoFocus
                  enterKeyHint="next"
                />
                <input
                  className="input"
                  placeholder="Slug (e.g. my-gym)"
                  value={gymSlug}
                  onChange={(e) => setGymSlug(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                />
                <div className={styles.formButtons}>
                  <button
                    type="button"
                    className={`btn btn-ghost ${styles.cancel}`}
                    onClick={() => {
                      setShowGymForm(false);
                      setGymName("");
                      setGymSlug("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!gymName.trim() || !gymSlug.trim() || createGymMutation.isPending}
                  >
                    {createGymMutation.isPending ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                className={`btn btn-primary btn-block ${styles.createGym}`}
                onClick={() => setShowGymForm(true)}
              >
                + Create Gym
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function WallCard({
  wall,
  gymSlug,
  canDelete,
  onDelete,
}: {
  wall: Wall;
  gymSlug: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const imageUrl = wall.preview_image_url;

  return (
    <li className={styles.wallTile}>
      <Link
        to={`/walls/${wall.id}?gymSlug=${encodeURIComponent(gymSlug)}`}
        className={styles.wallCard}
      >
        <span className={styles.wallPreview}>
          {imageUrl ? (
            <img src={imageUrl} alt={wall.name} loading="lazy" />
          ) : (
            <span className={styles.imagePlaceholder} aria-hidden="true">
              <WallIcon />
              <span>No photo yet</span>
            </span>
          )}
        </span>
        <span className={styles.wallName}>{wall.name}</span>
      </Link>
      {canDelete && (
        <button
          type="button"
          className={`btn btn-ghost ${styles.deleteBtn} ${styles.wallDelete}`}
          onClick={onDelete}
          aria-label={`Delete wall ${wall.name}`}
          title="Delete wall"
        >
          <TrashIcon />
        </button>
      )}
    </li>
  );
}

function WallIcon() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 44 44"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 36V10l28-3v29H8Z" />
      <path d="m15 17 2-1m8 0 2-1m-13 9 2-1m8 0 2-1m-13 9 2-1m8 0 2-1" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
