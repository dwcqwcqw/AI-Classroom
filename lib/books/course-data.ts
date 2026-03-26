import type { StageListItem } from '@/lib/utils/stage-storage';

export interface CourseCardData {
  id: string;
  name: string;
  updatedAt: number;
  sceneCount: number;
  clickable: boolean;
}

export function toRealCourseCards(stages: StageListItem[]): CourseCardData[] {
  return stages.map((s) => ({
    id: s.id,
    name: s.name,
    updatedAt: s.updatedAt,
    sceneCount: s.sceneCount,
    clickable: true,
  }));
}

export function makeMockCourseCards(prefix: string, count: number): CourseCardData[] {
  return Array.from({ length: count }).map((_, i) => ({
    id: `${prefix}-${i + 1}`,
    name: `${prefix}课程 ${i + 1}`,
    updatedAt: Date.now() - i * 86400000,
    sceneCount: 8 + (i % 6),
    clickable: false,
  }));
}
