import { useEffect, useRef, useState, type ReactNode } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import styles from "./WallImage.module.css";

interface WallImageProps {
  src: string;
  alt?: string;
  /** Usually a <HoldOverlay />, positioned over the image. */
  children?: ReactNode;
  /** Fill the available parent box and contain the image (for full-screen editors). */
  fitContainer?: boolean;
  onAspectRatioChange?: (aspectRatio: number) => void;
}

/**
 * A wall photo with pinch/scroll zoom, drag to pan, and double-tap to toggle zoom.
 * Replaces the React Native ZoomableView (gesture-handler + reanimated).
 */
export default function WallImage({
  src,
  alt = "Wall",
  children,
  fitContainer = false,
  onAspectRatioChange,
}: WallImageProps) {
  const fitViewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [imageAspectRatio, setImageAspectRatio] = useState<number>();

  useEffect(() => {
    if (!fitContainer || !fitViewportRef.current) return;

    const viewport = fitViewportRef.current;
    const observer = new ResizeObserver(() => {
      const { width, height } = viewport.getBoundingClientRect();
      setViewportSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitContainer]);

  const fittedWidth = imageAspectRatio
    ? Math.min(viewportSize.width, viewportSize.height * imageAspectRatio)
    : 0;
  const fittedHeight = fittedWidth > 0 ? fittedWidth / imageAspectRatio! : 0;
  const frameStyle = fittedWidth > 0 && fittedHeight > 0
    ? { width: fittedWidth, height: fittedHeight }
    : undefined;

  const imageView = (
    <TransformWrapper
      minScale={1}
      maxScale={5}
      doubleClick={{ mode: "toggle", step: 1.5 }}
      wheel={{ step: 0.2 }}
    >
      <TransformComponent
        wrapperClass={fitContainer ? styles.fitWrapper : styles.wrapper}
        contentClass={fitContainer ? styles.fitContent : styles.content}
      >
        <div className={`${styles.frame} ${fitContainer ? styles.fitFrame : ""}`} style={frameStyle}>
          <img
            className={`${styles.image} ${fitContainer ? styles.fitImage : ""}`}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalHeight > 0) {
                const aspectRatio = image.naturalWidth / image.naturalHeight;
                setImageAspectRatio(aspectRatio);
                onAspectRatioChange?.(aspectRatio);
              }
            }}
          />
          {children}
        </div>
      </TransformComponent>
    </TransformWrapper>
  );

  return fitContainer ? (
    <div ref={fitViewportRef} className={styles.fitViewport}>
      {imageView}
    </div>
  ) : imageView;
}
