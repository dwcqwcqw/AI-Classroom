'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { listStages, getFirstSlideByStages, type StageListItem } from '@/lib/utils/stage-storage';
import { ThumbnailSlide } from '@/components/slide-renderer/components/ThumbnailSlide';
import type { Slide } from '@/lib/types/slides';
import { createLogger } from '@/lib/logger';

const log = createLogger('Courses');

function formatDate(ts: number) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(ts);
  } catch {
    return '';
  }
}

/** Preload a single image src in the background, fire-and-forget. */
function preloadImage(src: string): void {
  if (!src) return;
  const img = new Image();
  img.src = src;
}

/** Extract all image src strings from a slide's elements (recursive). */
function extractImageSrcs(slide: Slide): string[] {
  if (!slide?.elements) return [];
  const srcs: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (els: any[]) => {
    for (const el of els) {
      if (el.type === 'image' && typeof el.src === 'string' && el.src.startsWith('/api/')) {
        srcs.push(el.src);
      }
      if (Array.isArray(el.children)) collect(el.children);
    }
  };
  collect(slide.elements);
  return srcs;
}

function CourseCard({ stage, slide }: { stage: StageListItem; slide?: Slide }) {
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumbWidth, setThumbWidth] = useState(0);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setThumbWidth(Math.round(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Intersection Observer: only load image when card scrolls into viewport (+200px head start)
  useEffect(() => {
    const el = thumbRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true);
          if (slide) extractImageSrcs(slide).forEach(preloadImage);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [slide]);

  return (
    <Link
      href={`/classroom/${stage.id}`}
      className="block overflow-hidden rounded-2xl border border-border bg-background transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-400/60"
    >
      <div
        ref={thumbRef}
        className="relative w-full aspect-[16/9] overflow-hidden bg-slate-100 dark:bg-slate-900/80"
      >
        {slide && thumbWidth > 0 ? (
          <ThumbnailSlide
            slide={slide}
            size={thumbWidth}
            viewportSize={slide.viewportSize ?? 1000}
            viewportRatio={slide.viewportRatio ?? 0.5625}
            visible={isIntersecting}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            暂无课程预览图
          </div>
        )}
      </div>

      <div className="space-y-1 px-4 py-3">
        <p className="line-clamp-1 text-sm font-semibold sm:text-base">{stage.name}</p>
        <p className="text-xs text-muted-foreground">
          {stage.sceneCount} 页 · 最近更新：{formatDate(stage.updatedAt)}
        </p>
      </div>
    </Link>
  );
}

export default function CoursesPage() {
  const [stages, setStages] = useState<StageListItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, Slide>>({});

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const list = await listStages();
        if (!alive) return;
        setStages(list);

        const firstSlides = await getFirstSlideByStages(list.map((s) => s.id));
        if (!alive) return;
        setThumbnails(firstSlides);

        // Batch preload all images from thumbnails in the background
        const allSrcs = new Set<string>();
        for (const slide of Object.values(firstSlides)) {
          extractImageSrcs(slide).forEach((s) => allSrcs.add(s));
        }
        allSrcs.forEach(preloadImage);
        log.info(`[Courses] Batch preloading ${allSrcs.size} thumbnail images`);
      } catch {
        if (!alive) return;
        setStages([]);
        setThumbnails({});
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

  const hasData = useMemo(() => stages.length > 0, [stages.length]);

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-3 py-5 dark:bg-slate-950 sm:px-4 sm:py-6 md:px-6 md:py-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-3 sm:mb-6">
          <h1 className="text-xl font-bold md:text-3xl">全部课程</h1>
          <Link href="/" className="shrink-0 text-sm text-violet-600 hover:text-violet-500">
            返回首页
          </Link>
        </div>

        {!hasData ? (
          <div className="rounded-2xl border border-border bg-background p-6 text-center text-sm text-muted-foreground sm:p-8">
            暂无课程数据，先去创建一个课程吧。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {stages.map((stage) => (
              <CourseCard key={stage.id} stage={stage} slide={thumbnails[stage.id]} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
