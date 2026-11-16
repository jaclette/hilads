import { useEffect, useRef } from 'react';
import { useSegments } from 'expo-router';
import { trackScreen } from '@/services/analytics';

/**
 * One `$screen` per route change, named by the route pattern without groups:
 * "today", "ranks", "daily/[date]", "user/[id]" (ids never land in the name).
 * Mounted once in the root layout. Sheets and modals that are not routes are not counted.
 */
export function useScreenTracking(): void {
  const segments = useSegments() as string[];
  const name = segments.filter(s => !s.startsWith('(')).join('/') || 'index';
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (name === last.current) return;
    const from = last.current;
    last.current = name;
    trackScreen(name, { from_screen: from });
  }, [name]);
}
