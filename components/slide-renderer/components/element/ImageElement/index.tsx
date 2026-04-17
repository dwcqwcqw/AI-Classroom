'use client';

import type { PPTImageElement, ImageElementClip } from '@/lib/types/slides';
import type { ImageClipedEmitData } from '@/lib/types/edit';
import { useCanvasStore } from '@/lib/store';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { useElementShadow } from '../hooks/useElementShadow';
import { useElementFlip } from '../hooks/useElementFlip';
import { useClipImage } from './useClipImage';
import { useFilter } from './useFilter';
import { ImageOutline } from './ImageOutline';
import { ImageClipHandler } from './ImageClipHandler';
import { useMediaGenerationStore, isMediaPlaceholder } from '@/lib/store/media-generation';
import { useMediaStageId } from '@/lib/contexts/media-stage-context';
import { useSettingsStore } from '@/lib/store/settings';
import { retryMediaTask } from '@/lib/media/media-orchestrator';
import { ImageOff, RotateCcw, Paintbrush, ShieldAlert } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';

export interface ImageElementProps {
  elementInfo: PPTImageElement;
  selectElement?: (e: React.MouseEvent | React.TouchEvent, element: PPTImageElement) => void;
}

/**
 * Image element component with interaction support
 */
export function ImageElement({ elementInfo, selectElement }: ImageElementProps) {
  const { t } = useI18n();
  const clipingImageElementId = useCanvasStore.use.clipingImageElementId();
  const setClipingImageElementId = useCanvasStore.use.setClipingImageElementId();
  const { updateElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  const { shadowStyle } = useElementShadow(elementInfo.shadow);
  const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);
  const { clipShape, imgPosition } = useClipImage(elementInfo);
  const { filter } = useFilter(elementInfo.filters);

  // Media placeholder resolution (same as BaseImageElement)
  const stageId = useMediaStageId();
  const isPlaceholder = !!stageId && isMediaPlaceholder(elementInfo.src);
  const task = useMediaGenerationStore((s) => {
    if (!isPlaceholder) return undefined;
    const t = s.tasks[elementInfo.src];
    if (t && t.stageId !== stageId) return undefined;
    return t;
  });

  const imageGenerationEnabled = useSettingsStore((s) => s.imageGenerationEnabled);
  const resolvedSrc = task?.status === 'done' && task.objectUrl ? task.objectUrl : elementInfo.src;
  const showDisabled = isPlaceholder && !task && !imageGenerationEnabled;
  const showSkeleton =
    isPlaceholder &&
    !showDisabled &&
    (!task || task.status === 'pending' || task.status === 'generating');
  const showError = isPlaceholder && task?.status === 'failed';

  const isCliping = clipingImageElementId === elementInfo.id;

  const handleSelectElement = (e: React.MouseEvent | React.TouchEvent) => {
    if (elementInfo.lock) return;
    e.stopPropagation();
    selectElement?.(e, elementInfo);
  };

  const handleClip = (data: ImageClipedEmitData | null) => {
    setClipingImageElementId('');

    if (!data) return;

    const { range, position } = data;
    const originClip: ImageElementClip = elementInfo.clip || {
      shape: 'rect',
      range: [
        [0, 0],
        [100, 100],
      ],
    };

    const left = elementInfo.left + position.left;
    const top = elementInfo.top + position.top;
    const width = elementInfo.width + position.width;
    const height = elementInfo.height + position.height;

    let centerOffsetX = 0;
    let centerOffsetY = 0;

    if (elementInfo.rotate) {
      const centerX = left + width / 2 - (elementInfo.left + elementInfo.width / 2);
      const centerY = -(top + height / 2 - (elementInfo.top + elementInfo.height / 2));

      const radian = (-elementInfo.rotate * Math.PI) / 180;

      const rotatedCenterX = centerX * Math.cos(radian) - centerY * Math.sin(radian);
      const rotatedCenterY = centerX * Math.sin(radian) + centerY * Math.cos(radian);

      centerOffsetX = rotatedCenterX - centerX;
      centerOffsetY = -(rotatedCenterY - centerY);
    }

    const props = {
      clip: { ...originClip, range },
      left: left + centerOffsetX,
      top: top + centerOffsetY,
      width,
      height,
    };
    updateElement({ id: elementInfo.id, props });

    addHistorySnapshot();
  };

  return (
    <div
      className={`editable-element-image absolute ${elementInfo.lock ? 'lock' : ''}`}
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
        {isCliping ? (
          <ImageClipHandler
            src={elementInfo.src}
            clipData={elementInfo.clip}
            width={elementInfo.width}
            height={elementInfo.height}
            top={elementInfo.top}
            left={elementInfo.left}
            rotate={elementInfo.rotate}
            clipPath={clipShape.style}
            onClip={handleClip}
          />
        ) : (
          <div
            className={`element-content w-full h-full relative ${elementInfo.lock ? '' : 'cursor-move'}`}
            style={{
              filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
              transform: flipStyle,
            }}
            onMouseDown={handleSelectElement}
            onTouchStart={handleSelectElement}
          >
            <ImageOutline elementInfo={elementInfo} />

            <div
              className="image-content w-full h-full overflow-hidden relative"
              style={{ clipPath: clipShape.style }}
            >
              {showDisabled ? (
                <div className="w-full h-full bg-gray-50 dark:bg-gray-900/30 flex items-center justify-center">
                  <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    <ImageOff className="w-4 h-4 shrink-0" />
                    <span>{t('settings.mediaGenerationDisabled')}</span>
                  </div>
                </div>
              ) : showSkeleton ? (
                <div className="w-full h-full bg-gradient-to-br from-amber-50 via-orange-50/60 to-yellow-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-yellow-950/20 flex items-center justify-center">
                  <div className="relative w-12 h-12">
                    <div className="absolute inset-0 rounded-full border-2 border-amber-300/40 dark:border-amber-500/30 animate-pulse" />
                    <Paintbrush className="absolute inset-0 m-auto w-5 h-5 text-amber-400/80 dark:text-amber-500/70" strokeWidth={1.5} />
                  </div>
                </div>
              ) : showError ? (
                <div className="w-full h-full bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2">
                  {task?.errorCode === 'CONTENT_SENSITIVE' ? (
                    <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>{t('settings.mediaContentSensitive')}</span>
                    </div>
                  ) : task?.errorCode === 'GENERATION_DISABLED' ? (
                    <div className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                      <ImageOff className="w-4 h-4 shrink-0" />
                      <span>{t('settings.mediaGenerationDisabled')}</span>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        retryMediaTask(elementInfo.src);
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40 rounded hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t('settings.mediaRetry')}
                    </button>
                  )}
                </div>
              ) : resolvedSrc ? (
                <>
                  <img
                    src={resolvedSrc}
                    draggable={false}
                    style={{
                      position: 'absolute',
                      top: imgPosition.top,
                      left: imgPosition.left,
                      width: imgPosition.width,
                      height: imgPosition.height,
                      filter,
                    }}
                    alt=""
                    onDragStart={(e) => e.preventDefault()}
                  />
                  {elementInfo.colorMask && (
                    <div
                      className="color-mask absolute inset-0"
                      style={{
                        backgroundColor: elementInfo.colorMask,
                      }}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
