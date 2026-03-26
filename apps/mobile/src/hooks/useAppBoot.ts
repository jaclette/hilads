import { useEffect } from 'react';
import * as Location from 'expo-location';
import { useApp } from '@/context/AppContext';
import { loadOrCreateIdentity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { resolveLocation } from '@/api/channels';
import { authMe } from '@/api/auth';

// ── App boot sequence ─────────────────────────────────────────────────────────
// 1. Load or create guest identity
// 2. Check for logged-in account
// 3. Request location permission
// 4. Resolve current city via API
// 5. Connect WebSocket

export function useAppBoot(): void {
  const { setIdentity, setAccount, setCity, setBooting, setBootError, setWsConnected } = useApp();

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // 1. Identity
        const identity = await loadOrCreateIdentity();
        if (cancelled) return;
        setIdentity(identity);

        // 2. Check auth (non-blocking — guest flow works without account)
        authMe().then(user => {
          if (!cancelled && user) setAccount(user);
        });

        // 3. Location permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        let city = null;

        if (status === 'granted') {
          // 4. Get position and resolve city
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) {
            city = await resolveLocation(pos.coords.latitude, pos.coords.longitude)
              .catch(() => null);
          }
        }

        if (cancelled) return;
        if (city) setCity(city);

        // 5. WebSocket
        const offConnected    = socket.on('connected',    () => setWsConnected(true));
        const offDisconnected = socket.on('disconnected', () => setWsConnected(false));
        socket.connect();

        if (city && identity) {
          socket.on('connected', () => {
            socket.joinChannel(city.channelId, identity.guestId, identity.nickname);
          });
        }

        setBooting(false);

        return () => {
          offConnected();
          offDisconnected();
        };
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : 'Failed to start app');
          setBooting(false);
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
