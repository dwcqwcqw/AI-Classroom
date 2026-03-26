'use client';

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/lib/store/settings';

export function useSharedSettingsSync() {
  const loadSharedSettings = useSettingsStore((s) => s.loadSharedSettings);
  const saveSharedSettings = useSettingsStore((s) => s.saveSharedSettings);
  const hydratedRef = useRef(false);

  // Load shared settings once on app start
  useEffect(() => {
    loadSharedSettings().finally(() => {
      hydratedRef.current = true;
    });
  }, [loadSharedSettings]);

  // Save shared settings when local settings change (debounced)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsub = useSettingsStore.subscribe(() => {
      if (!hydratedRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void saveSharedSettings();
      }, 800);
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [saveSharedSettings]);
}
