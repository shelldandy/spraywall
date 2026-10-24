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
  const [videoFrame, setVideoFrame] = useState<VideoFrame>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });
  const [ready, setReady] = useState(false);
  const [opacity, setOpacity] = useState(0.4);
  const [busy, setBusy] = useState(false);

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
        const media = await navigator.mediaDevices?.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 4096 },
            height: { ideal: 4096 },
          },
          audio: false,
        });
        if (!media) return;
        if (!mounted) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = media;
        if (video) {
          video.srcObject = media;
          await video.play();
          updateVideoFrame();
        }
        if (mounted) setReady(true);
      } catch {
        if (mounted) setReady(false);
      }
    };

    void startCamera();

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      video?.removeEventListener("loadedmetadata", updateVideoFrame);
      video?.removeEventListener("resize", updateVideoFrame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

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
        {!ready && <div className={styles.fallback}>Camera unavailable — choose a photo</div>}
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
