import { promises as fs } from 'fs';
import path from 'path';
import { saveSharedStage } from '@/lib/server/shared-data';
import type { PersistedClassroomData } from '@/lib/server/classroom-storage';

const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');

export interface MigrationResult {
  scanned: number;
  migrated: number;
  skipped: number;
  failed: number;
}

export async function migrateLegacyClassroomsToShared(): Promise<MigrationResult> {
  const result: MigrationResult = {
    scanned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
  };

  let files: string[] = [];
  try {
    files = await fs.readdir(CLASSROOMS_DIR);
  } catch {
    // No legacy directory in this runtime/environment
    return result;
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  for (const file of jsonFiles) {
    result.scanned += 1;
    const filePath = path.join(CLASSROOMS_DIR, file);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as PersistedClassroomData;

      if (!parsed?.id || !parsed?.stage || !Array.isArray(parsed?.scenes)) {
        result.skipped += 1;
        continue;
      }

      await saveSharedStage(parsed.id, {
        stage: parsed.stage,
        scenes: parsed.scenes,
        chats: [],
        currentSceneId: parsed.scenes[0]?.id || null,
      });

      result.migrated += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
