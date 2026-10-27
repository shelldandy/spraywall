import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCreateBetaVideo, useDeleteBetaVideo } from "../lib/hooks/mutations";
import { useBetaVideos } from "../lib/hooks/queries";
import { betaVideoPlatformIcon, betaVideoPlatformName, parseBetaVideoURL } from "../lib/betaVideos";
import type { BetaVideo } from "../lib/api/types";
import styles from "./BetaVideos.module.css";

interface BetaVideosProps {
  gymSlug: string;
  wallId: string;
  routeId: string;
}

function BetaCardContent({ video }: { video: BetaVideo }) {
  const fallback = video.climber_handle ? `@${video.climber_handle}` : video.user.display_name;
  return (
    <>
      {video.thumbnail_url ? (
        <img className={styles.thumbnail} src={video.thumbnail_url} alt="" loading="lazy" />
      ) : (
        <span className={`${styles.placeholder} ${styles[video.source]}`} aria-hidden="true">
          <span className={styles.bigIcon}>{betaVideoPlatformIcon(video.source)}</span>
        </span>
      )}
      <span className={styles.platform}>
        <span aria-hidden="true">{betaVideoPlatformIcon(video.source)}</span> {betaVideoPlatformName(video.source)}
      </span>
      <span className={styles.handle}>{fallback}</span>
    </>
  );
}

export default function BetaVideos({ gymSlug, wallId, routeId }: BetaVideosProps) {
  const query = useBetaVideos({ gymSlug, wallId, routeId });
  const create = useCreateBetaVideo(gymSlug, wallId, routeId);
  const remove = useDeleteBetaVideo(gymSlug, wallId, routeId);
  const [formOpen, setFormOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [handle, setHandle] = useState("");
  const [formError, setFormError] = useState("");
  const [selected, setSelected] = useState<BetaVideo | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? items.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    else if (!selected && dialog.open) dialog.close();
  }, [selected]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseBetaVideoURL(url);
    if (!parsed) {
      setFormError("Paste a YouTube, Instagram, TikTok, or Immich video link.");
      return;
    }
    setFormError("");
    const climberHandle = handle.trim().replace(/^@/, "");
    void create.mutateAsync({ url: parsed.normalized, ...(climberHandle ? { climber_handle: climberHandle } : {}) })
      .then(() => {
        setUrl("");
        setHandle("");
        setFormOpen(false);
      })
      .catch(() => undefined);
  };

  const deleteVideo = (video: BetaVideo) => {
    if (!window.confirm("Delete this beta video?")) return;
    remove.mutate(video.id);
  };

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2>Beta Videos</h2>
          <span className={styles.count}>{total} {total === 1 ? "video" : "videos"}</span>
        </div>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => { setFormOpen((open) => !open); setFormError(""); }}
          aria-label={formOpen ? "Close add beta video form" : "Add beta video"}
          title={formOpen ? "Close" : "Add beta video"}
        >
          {formOpen ? "×" : "⊕"}
        </button>
      </header>

      {formOpen && (
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>Video link</span>
            <input
              type="url"
              value={url}
              onChange={(event) => { setUrl(event.target.value); setFormError(""); }}
              placeholder="Paste a video link"
              required
              autoFocus
            />
          </label>
          <label className={styles.field}>
            <span>Climber @handle <small>(optional)</small></span>
            <input
              type="text"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="who's climbing?"
              maxLength={80}
            />
          </label>
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <button className="btn btn-primary" type="submit" disabled={create.isPending || !url.trim()}>
            {create.isPending ? "Adding…" : "Add video"}
          </button>
        </form>
      )}

      {query.isLoading ? (
        <div className={styles.loading}><div className="spinner" /></div>
      ) : query.isError && !query.data ? (
        <p className="error-text" role="alert">{query.error.message}</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>No beta yet. Add a video link.</p>
      ) : (
        <div className={styles.scroller} aria-label="Beta videos">
          {items.map((video) => (
            <article className={styles.card} key={video.id}>
              {video.source === "immich" ? (
                <button type="button" className={styles.mediaButton} onClick={() => setSelected(video)} aria-label={`Play Immich beta from ${video.user.display_name}`}>
                  <BetaCardContent video={video} />
                </button>
              ) : (
                <a className={styles.mediaLink} href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${betaVideoPlatformName(video.source)} beta from ${video.user.display_name}`}>
                  <BetaCardContent video={video} />
                </a>
              )}
              {video.can_delete && (
                <button type="button" className={styles.deleteButton} onClick={() => deleteVideo(video)} disabled={remove.isPending} aria-label="Delete beta video" title="Delete beta video">
                  ×
                </button>
              )}
            </article>
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label="Beta video player"
        onClose={() => setSelected(null)}
        onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current?.close(); }}
      >
        {selected?.source === "immich" && (
          <div className={styles.player}>
            <button type="button" className={styles.closeButton} onClick={() => dialogRef.current?.close()} aria-label="Close video">×</button>
            <video controls playsInline preload="metadata" src={selected.playback_url ?? undefined} poster={selected.thumbnail_url ?? undefined} />
            <p>{selected.climber_handle ? `@${selected.climber_handle}` : selected.user.display_name}</p>
          </div>
        )}
      </dialog>
    </div>
  );
}

