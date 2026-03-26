'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { useSharedSettingsSync } from '@/lib/hooks/use-shared-settings-sync';

/**
 * Fetches server-configured providers on mount and merges into settings store.
 * Renders nothing — purely a side-effect component.
 */
export function ServerProvidersInit() {
  const fetchServerProviders = useSettingsStore((state) => state.fetchServerProviders);

  useSharedSettingsSync();

  useEffect(() => {
    fetchServerProviders();
  }, [fetchServerProviders]);

  return null;
}
