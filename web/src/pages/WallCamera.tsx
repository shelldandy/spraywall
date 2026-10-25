import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { uploadWallImage } from "../lib/hooks/mutations";
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
const VIDEO_SIZE = { width: { ideal: 4096 }, height: { ideal: 4096 } };

function lensLabel(name: string): string | null {
  const lower = name.toLowerCase();
  // Front cameras can't shoot the wall, and iOS's virtual Dual/Triple cameras
  // switch lenses on their own, which breaks alignment with the ghost image.
  if (!name || lower.includes("front") || /dual|triple/.test(lower)) return null;
  if (lower.includes("ultra wide")) return "0.5x";
  if (lower.includes("telephoto")) return "Tele";
  if (lower === "back camera") return "1x";
  return name;
}

/** Back camera lenses; empty until camera permission has been granted (no labels before then). */
async function listLenses(): Promise<Lens[]> {
  const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
  const rank = (label: string) => {
    const index = LENS_ORDER.indexOf(label);
    return index === -1 ? LENS_ORDER.length : index;
  };
  return devices
    .filter((device) => device.kind === "videoinput")
    .flatMap((device) => {
      const label = lensLabel(device.label);
      return label ? [{ deviceId: device.deviceId, name: device.label, label }] : [];
    })
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

async function requestStream(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices) throw new Error("Camera unavailable");
  const video = deviceId
    ? { deviceId: { exact: deviceId }, ...VIDEO_SIZE }
    : { facingMode: { ideal: "environment" }, ...VIDEO_SIZE };
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
  const [activeLens, setActiveLens] = useState("");
  const [switching, setSwitching] = useState(false);

  /** Replace the current stream; resolves null if superseded by a newer request or unmount. */
  const openStream = async (deviceId?: string): Promise<MediaStream | null> => {
    const gen = ++streamGenRef.current;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    let media: MediaStream;
    try {
      media = await requestStream(deviceId);
    } catch (error) {
      if (!deviceId) throw error;
      media = await requestStream();
    }
    if (gen !== streamGenRef.current) {
      media.getTracks().forEach((track) => track.stop());
      return null;
    }

    streamRef.current = media;
    setActiveLens(media.getVideoTracks()[0]?.label ?? "");
    const video = videoRef.current;
    if (video) {
      video.srcObject = media;
      await video.play();
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
          if (preferred && preferred.name !== media.getVideoTracks()[0]?.label) {
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
    saveLens(lens.name);
    setSwitching(true);
    try {
      if (await openStream(lens.deviceId)) setReady(true);
    } catch {
      setReady(false);
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
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) {
        toast("Could not capture a camera image.", "error");
        return;
      }
      context.drawImage(video, 0, 0);
      image = await new Promise<Blob | undefined>((resolve) => {
        canvas.toBlob((blob) => resolve(blob ?? undefined), "image/jpeg", 0.9);
      });
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
      <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
        Cancel
      </button>
      <div ref={stageRef} className={styles.stage}>
        <video ref={videoRef} autoPlay playsInline className={styles.video} />
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
            {lenses.map((lens) => (
              <button
                key={lens.deviceId}
                type="button"
                className={`${styles.lens} ${lens.name === activeLens ? styles.lensActive : ""}`}
                disabled={switching || busy}
                aria-pressed={lens.name === activeLens}
                onClick={() => void switchLens(lens)}
              >
                {lens.label}
              </button>
            ))}
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
