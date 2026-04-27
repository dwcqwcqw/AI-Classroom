'use client';

import { useRef, useEffect, useState } from 'react';
import type { PPTVideoElement } from '@/lib/types/slides';
import { isMediaPlaceholder } from '@/lib/store/media-generation';
import { useCanvasStore } from '@/lib/store/canvas';

export interface VideoElementProps {
  elementInfo: PPTVideoElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTVideoElement) => void;
}

/**
 * Editable video element component.
 * In edit mode:
 * - Does NOT display play button overlay
 * - Clicking plays the video (only in edit mode)
 * - Video stops when clicking outside or selecting another element
 */
export function VideoElement({ elementInfo, selectElement }: VideoElementProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playingVideoElementId = useCanvasStore.use.playingVideoElementId();
  const playVideo = useCanvasStore.use.playVideo();
  const pauseVideo = useCanvasStore.use.pauseVideo();

  const isCurrentlyPlaying = playingVideoElementId === elementInfo.id;

  // Sync with global play state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isCurrentlyPlaying && !isPlaying) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else if (!isCurrentlyPlaying && isPlaying) {
      video.pause();
      setIsPlaying(false);
    }
  }, [isCurrentlyPlaying, isPlaying]);

  // Handle video ended
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnded = () => {
      pauseVideo();
      setIsPlaying(false);
    };

    video.addEventListener('ended', handleEnded);
    return () => video.removeEventListener('ended', handleEnded);
  }, [pauseVideo]);

  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (elementInfo.lock) return;

    // In edit mode, clicking the video toggles play/pause
    if (isCurrentlyPlaying) {
      pauseVideo();
    } else {
      playVideo(elementInfo.id);
    }
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
          onClick={handleClick}
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
              ref={videoRef}
              className="w-full h-full"
              style={{ objectFit: 'contain', pointerEvents: 'none' }}
              src={elementInfo.src}
              preload="metadata"
            />
          ) : (
            <div className="w-full h-full bg-black/10 rounded" />
          )}

          {/* Play/Pause indicator - only shown when playing */}
          {isPlaying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
              <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
