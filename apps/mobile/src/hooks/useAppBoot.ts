import { useEffect } from 'react';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { loadOrCreateIdentity, generateSessionId } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { resolveLocation, joinChannel } from '@/api/channels';
import { authMe } from '@/api/auth';

export function useAppBoot(): void {
  const {
    setIdentity, setSessionId, setAccount,
    setCity, setBooting, setBootError, setWsConnected,
  } = useApp();

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

        // 2. Auth check — non-blocking
        authMe().then(user => { if (!cancelled && user) setAccount(user); });

        // 3. Location
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        let city = null;
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            city = await resolveLocation(pos.coords.latitude, pos.coords.longitude)
              .catch(() => null);
          }
        }

        if (cancelled) return;
        if (city) {
          setCity(city);
          // Register presence via REST (non-fatal)
          joinChannel(city.channelId, sessionId, identity.guestId, identity.nickname)
            .catch(() => {});
        }

        // 4. WebSocket
        const offConnected    = socket.on('connected',    () => setWsConnected(true));
        const offDisconnected = socket.on('disconnected', () => setWsConnected(false));

        // Re-join city room after every (re)connect
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
  }, []);
}
