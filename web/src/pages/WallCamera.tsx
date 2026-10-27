import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { uploadWallImage } from "../lib/hooks/mutations";
import { filterAmbiguousWideLenses, lensLabel } from "../lib/cameraLenses";
import { toast } from "../lib/toast";
import styles from "./WallCamera.module.css";

interface VideoFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Lens {
  deviceId: string;
  /** Device label reported by the browser, e.g. "Back Ultra Wide Camera". */
  name: string;
  /** Short button label, e.g. "0.5x". */
  label: string;
}

interface ImageCaptureConstructor {
  new (track: MediaStreamTrack): { takePhoto: () => Promise<Blob> };
}

function getContainedFrame(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number,
): VideoFrame {
  if (containerWidth <= 0 || containerHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  const scale = Math.min(containerWidth / videoWidth, containerHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
    width,
    height,
  };
}

const LENS_KEY = "spraywall-camera-lens";
const LENS_ORDER = ["0.5x", "1x", "Tele"];
// iOS renders a black preview when asked for 4096 (its photo-only sensor formats);
// 1920 streams fine.
const VIDEO_SIZE = { width: { ideal: 1920 }, height: { ideal: 1920 } };
const PHOTO_SIZE = { width: { ideal: 4096 }, height: { ideal: 4096 } };

/** Resolves on the next decoded video frame, or after a timeout. */
function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Draws the current video frame; null if there is no frame yet. */
function drawFrame(video: HTMLVideoElement): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) return null;
  context.drawImage(video, 0, 0);
  return canvas;
}

/** True if a downscaled copy of the canvas is entirely black. */
function isBlank(canvas: HTMLCanvasElement): boolean {
  const sample = document.createElement("canvas");
  sample.width = 16;
  sample.height = 16;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, 16, 16);
  const { data } = context.getImageData(0, 0, 16, 16);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] + data[i + 1] + data[i + 2] > 15) return false;
  }
  return true;
}

/**
 * iOS can't take photos from a stream and shows a black preview at full size, so
 * briefly raise the track to full size for a single frame, then restore the preview.
 * Null if the full-size frame is no larger than the preview or comes out blank.
 */
async function drawFullSizeFrame(
  video: HTMLVideoElement,
  track: MediaStreamTrack,
): Promise<HTMLCanvasElement | null> {
  const previewWidth = video.videoWidth;
  try {
    await track.applyConstraints(PHOTO_SIZE);
    for (let i = 0; i < 5 && video.videoWidth <= previewWidth; i++) await nextFrame(video);
    await nextFrame(video);
    const canvas = drawFrame(video);
    return canvas && canvas.width > previewWidth && !isBlank(canvas) ? canvas : null;
  } catch {
    return null;
  } finally {
    await track.applyConstraints(VIDEO_SIZE).catch(() => undefined);
    for (let i = 0; i < 5 && video.videoWidth > previewWidth; i++) await nextFrame(video);
    await nextFrame(video);
  }
}

/** Back camera lenses; empty until camera permission has been granted (no labels before then). */
async function listLenses(): Promise<Lens[]> {
  const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
  const rank = (label: string) => {
    const index = LENS_ORDER.indexOf(label);
    return index === -1 ? LENS_ORDER.length : index;
  };
  const candidates = devices
    .filter((device) => device.kind === "videoinput")
    .flatMap((device) => {
      const label = lensLabel(device.label);
      return label ? [{ deviceId: device.deviceId, name: device.label, label }] : [];
    });
  return filterAmbiguousWideLenses(candidates)
    .sort((a, b) => rank(a.label) - rank(b.label));
}

function readSavedLens(): string | null {
  try { return localStorage.getItem(LENS_KEY); } catch { return null; }
}

function saveLens(name: string) {
  try { localStorage.setItem(LENS_KEY, name); } catch { /* storage unavailable */ }
}

/** The saved lens if present, else the ultra wide (walls are usually shot wide). */
function preferredLens(lenses: Lens[]): Lens | undefined {
  const saved = readSavedLens();
  return lenses.find((lens) => lens.name === saved) ?? lenses.find((lens) => lens.label === "0.5x");
}

async function requestStream(deviceId?: string, includeVideoSize = true): Promise<MediaStream> {
  if (!navigator.mediaDevices) throw new Error("Camera unavailable");
  const size = includeVideoSize ? VIDEO_SIZE : {};
  const video = deviceId
    ? { deviceId: { exact: deviceId }, ...size }
    : { facingMode: { ideal: "environment" }, ...size };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export default function WallCameraPage() {
  const { wallId = "" } = useParams();
  const [params] = useSearchParams();
  const gymSlug = params.get("gymSlug") ?? "";
  const oldImage = params.get("old") ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Bumped on every stream request and on unmount so stale requests drop their stream.
  const streamGenRef = useRef(0);
  const [videoFrame, setVideoFrame] = useState<VideoFrame>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [ready, setReady] = useState(false);
  const [opacity, setOpacity] = useState(0.4);
  const [busy, setBusy] = useState(false);
  const [lenses, setLenses] = useState<Lens[]>([]);
  const [activeLens, setActiveLens] = useState<{ deviceId?: string; name: string }>({ name: "" });
  const [switching, setSwitching] = useState(false);

  /** Replace the current stream; resolves null if superseded by a newer request or unmount. */
  const openStream = async (deviceId?: string, fallback = true): Promise<MediaStream | null> => {
    const gen = ++streamGenRef.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    let media: MediaStream;
    try {
      media = await requestStream(deviceId);
    } catch (error) {
      if (!deviceId) throw error;
      try {
        media = await requestStream(deviceId, false);
      } catch (retryError) {
        if (!fallback) throw retryError;
        media = await requestStream();
      }
    }
    if (gen !== streamGenRef.current) {
      media.getTracks().forEach((track) => track.stop());
      return null;
    }

    streamRef.current = media;
    const track = media.getVideoTracks()[0];
    setActiveLens({ deviceId: track?.getSettings().deviceId, name: track?.label ?? "" });
    const video = videoRef.current;
    if (video) {
      // iOS keeps rendering the ended stream (a black frame) unless the element is
      // detached first, and only plays inline video without a gesture when muted.
      video.pause();
      video.srcObject = null;
      video.muted = true;
      video.srcObject = media;
      // A rejected play() doesn't mean the stream is bad; autoplay can still start it.
      await video.play().catch(() => undefined);
    }
    return gen === streamGenRef.current ? media : null;
  };

  useEffect(() => {
    let mounted = true;
    const video = videoRef.current;
    const stage = stageRef.current;

    const updateVideoFrame = () => {
      if (!video || !stage) return;
      setVideoFrame(
        getContainedFrame(stage.clientWidth, stage.clientHeight, video.videoWidth, video.videoHeight),
      );
    };

    const resizeObserver =
      stage && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateVideoFrame)
        : null;
    if (stage) resizeObserver?.observe(stage);
    video?.addEventListener("loadedmetadata", updateVideoFrame);
    video?.addEventListener("resize", updateVideoFrame);

    const startCamera = async () => {
      try {
        // With permission already granted, labels are available up front and we can
        // open the preferred lens directly; otherwise open the default camera first.
        let available = await listLenses();
        const media = await openStream(preferredLens(available)?.deviceId);
        if (!media) return;
        updateVideoFrame();

        if (available.length === 0) {
          available = await listLenses();
          const preferred = preferredLens(available);
          const track = media.getVideoTracks()[0];
          const activeDeviceId = track?.getSettings().deviceId;
          const preferredIsActive = activeDeviceId
            ? preferred?.deviceId === activeDeviceId
            : preferred?.name === track?.label;
          if (preferred && !preferredIsActive) {
            if (!(await openStream(preferred.deviceId))) return;
          }
        }
        if (mounted) {
          setLenses(available);
          setReady(true);
        }
      } catch {
        if (mounted) setReady(false);
      }
    };

    void startCamera();

    return () => {
      mounted = false;
      // A counter, not a DOM ref: bumping the live value is the point.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      streamGenRef.current++;
      resizeObserver?.disconnect();
      video?.removeEventListener("loadedmetadata", updateVideoFrame);
      video?.removeEventListener("resize", updateVideoFrame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const switchLens = async (lens: Lens) => {
    const previousTrack = streamRef.current?.getVideoTracks()[0];
    const previousDeviceId =
      previousTrack?.getSettings().deviceId ||
      lenses.find((availableLens) => availableLens.name === previousTrack?.label)?.deviceId;
    setSwitching(true);
    try {
      const media = await openStream(lens.deviceId, false);
      if (media) {
        saveLens(lens.name);
        setReady(true);
      }
    } catch {
      let restored = false;
      try {
        restored = Boolean(previousDeviceId
          ? await openStream(previousDeviceId, false)
          : await openStream());
      } catch {
        // If the previous camera can't be reopened, leave the camera in its unavailable state.
      }
      setReady(restored);
      toast("Couldn't switch to that lens", "error");
    } finally {
      setSwitching(false);
    }
  };

  const upload = async (image: Blob) => {
    setBusy(true);
    try {
      const response = await uploadWallImage(gymSlug, wallId, image, "partial");
      if (!response.ok) throw new Error(await response.text());

      await queryClient.invalidateQueries({ queryKey: ["wall-detail", wallId] });
      await queryClient.invalidateQueries({ queryKey: ["holds", wallId] });
      await queryClient.invalidateQueries({ queryKey: ["routes", wallId] });
      navigate(`/walls/${wallId}?gymSlug=${gymSlug}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video) return;

    let image: Blob | undefined;
    const track = streamRef.current?.getVideoTracks()[0];
    const ImageCapture = (window as Window & { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
    if (track && ImageCapture) {
      try {
        image = await new ImageCapture(track).takePhoto();
      } catch {
        // Fall back to a frame captured from the video element.
      }
    }

    if (!image) {
      setBusy(true);
      const fullSize = track ? await drawFullSizeFrame(video, track) : null;
      const canvas = fullSize ?? drawFrame(video);
      if (canvas) {
        image = await new Promise<Blob | undefined>((resolve) => {
          canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", 0.9);
        });
      }
      if (!image) setBusy(false);
    }

    if (image) await upload(image);
    else toast("Could not capture a camera image.", "error");
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void upload(file);
  };

  return (
    <main className={styles.camera}>
      <Link className="btn btn-ghost" to={`/walls/${wallId}?gymSlug=${gymSlug}`}>
        Cancel
      </Link>
      <div ref={stageRef} className={styles.stage}>
        <video ref={videoRef} autoPlay muted playsInline className={styles.video} />
        {oldImage && ready && videoFrame.width > 0 && (
          <img
            src={oldImage}
            className={styles.ghost}
            style={{
              left: videoFrame.left,
              top: videoFrame.top,
              width: videoFrame.width,
              height: videoFrame.height,
              opacity,
            }}
            alt="Previous wall photo alignment guide"
          />
        )}
        {!ready && (
          <div className={styles.fallback}>
            {window.isSecureContext
              ? "Camera unavailable — choose a photo"
              : "Camera needs HTTPS — choose a photo"}
          </div>
        )}
        {lenses.length > 1 && (
          <div className={styles.lenses}>
            {lenses.map((lens) => {
              const isActive = activeLens.deviceId
                ? lens.deviceId === activeLens.deviceId
                : lens.name === activeLens.name;
              return (
                <button
                  key={lens.deviceId}
                  type="button"
                  className={`${styles.lens} ${isActive ? styles.lensActive : ""}`}
                  disabled={switching || busy}
                  aria-pressed={isActive}
                  onClick={() => void switchLens(lens)}
                >
                  {lens.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {oldImage && (
        <label className={styles.opacity}>
          Ghost opacity
          <input
            type="range"
            min="0"
            max="0.8"
            step="0.05"
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
          />
        </label>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => document.getElementById("wall-library")?.click()}
        >
          Library
        </button>
        <input
          id="wall-library"
          type="file"
          accept="image/*"
          hidden
          onChange={chooseFile}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready || busy}
          onClick={() => void capture()}
        >
          {busy ? "Uploading…" : "Capture"}
        </button>
      </div>
    </main>
  );
}
