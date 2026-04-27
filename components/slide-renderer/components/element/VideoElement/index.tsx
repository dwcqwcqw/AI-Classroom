'use client';

import type { PPTVideoElement } from '@/lib/types/slides';
import { isMediaPlaceholder } from '@/lib/store/media-generation';

export interface VideoElementProps {
  elementInfo: PPTVideoElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTVideoElement) => void;
}

/**
 * Editable video element component (编辑模式).
 * 点击选中元素用于编辑，不处理播放。
 * 播放由播放模式下的 BaseVideoElement + playingVideoElementId 控制。
 */
export function VideoElement({ elementInfo, selectElement }: VideoElementProps) {
  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  return (
    <div
      className={`editable-element-video absolute ${elementInfo.lock ? 'lock' : ''}`}
      style={{
        top: `${elementInfo.top}px`,
        left: `${elementInfo.left}px`,
        width: `${elementInfo.width}px`,
        height: `${elementInfo.height}px`,
      }}
    >
      <div
        className="rotate-wrapper w-full h-full"
        style={{ transform: `rotate(${elementInfo.rotate}deg)` }}
      >
        <div
          className={`element-content w-full h-full relative ${elementInfo.lock ? '' : 'cursor-move'}`}
          onMouseDown={handleSelectElement}
          onTouchStart={handleSelectElement}
        >
          {elementInfo.poster ? (
            <img
              className="w-full h-full"
              style={{ objectFit: 'contain' }}
              src={elementInfo.poster}
              alt=""
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
            />
          ) : elementInfo.src && !isMediaPlaceholder(elementInfo.src) ? (
            <video
              className="w-full h-full"
              style={{ objectFit: 'contain', pointerEvents: 'none' }}
              src={elementInfo.src}
              preload="metadata"
            />
          ) : (
            <div className="w-full h-full bg-black/10 rounded" />
          )}
        </div>
      </div>
    </div>
  );
}
