'use client';

import { useEffect } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('LegacyClassroomMigration');

const MIGRATION_FLAG_KEY = 'legacy-classroom-migration-v1-done';

export function LegacyClassroomMigrationInit() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const alreadyDone = window.localStorage.getItem(MIGRATION_FLAG_KEY) === '1';
    if (alreadyDone) return;

    const run = async () => {
      try {
        const res = await fetch('/api/shared/migrate-classrooms', { method: 'POST' });
        if (res.ok) {
          window.localStorage.setItem(MIGRATION_FLAG_KEY, '1');
          const payload = (await res.json()) as {
            success?: boolean;
            result?: { scanned: number; migrated: number; skipped: number; failed: number };
          };
          log.info('Legacy classroom migration done:', payload.result);
        }
      } catch (e) {
        log.warn('Legacy classroom migration skipped/failed:', e);
      }
    };

    void run();
  }, []);

  return null;
}
