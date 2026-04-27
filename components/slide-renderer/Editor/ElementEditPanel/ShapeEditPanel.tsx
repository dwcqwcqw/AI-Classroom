'use client';

import { useState, useCallback } from 'react';
import type { PPTShapeElement } from '@/lib/types/slides';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface ShapeEditPanelProps {
  element: PPTShapeElement;
}

// Common colors
const COLOR_PRESETS = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00',
  '#ff00ff', '#00ffff', '#ff6600', '#9900ff', '#0099ff', '#ff0099',
  '#333333', '#666666', '#999999', '#cccccc',
];

// Line styles
const LINE_STYLES = [
  { label: '实线', value: 'solid' },
  { label: '虚线', value: 'dashed' },
  { label: '点线', value: 'dotted' },
];

export function ShapeEditPanel({ element }: ShapeEditPanelProps) {
  const { updateElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  const [fillColor, setFillColor] = useState(element.fill || '#ffffff');
  const [outlineColor, setOutlineColor] = useState(element.outline?.color || '#000000');
  const [outlineWidth, setOutlineWidth] = useState(element.outline?.width || 1);
  const [outlineStyle, setOutlineStyle] = useState<string>(element.outline?.style || 'solid');

  const handleFillColorChange = useCallback((color: string) => {
    setFillColor(color);
    updateElement({
      id: element.id,
      props: { fill: color },
    });
    addHistorySnapshot();
  }, [element.id, updateElement, addHistorySnapshot]);

  const handleOutlineColorChange = useCallback((color: string) => {
    setOutlineColor(color);
    updateElement({
      id: element.id,
      props: {
        outline: {
          ...element.outline,
          color,
          width: outlineWidth,
          style: outlineStyle as 'solid' | 'dashed' | 'dotted',
        },
      },
    });
    addHistorySnapshot();
  }, [element.id, element.outline, outlineWidth, outlineStyle, updateElement, addHistorySnapshot]);

  const handleOutlineWidthChange = useCallback((width: number) => {
    setOutlineWidth(width);
    updateElement({
      id: element.id,
      props: {
        outline: {
          ...element.outline,
          color: outlineColor,
          width,
          style: outlineStyle as 'solid' | 'dashed' | 'dotted',
        },
      },
    });
    addHistorySnapshot();
  }, [element.id, element.outline, outlineColor, outlineStyle, updateElement, addHistorySnapshot]);

  const handleOutlineStyleChange = useCallback((style: string) => {
    setOutlineStyle(style);
    updateElement({
      id: element.id,
      props: {
        outline: {
          ...element.outline,
          color: outlineColor,
          width: outlineWidth,
          style: style as 'solid' | 'dashed' | 'dotted',
        },
      },
    });
    addHistorySnapshot();
  }, [element.id, element.outline, outlineColor, outlineWidth, updateElement, addHistorySnapshot]);

  return (
    <div className="p-4 space-y-6">
      {/* Fill Color */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">填充颜色</Label>
        <div className="grid grid-cols-8 gap-1">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              onClick={() => handleFillColorChange(color)}
              className={cn(
                'w-7 h-7 rounded border-2 transition-all',
                fillColor === color
                  ? 'border-blue-500 scale-110'
                  : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="color"
            value={fillColor}
            onChange={(e) => handleFillColorChange(e.target.value)}
            className="w-10 h-9 p-1"
          />
          <Input
            type="text"
            value={fillColor}
            onChange={(e) => handleFillColorChange(e.target.value)}
            className="flex-1 h-9 text-xs"
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Line Style */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">线条样式</Label>
        <div className="flex gap-1">
          {LINE_STYLES.map((style) => (
            <Button
              key={style.value}
              variant={outlineStyle === style.value ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => handleOutlineStyleChange(style.value)}
            >
              {style.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Outline Color */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">线条颜色</Label>
        <div className="grid grid-cols-8 gap-1">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              onClick={() => handleOutlineColorChange(color)}
              className={cn(
                'w-7 h-7 rounded border-2 transition-all',
                outlineColor === color
                  ? 'border-blue-500 scale-110'
                  : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            type="color"
            value={outlineColor}
            onChange={(e) => handleOutlineColorChange(e.target.value)}
            className="w-10 h-9 p-1"
          />
          <Input
            type="text"
            value={outlineColor}
            onChange={(e) => handleOutlineColorChange(e.target.value)}
            className="flex-1 h-9 text-xs"
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Outline Width */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">线条宽度</Label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((width) => (
            <Button
              key={width}
              variant={outlineWidth === width ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => handleOutlineWidthChange(width)}
            >
              {width}px
            </Button>
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
          拖拽形状可直接调整位置和大小
        </p>
      </div>
    </div>
  );
}
