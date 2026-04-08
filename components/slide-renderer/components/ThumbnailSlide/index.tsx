import { useMemo } from 'react';
import type { PPTElement, Slide } from '@/lib/types/slides';
import { useSlideBackgroundStyle } from '@/lib/hooks/use-slide-background-style';
import { ThumbnailElement } from './ThumbnailElement';

interface ThumbnailSlideProps {
  /** Slide data */
  readonly slide: Slide;
  /** Thumbnail width */
  readonly size: number;
  /** Viewport width base (default 1000px) */
  readonly viewportSize: number;
  /** Viewport aspect ratio (default 0.5625 i.e. 16:9) */
  readonly viewportRatio: number;
  /** Whether visible (for lazy loading optimization) */
  readonly visible?: boolean;
}

/**
 * Thumbnail slide component
 *
 * Renders a thumbnail preview of a single slide
 * Uses CSS transform scale to resize the entire view for better performance
 */
export function ThumbnailSlide({
  slide,
  size,
  viewportSize,
  viewportRatio,
  visible = true,
}: ThumbnailSlideProps) {
  // Calculate scale ratio
  const scale = useMemo(() => size / viewportSize, [size, viewportSize]);

  const safeElements = useMemo(() => {
    const isTuple2 = (value: unknown): value is [number, number] =>
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number';

    const isSafeElement = (element: PPTElement) => {
      const anyElement = element as unknown as Record<string, unknown>;

      if (
        !element ||
        typeof anyElement.id !== 'string' ||
        typeof anyElement.type !== 'string' ||
        typeof anyElement.left !== 'number' ||
        typeof anyElement.top !== 'number' ||
        typeof anyElement.width !== 'number'
      ) {
        return false;
      }

      if (element.type !== 'line' && typeof anyElement.height !== 'number') {
        return false;
      }

      if (element.type === 'shape') {
        return typeof anyElement.path === 'string' && isTuple2(anyElement.viewBox);
      }

      if (element.type === 'line') {
        return isTuple2(anyElement.start) && isTuple2(anyElement.end) && Array.isArray(anyElement.points);
      }

      if (element.type === 'latex') {
        return typeof anyElement.html === 'string' || (typeof anyElement.path === 'string' && isTuple2(anyElement.viewBox));
      }

      if (element.type === 'chart') {
        return Array.isArray(anyElement.data) && Array.isArray(anyElement.themeColors) && anyElement.themeColors.length > 0;
      }

      return true;
    };

    return Array.isArray(slide?.elements) ? slide.elements.filter(isSafeElement) : [];
  }, [slide]);

  // Get background style
  const { backgroundStyle } = useSlideBackgroundStyle(slide.background);

  if (!visible) {
    return (
      <div
        className="thumbnail-slide bg-white overflow-hidden select-none"
        style={{
          width: `${size}px`,
          height: `${size * viewportRatio}px`,
        }}
      >
        <div className="placeholder w-full h-full flex justify-center items-center text-gray-400 text-sm">
          加载中 ...
        </div>
      </div>
    );
  }

  return (
    <div
      className="thumbnail-slide bg-white overflow-hidden select-none"
      style={{
        width: `${size}px`,
        height: `${size * viewportRatio}px`,
      }}
    >
      <div
        className="elements origin-top-left"
        style={{
          width: `${viewportSize}px`,
          height: `${viewportSize * viewportRatio}px`,
          transform: `scale(${scale})`,
        }}
      >
        {/* Background */}
        <div className="background w-full h-full bg-center absolute" style={backgroundStyle} />

        {/* Render all elements */}
        {safeElements.map((element, index) => (
          <ThumbnailElement key={element.id} elementInfo={element} elementIndex={index + 1} />
        ))}
      </div>
    </div>
  );
}
