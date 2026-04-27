'use client';

import { useState, useCallback, useRef } from 'react';
import type { PPTVideoElement } from '@/lib/types/slides';
import { useCanvasOperations } from '@/lib/hooks/use-canvas-operations';
import { useHistorySnapshot } from '@/lib/hooks/use-history-snapshot';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Upload, Play, Pause, Trash2 } from 'lucide-react';

interface VideoEditPanelProps {
  element: PPTVideoElement;
}

export function VideoEditPanel({ element }: VideoEditPanelProps) {
  const { updateElement, deleteElement } = useCanvasOperations();
  const { addHistorySnapshot } = useHistorySnapshot();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if it's a video
    if (!file.type.startsWith('video/')) {
      console.error('Please upload a video file');
      return;
    }

    // Read file as data URL
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      updateElement({
        id: element.id,
        props: { 
          src: dataUrl,
          // Generate poster from first frame (simplified - use video thumbnail)
        },
      });
      addHistorySnapshot();
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [element.id, updateElement, addHistorySnapshot]);

  const handleDelete = useCallback(() => {
    deleteElement(element.id);
  }, [element.id, deleteElement]);

  const handleToggleAutoplay = useCallback(() => {
    updateElement({
      id: element.id,
      props: { autoplay: !element.autoplay },
    });
    addHistorySnapshot();
  }, [element.id, element.autoplay, updateElement, addHistorySnapshot]);

  return (
    <div className="p-4 space-y-6">
      {/* Upload new video */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">视频</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
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
          上传新视频
        </Button>
      </div>

      {/* Current video info */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">当前视频</Label>
        <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs text-gray-500 truncate">
          {element.src ? '已加载视频' : '未设置视频'}
        </div>
      </div>

      {/* Video playback info */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-gray-600 dark:text-gray-400">播放设置</Label>
        <div className="text-xs text-gray-500 space-y-1">
          <p>点击视频可切换播放/暂停</p>
          <p>视频播放完毕后自动停止</p>
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
          删除视频
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
          拖拽视频可直接调整位置和大小
        </p>
      </div>
    </div>
  );
}
