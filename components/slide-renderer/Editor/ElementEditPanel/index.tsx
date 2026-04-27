'use client';

import { useMemo } from 'react';
import { useCanvasStore } from '@/lib/store';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import type { SlideContent } from '@/lib/types/stage';
import type { PPTElement, PPTTextElement, PPTImageElement, PPTVideoElement, PPTShapeElement, PPTChartElement } from '@/lib/types/slides';
import { TextEditPanel } from './TextEditPanel';
import { ImageEditPanel } from './ImageEditPanel';
import { VideoEditPanel } from './VideoEditPanel';
import { ShapeEditPanel } from './ShapeEditPanel';
import { ChartEditPanel } from './ChartEditPanel';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ElementEditPanel() {
  const activeElementIdList = useCanvasStore.use.activeElementIdList();
  const handleElementId = useCanvasStore.use.handleElementId();
  const setActiveElementIdList = useCanvasStore.use.setActiveElementIdList();
  const { deleteElement } = useCanvasOperations();

  const currentSlide = useSceneSelector<SlideContent, { elements: PPTElement[] }>(
    (content) => content.canvas,
  );

  const selectedElement = useMemo(() => {
    if (activeElementIdList.length === 1) {
      return currentSlide.elements.find(el => el.id === activeElementIdList[0]);
    }
    return null;
  }, [activeElementIdList, currentSlide.elements]);

  const handleClose = () => {
    setActiveElementIdList([]);
  };

  const handleDelete = () => {
    deleteElement();
    setActiveElementIdList([]);
  };

  if (!selectedElement) {
    return null;
  }

  return (
    <div className="element-edit-panel absolute right-0 top-0 bottom-0 w-80 bg-white dark:bg-gray-900 shadow-lg border-l border-gray-200 dark:border-gray-700 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          编辑元素
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
            title="删除元素"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {selectedElement.type === 'text' && (
          <TextEditPanel element={selectedElement as PPTTextElement} />
        )}
        {selectedElement.type === 'image' && (
          <ImageEditPanel element={selectedElement as PPTImageElement} />
        )}
        {selectedElement.type === 'video' && (
          <VideoEditPanel element={selectedElement as PPTVideoElement} />
        )}
        {selectedElement.type === 'shape' && (
          <ShapeEditPanel element={selectedElement as PPTShapeElement} />
        )}
        {selectedElement.type === 'chart' && (
          <ChartEditPanel element={selectedElement as PPTChartElement} />
        )}
      </div>
    </div>
  );
}
