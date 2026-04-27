'use client';

import { useState, useCallback } from 'react';
import type { PPTChartElement } from '@/lib/types/slides';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Trash2 } from 'lucide-react';

interface ChartEditPanelProps {
  element: PPTChartElement;
}

// Chart types
const CHART_TYPES = [
  { label: '柱状图', value: 'bar' },
  { label: '折线图', value: 'line' },
  { label: '饼图', value: 'pie' },
  { label: '环形图', value: 'ring' },
  { label: '面积图', value: 'area' },
  { label: '雷达图', value: 'radar' },
  { label: '散点图', value: 'scatter' },
];

export function ChartEditPanel({ element }: ChartEditPanelProps) {
  const { updateElement, deleteElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();

  const handleDelete = useCallback(() => {
    deleteElement(element.id);
  }, [element.id, deleteElement]);

  const handleChartTypeChange = useCallback((chartType: string) => {
    updateElement({
      id: element.id,
      props: { chartType: chartType as PPTChartElement['chartType'] },
    });
    addHistorySnapshot();
  }, [element.id, updateElement, addHistorySnapshot]);

  return (
    <div className="p-4 space-y-6">
      {/* Chart Type */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">图表类型</Label>
        <div className="grid grid-cols-2 gap-2">
          {CHART_TYPES.map((type) => (
            <Button
              key={type.value}
              variant={element.chartType === type.value ? 'default' : 'outline'}
              size="sm"
              className="w-full"
              onClick={() => handleChartTypeChange(type.value)}
            >
              {type.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Data Info */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">数据</Label>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded text-xs space-y-1">
          <div className="font-medium text-gray-700 dark:text-gray-300">图例:</div>
          <div className="text-gray-500">{element.data.legends?.join(', ') || '暂无'}</div>
          <div className="font-medium text-gray-700 dark:text-gray-300 mt-2">数据标签:</div>
          <div className="text-gray-500">{element.data.labels?.join(', ') || '暂无'}</div>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          图表数据需通过AI对话修改
        </p>
      </div>

      {/* Theme Colors */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">主题色</Label>
        <div className="flex gap-1">
          {element.themeColors?.map((color, index) => (
            <div
              key={index}
              className="w-6 h-6 rounded border border-gray-200 dark:border-gray-700"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Delete button */}
      <Separator />
      <div className="space-y-2">
        <Button
          variant="destructive"
          size="sm"
          className="w-full gap-2"
          onClick={handleDelete}
        >
          <Trash2 className="w-4 h-4" />
          删除图表
        </Button>
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
          拖拽图表可直接调整位置和大小
        </p>
      </div>
    </div>
  );
}
