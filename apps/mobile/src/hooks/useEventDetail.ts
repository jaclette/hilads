import { useState, useEffect, useCallback } from 'react';
import { fetchEventById, toggleEventParticipation } from '@/api/events';
import { useApp } from '@/context/AppContext';
import type { HiladsEvent } from '@/types';

interface Result {
  event:            HiladsEvent | null;
  cityName:         string | null;
  loading:          boolean;
  error:            string | null;
  toggling:         boolean;
  isOwner:          boolean;
  toggleParticipation: () => Promise<void>;
  reload:           () => void;
}

export function useEventDetail(eventId: string): Result {
  const { identity, account } = useApp();
  // Use guestId (persistent across restarts) not sessionId (ephemeral per boot).
  // Participation keyed by guestId survives app restarts correctly.
  const guestId  = identity?.guestId;
  const nickname = account?.display_name ?? identity?.nickname ?? '';

  const [event,    setEvent]    = useState<HiladsEvent | null>(null);
  const [cityName, setCityName] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Pass guestId so the backend embeds is_participating + participant_count
      // directly in the event object — no secondary fetch needed, no race condition.
      const res = await fetchEventById(eventId, guestId ?? undefined);
      setEvent(res?.event ?? null);
      setCityName(res?.cityName ?? null);
    } catch {
      setError('Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [eventId, guestId]);

  useEffect(() => { load(); }, [load]);

  const toggleParticipation = useCallback(async () => {
    if (!guestId || !event || toggling) return;
    setToggling(true);
    try {
      const { count, isIn } = await toggleEventParticipation(event.id, guestId, nickname);
      console.log('[event] toggle →', { isIn, count, eventId: event.id, guestId: guestId.slice(0, 8) });
      setEvent(prev => prev ? { ...prev, participant_count: count, is_participating: isIn } : prev);
    } catch (err) {
      console.error('[event] toggle failed:', err);
      // Re-fetch event to get true server state after a failure
      fetchEventById(event.id, guestId).then(res => {
        if (res?.event) setEvent(res.event);
      });
    } finally {
      setToggling(false);
    }
  }, [event, guestId, nickname, toggling]);

  const isOwner = Boolean(
    identity && event?.guest_id && event.guest_id === identity.guestId,
  );

  return { event, cityName, loading, error, toggling, isOwner, toggleParticipation, reload: load };
}
