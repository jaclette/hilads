import { useState, useEffect, useCallback } from 'react';
import { fetchMyEvents } from '@/api/events';
import { useApp } from '@/context/AppContext';
import type { HiladsEvent } from '@/types';

/** Deduplicate recurring event series — keep the latest (highest starts_at). */
function deduplicateSeries(events: HiladsEvent[]): HiladsEvent[] {
  const latestBySeries = new Map<string, HiladsEvent>();
  const singles: HiladsEvent[] = [];

  for (const e of events) {
    if (!e.series_id) {
      singles.push(e);
    } else {
      const existing = latestBySeries.get(e.series_id);
      if (!existing || e.starts_at > existing.starts_at) {
        latestBySeries.set(e.series_id, e);
      }
    }
  }

  return [...singles, ...latestBySeries.values()].sort(
    (a, b) => a.starts_at - b.starts_at,
  );
}

interface Result {
  events:  HiladsEvent[];
  loading: boolean;
  error:   string | null;
  reload:  () => void;
}

export function useMyEvents(): Result {
  const { identity, account } = useApp();
  const [events,  setEvents]  = useState<HiladsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const guestId = account?.guest_id ?? identity?.guestId ?? '';

  const load = useCallback(async () => {
    if (!guestId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchMyEvents(guestId);
      setEvents(deduplicateSeries(raw));
    } catch {
      setError('Failed to load your events');
    } finally {
      setLoading(false);
    }
  }, [guestId]);

  useEffect(() => { load(); }, [load]);

  return { events, loading, error, reload: load };
}
