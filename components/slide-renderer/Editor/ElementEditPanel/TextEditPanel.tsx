'use client';

import { useState, useCallback } from 'react';
import type { PPTTextElement } from '@/lib/types/slides';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface TextEditPanelProps {
  element: PPTTextElement;
}

// Common font list
const FONT_LIST = [
  'Microsoft YaHei',
  'SimSun',
  'SimHei',
  'KaiTi',
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Tahoma',
];

// Common font sizes
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];

// Common colors
const COLOR_PRESETS = [
  '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00',
  '#ff00ff', '#00ffff', '#ff6600', '#9900ff', '#0099ff', '#ff0099',
  '#333333', '#666666', '#999999', '#cccccc',
];

export function TextEditPanel({ element }: TextEditPanelProps) {
  const { updateElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  // Local state for editing
  const [fontName, setFontName] = useState(element.defaultFontName);
  const [fontSize, setFontSize] = useState(() => {
    const match = element.content.match(/font-size:\s*(\d+)/);
    return match ? parseInt(match[1]) : 16;
  });
  const [fontColor, setFontColor] = useState(element.defaultColor);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>(() => {
    if (element.content.includes('text-align:center')) return 'center';
    if (element.content.includes('text-align:right')) return 'right';
    return 'left';
  });

  const updateField = useCallback((field: string, value: string | number) => {
    updateElement({
      id: element.id,
      props: { [field]: value },
    });
  }, [element.id, updateElement]);

  const handleFontChange = (newFont: string) => {
    setFontName(newFont);
    updateField('defaultFontName', newFont);
    addHistorySnapshot();
  };

  const handleFontSizeChange = (newSize: number) => {
    setFontSize(newSize);
    // Update the content with new font size
    const sizeRegex = /font-size:\s*\d+px/g;
    let newContent = element.content;
    if (sizeRegex.test(newContent)) {
      newContent = newContent.replace(sizeRegex, `font-size:${newSize}px`);
    } else {
      // Add inline style if not present
      newContent = newContent.replace(
        /<p([^>]*)>/,
        `<p$1 style="font-size:${newSize}px">`,
      );
    }
    updateField('content', newContent);
    addHistorySnapshot();
  };

  const handleColorChange = (newColor: string) => {
    setFontColor(newColor);
    updateField('defaultColor', newColor);
    addHistorySnapshot();
  };

  const handleTextAlignChange = (align: 'left' | 'center' | 'right') => {
    setTextAlign(align);
    // Update alignment in content
    let newContent = element.content
      .replace(/text-align:\s*(left|center|right);?/g, '')
      .replace(/text-align:\s*(left|center|right)/g, '');
    
    newContent = newContent.replace(
      /<p([^>]*)>/,
      `<p$1 style="text-align:${align}">`,
    );
    updateField('content', newContent);
    addHistorySnapshot();
  };

  const handleBoldToggle = () => {
    let newContent = element.content;
    if (newContent.includes('<strong>') || newContent.includes('<b>')) {
      // Remove bold
      newContent = newContent
        .replace(/<strong>/g, '')
        .replace(/<\/strong>/g, '')
        .replace(/<b>/g, '')
        .replace(/<\/b>/g, '');
    } else {
      // Add bold - wrap selected text or entire content
      newContent = `<strong>${newContent}</strong>`;
    }
    updateField('content', newContent);
    addHistorySnapshot();
  };

  const handleItalicToggle = () => {
    let newContent = element.content;
    if (newContent.includes('<em>') || newContent.includes('<i>')) {
      newContent = newContent
        .replace(/<em>/g, '')
        .replace(/<\/em>/g, '')
        .replace(/<i>/g, '')
        .replace(/<\/i>/g, '');
    } else {
      newContent = `<em>${newContent}</em>`;
    }
    updateField('content', newContent);
    addHistorySnapshot();
  };

  const isBold = element.content.includes('<strong>') || element.content.includes('<b>');
  const isItalic = element.content.includes('<em>') || element.content.includes('<i>');

  return (
    <div className="p-4 space-y-6">
      {/* Font Family */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">字体</Label>
        <Select value={fontName} onValueChange={handleFontChange}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_LIST.map((font) => (
              <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Font Size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">字号</Label>
          <span className="text-xs text-gray-500">{fontSize}px</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {FONT_SIZES.map((size) => (
            <button
              key={size}
              onClick={() => handleFontSizeChange(size)}
              className={cn(
                'w-10 h-7 text-xs rounded border transition-colors',
                fontSize === size
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700',
              )}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Text Style */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">样式</Label>
        <div className="flex gap-2">
          <Button
            variant={isBold ? 'default' : 'outline'}
            size="sm"
            onClick={handleBoldToggle}
            className="flex-1 font-bold"
          >
            B
          </Button>
          <Button
            variant={isItalic ? 'default' : 'outline'}
            size="sm"
            onClick={handleItalicToggle}
            className="flex-1 italic"
          >
            I
          </Button>
        </div>
      </div>

      {/* Text Color */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">颜色</Label>
        <div className="grid grid-cols-8 gap-1">
          {COLOR_PRESETS.map((color) => (
            <button
              key={color}
              onClick={() => handleColorChange(color)}
              className={cn(
                'w-7 h-7 rounded border-2 transition-all',
                fontColor === color
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
            value={fontColor}
            onChange={(e) => handleColorChange(e.target.value)}
            className="w-10 h-9 p-1"
          />
          <Input
            type="text"
            value={fontColor}
            onChange={(e) => handleColorChange(e.target.value)}
            className="flex-1 h-9 text-xs"
            placeholder="#000000"
          />
        </div>
      </div>

      {/* Text Alignment */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">对齐</Label>
        <div className="flex gap-1">
          <Button
            variant={textAlign === 'left' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleTextAlignChange('left')}
            className="flex-1"
          >
            左对齐
          </Button>
          <Button
            variant={textAlign === 'center' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleTextAlignChange('center')}
            className="flex-1"
          >
            居中
          </Button>
          <Button
            variant={textAlign === 'right' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleTextAlignChange('right')}
            className="flex-1"
          >
            右对齐
          </Button>
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
      </div>
    </div>
  );
}
