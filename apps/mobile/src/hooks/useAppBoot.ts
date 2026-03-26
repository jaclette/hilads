import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { loadOrCreateIdentity, generateSessionId } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { resolveLocation, joinChannel } from '@/api/channels';
import { authMe } from '@/api/auth';
import { loadSavedToken } from '@/services/session';
import { fetchUnreadCount } from '@/api/notifications';

interface Result {
  retry: () => void;
}

export function useAppBoot(): Result {
  const {
    setIdentity, setSessionId, setAccount,
    setCity, setBooting, setBootError, setWsConnected, setUnreadDMs,
  } = useApp();

  const [retryCount, setRetryCount] = useState(0);

  function retry() {
    setBootError(null);
    setBooting(true);
    setRetryCount(c => c + 1);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // 1. Identity + session
        const identity  = await loadOrCreateIdentity();
        const sessionId = generateSessionId();
        if (cancelled) return;
        setIdentity(identity);
        setSessionId(sessionId);

        // 2. Restore saved auth token, then check session
        await loadSavedToken();
        authMe().then(user => {
          if (!cancelled && user) {
            setAccount(user);
            // Fetch unread DM count for registered users
            fetchUnreadCount().then(count => {
              if (!cancelled) setUnreadDMs(count);
            }).catch(() => {});
          }
        });

        // 3. Location — failure here must not block boot
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        let city = null;
        if (status === 'granted') {
          try {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            if (!cancelled) {
              city = await resolveLocation(pos.coords.latitude, pos.coords.longitude)
                .catch(() => null);
            }
          } catch {
            // Location timeout or hardware error — continue without city
          }
        }

        if (cancelled) return;
        if (city) {
          setCity(city);
          joinChannel(city.channelId, sessionId, identity.guestId, identity.nickname)
            .catch(() => {});
        }

        // 4. WebSocket
        const offConnected    = socket.on('connected',    () => setWsConnected(true));
        const offDisconnected = socket.on('disconnected', () => setWsConnected(false));

        socket.on('connected', () => {
          if (city) socket.joinCity(city.channelId, sessionId, identity.nickname);
        });

        socket.connect();
        setBooting(false);

        return () => { offConnected(); offDisconnected(); };
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : 'Failed to start');
          setBooting(false);
        }
      }
    }

    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  return { retry };
}
