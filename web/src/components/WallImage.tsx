import type { ReactNode } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import styles from "./WallImage.module.css";

interface WallImageProps {
  src: string;
  alt?: string;
  /** Usually a <HoldOverlay />, positioned over the image. */
  children?: ReactNode;
}

/**
 * A wall photo with pinch/scroll zoom, drag to pan, and double-tap to toggle zoom.
 * Replaces the React Native ZoomableView (gesture-handler + reanimated).
 */
export default function WallImage({ src, alt = "Wall", children }: WallImageProps) {
  return (
    <TransformWrapper
      minScale={1}
      maxScale={5}
      doubleClick={{ mode: "toggle", step: 1.5 }}
      wheel={{ step: 0.2 }}
    >
      <TransformComponent wrapperClass={styles.wrapper} contentClass={styles.content}>
        <div className={styles.frame}>
          <img className={styles.image} src={src} alt={alt} draggable={false} />
          {children}
        </div>
      </TransformComponent>
    </TransformWrapper>
  );
}
