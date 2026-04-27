'use client';

import { useState, useCallback, useRef } from 'react';
import type { PPTImageElement } from '@/lib/types/slides';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Upload, Trash2, RotateCcw } from 'lucide-react';

interface ImageEditPanelProps {
  element: PPTImageElement;
}

// Common colors for mask
const MASK_COLORS = [
  'transparent',
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#000000', '#ffffff', '#ff6600', '#9900ff', '#0099ff', '#ff0099',
];

export function ImageEditPanel({ element }: ImageEditPanelProps) {
  const { updateElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [colorMask, setColorMask] = useState(element.colorMask || 'transparent');

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's an image
    if (!file.type.startsWith('image/')) {
      console.error('Please upload an image file');
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      updateElement({
        id: element.id,
        props: { src: dataUrl },
      });
      addHistorySnapshot();
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [element.id, updateElement, addHistorySnapshot]);

  const handleColorMaskChange = useCallback((color: string) => {
    setColorMask(color);
    updateElement({
      id: element.id,
      props: { colorMask: color === 'transparent' ? undefined : color },
    });
    addHistorySnapshot();
  }, [element.id, updateElement, addHistorySnapshot]);

  const handleFlipH = useCallback(() => {
    updateElement({
      id: element.id,
      props: { flipH: !element.flipH },
    });
    addHistorySnapshot();
  }, [element.id, element.flipH, updateElement, addHistorySnapshot]);

  const handleFlipV = useCallback(() => {
    updateElement({
      id: element.id,
      props: { flipV: !element.flipV },
    });
    addHistorySnapshot();
  }, [element.id, element.flipV, updateElement, addHistorySnapshot]);

  return (
    <div className="p-4 space-y-6">
      {/* Upload new image */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">图片</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={handleUpload}
        >
          <Upload className="w-4 h-4" />
          上传新图片
        </Button>
      </div>

      {/* Current image info */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">当前图片</Label>
        <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs text-gray-500 truncate">
          {element.src ? '已加载图片' : '未设置图片'}
        </div>
      </div>

      {/* Flip controls */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">翻转</Label>
        <div className="flex gap-2">
          <Button
            variant={element.flipH ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={handleFlipH}
          >
            水平翻转
          </Button>
          <Button
            variant={element.flipV ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={handleFlipV}
          >
            垂直翻转
          </Button>
        </div>
      </div>

      {/* Color mask */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">颜色蒙版</Label>
        <div className="grid grid-cols-6 gap-1">
          {MASK_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => handleColorMaskChange(color)}
              className={cn(
                'w-8 h-8 rounded border-2 transition-all',
                colorMask === color
                  ? 'border-blue-500 scale-110'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500',
                color === 'transparent' && 'bg-[repeating-linear-gradient(45deg,#f0f0f0,#f0f0f0_2px,#fff_2px,#fff_4px)]',
              )}
              style={{ backgroundColor: color === 'transparent' ? undefined : color }}
            />
          ))}
        </div>
      </div>

      {/* Position Info */}
      <Separator />
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">位置与大小</Label>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
          <div>X: {Math.round(element.left)}px</div>
          <div>Y: {Math.round(element.top)}px</div>
          <div>宽: {Math.round(element.width)}px</div>
          <div>高: {Math.round(element.height)}px</div>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          拖拽图片可直接调整位置和大小
        </p>
      </div>
    </div>
  );
}
