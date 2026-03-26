/**
 * Keeps presence alive by sending a heartbeat every 30 seconds.
 * The server's presence TTL is 120s — 30s interval gives 4x safety margin.
 * Stops when the city or sessionId is unavailable.
 */
import { useEffect } from 'react';
import { socket } from '@/lib/socket';
import { useApp } from '@/context/AppContext';

const HEARTBEAT_MS = 30_000;

export function usePresenceHeartbeat(): void {
  const { city, sessionId } = useApp();

  useEffect(() => {
    if (!city || !sessionId) return;

    const id = setInterval(() => {
      if (socket.isConnected) {
        socket.heartbeat(city.channelId, sessionId);
      }
    }, HEARTBEAT_MS);

    return () => clearInterval(id);
  }, [city?.channelId, sessionId]);
}
