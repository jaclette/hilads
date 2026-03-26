import { useState, useEffect, useCallback } from 'react';
import { fetchEventById, toggleEventParticipation } from '@/api/events';
import { useApp } from '@/context/AppContext';
import type { HiladsEvent } from '@/types';

interface Result {
  event:            HiladsEvent | null;
  loading:          boolean;
  error:            string | null;
  toggling:         boolean;
  isOwner:          boolean;
  toggleParticipation: () => Promise<void>;
  reload:           () => void;
}

export function useEventDetail(eventId: string): Result {
  const { identity, sessionId } = useApp();

  const [event,    setEvent]    = useState<HiladsEvent | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchEventById(eventId);
      setEvent(res?.event ?? null);
    } catch {
      setError('Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const toggleParticipation = useCallback(async () => {
    if (!sessionId || !event || toggling) return;
    setToggling(true);
    try {
      const { count, isIn } = await toggleEventParticipation(event.id, sessionId);
      setEvent(prev => prev ? { ...prev, participant_count: count, is_participating: isIn } : prev);
    } catch {
      // silent — participation is non-critical
    } finally {
      setToggling(false);
    }
  }, [event, sessionId, toggling]);

  const isOwner = Boolean(
    identity && event?.guest_id && event.guest_id === identity.guestId,
  );

  return { event, loading, error, toggling, isOwner, toggleParticipation, reload: load };
}
