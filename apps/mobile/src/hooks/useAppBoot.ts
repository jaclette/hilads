import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { loadOrCreateIdentity, generateSessionId } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { resolveLocation, joinChannel, fetchChannels } from '@/api/channels';
import { authMe } from '@/api/auth';
import { loadSavedToken } from '@/services/session';
import { fetchUnreadCount } from '@/api/notifications';
import { requestAndRegisterPush } from '@/services/push';

// Timeout for the watchPositionAsync step before falling back / erroring.
const GEO_TIMEOUT_MS = 15_000;

// Accept cached positions up to 10 minutes old for the fast path.
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

// Maximum time we wait for requestForegroundPermissionsAsync before giving up.
// On some Android devices the OS dialog can hang if the window is not yet focused.
const PERM_TIMEOUT_MS = 8_000;

// Absolute ceiling for the entire geo flow (permission + position).
// If we haven't resolved city by this point, show the fallback UI.
const GEO_ABSOLUTE_TIMEOUT_MS = 30_000;

// How long after setBooting(false) before we call requestForegroundPermissionsAsync.
// Gives React one frame to render and Android to make the window focusable.
const GEO_START_DELAY_MS = 350;

interface Result {
  retry:    () => void;
  retryGeo: () => void;
}

// ── Geo position helper ───────────────────────────────────────────────────────
//
// Strategy:
//   1. getLastKnownPositionAsync — instant if cached
//   2. watchPositionAsync (primary) — Android requestLocationUpdates, fires fast
//   3. getCurrentPositionAsync (fallback) — last resort
//
// watchPositionAsync is the reliable Android approach:
// requestLocationUpdates fires as soon as the OS has any fix, including
// injected emulator coordinates. getCurrentPositionAsync (requestSingleUpdate)
// is slower and more likely to stall at startup.

async function getPosition(): Promise<Location.LocationObject | null> {
  // Step 1: last known position (instant if available)
  console.log('[geo] trying last known position');
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) {
      console.log('[geo] last known position:', last.coords.latitude, last.coords.longitude,
        '(accuracy:', last.coords.accuracy, 'm)');
      return last;
    }
    console.log('[geo] no last known position');
  } catch (e) {
    console.log('[geo] getLastKnownPositionAsync error:', e);
  }

  // Step 2: watchPositionAsync — primary fresh-position strategy
  console.log('[geo] starting watchPositionAsync (Accuracy.Balanced, timeout', GEO_TIMEOUT_MS, 'ms)');
  const watched = await new Promise<Location.LocationObject | null>(resolve => {
    let sub: Location.LocationSubscription | null = null;

    const timer = setTimeout(() => {
      sub?.remove();
      console.log('[geo] watchPositionAsync timed out after', GEO_TIMEOUT_MS, 'ms');
      resolve(null);
    }, GEO_TIMEOUT_MS);

    Location.watchPositionAsync(
      {
        accuracy:         Location.Accuracy.Balanced,
        timeInterval:     1000,
        distanceInterval: 1,
      },
      loc => {
        clearTimeout(timer);
        sub?.remove();
        console.log('[geo] watchPositionAsync received fix:',
          loc.coords.latitude, loc.coords.longitude,
          '(accuracy:', loc.coords.accuracy, 'm)');
        resolve(loc);
      },
    ).then(s => { sub = s; }).catch(err => {
      clearTimeout(timer);
      console.log('[geo] watchPositionAsync setup error:', err);
      resolve(null);
    });
  });

  if (watched) return watched;

  // Step 3: getCurrentPositionAsync — last-resort fallback, with explicit timeout.
  // Without a timeout this call hangs forever on emulators with no location source,
  // which prevents getPosition() from ever returning null and blocks the dev fallback.
  const GET_CURRENT_TIMEOUT_MS = 10_000;
  console.log('[geo] fallback: getCurrentPositionAsync (Accuracy.Balanced, timeout', GET_CURRENT_TIMEOUT_MS, 'ms)');
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getCurrentPositionAsync timeout')), GET_CURRENT_TIMEOUT_MS),
      ),
    ]);
    console.log('[geo] getCurrentPositionAsync success:', pos.coords.latitude, pos.coords.longitude,
      '(accuracy:', pos.coords.accuracy, 'm)');
    return pos;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[geo] getCurrentPositionAsync failed:', msg);
    return null;
  }
}

export function useAppBoot(): Result {
  const {
    setIdentity, setSessionId, setAccount,
    setCity, setBooting, setBootError, setWsConnected, setUnreadDMs,
    setUnreadNotifications, setGeoState, setDetectedCity, setJoined,
  } = useApp();

  const [retryCount,    setRetryCount]    = useState(0);
  const [geoRetryCount, setGeoRetryCount] = useState(0);

  function retry() {
    setBootError(null);
    setBooting(true);
    setRetryCount(c => c + 1);
  }

  function retryGeo() {
    setGeoState('pending');
    setDetectedCity(null);
    setGeoRetryCount(c => c + 1);
  }

  // ── Main boot effect ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // Phase 1: Identity + session (~10ms, AsyncStorage reads)
        console.log('[boot] phase 1: identity');
        const identity  = await loadOrCreateIdentity();
        const sessionId = generateSessionId();
        if (cancelled) return;
        setIdentity(identity);
        setSessionId(sessionId);

        // Phase 2: WebSocket
        console.log('[boot] phase 2: ws connect');
        const offConnected    = socket.on('connected',    () => setWsConnected(true));
        const offDisconnected = socket.on('disconnected', () => setWsConnected(false));
        socket.connect();

        // Phase 3: Release UI immediately — everything else runs in background
        console.log('[boot] phase 3: boot complete, releasing UI');
        setBooting(false);

        // Phase 4: Auth check — resolves with user (or null) so Phase 5 can use the correct nickname
        const authPromise = loadSavedToken()
          .then(() => authMe())
          .then(user => {
            if (!cancelled && user) {
              setAccount(user);
              fetchUnreadCount()
                .then(count => { if (!cancelled) setUnreadNotifications(count); })
                .catch(() => {});
              // Register device for native push — non-blocking, non-fatal
              requestAndRegisterPush().catch(() => {});
            }
            return user ?? null;
          })
          .catch(() => null);

        // Phase 5: City resolution — waits for auth so we use the correct display name
        // (authenticated display_name takes priority over guest nickname everywhere)
        // Defer geo start so React has rendered the LandingScreen and Android has
        // made the window interactive before we request location permission.
        const startGeo = () => setTimeout(() => { if (!cancelled) resolveGeo(); }, GEO_START_DELAY_MS);

        if (identity.channelId) {
          console.log('[boot] returning user, fetching channels');
          Promise.all([authPromise, fetchChannels()])
            .then(([user, channels]) => {
              if (cancelled) return;
              const displayName = user?.display_name ?? identity.nickname;
              const saved = channels.find(c => c.channelId === identity.channelId);
              if (saved) {
                console.log('[boot] auto-rejoining', saved.name);
                setCity(saved);
                joinChannel(saved.channelId, sessionId, identity.guestId, displayName)
                  .catch(() => {});
                const userId = user?.id;
                socket.on('connected', () =>
                  socket.joinCity(saved.channelId, sessionId, displayName, userId),
                );
                if (socket.isConnected) {
                  socket.joinCity(saved.channelId, sessionId, displayName, userId);
                }
                setJoined(true);
                // Restore directly into the city channel — mirrors web auto-rejoin behaviour.
                // LandingScreen is about to unmount; navigate before it does so the
                // tabs land on chat instead of the default hot tab.
                router.replace('/(tabs)/chat');
              } else {
                console.log('[boot] saved city not found, starting geo');
                startGeo();
              }
            })
            .catch(() => {
              if (!cancelled) {
                console.log('[boot] fetchChannels failed, starting geo');
                startGeo();
              }
            });
        } else {
          console.log('[boot] new user, starting geo');
          startGeo();
        }

        return () => { offConnected(); offDisconnected(); };
      } catch (err) {
        if (!cancelled) {
          console.error('[boot] fatal:', err);
          setBootError(err instanceof Error ? err.message : 'Failed to start');
          setBooting(false);
        }
      }
    }

    async function resolveGeo() {
      if (cancelled) return;
      console.log('[geo] resolveGeo start');

      // Absolute ceiling — if the entire flow takes longer than this, show fallback.
      // Covers hung permission dialogs and slow GPS on real Android devices.
      const absoluteTimer = setTimeout(() => {
        if (!cancelled) {
          console.warn('[geo] absolute timeout reached — falling to error state');
          setGeoState('error');
        }
      }, GEO_ABSOLUTE_TIMEOUT_MS);

      try {
        // ── Step 1: Permission ─────────────────────────────────────────────────
        // Race the OS dialog against a timeout. On some Android builds, the dialog
        // can hang if requestForegroundPermissionsAsync is called before the window
        // is interactive. If it times out we treat it as 'denied' so the user
        // gets the fallback UI instead of an infinite spinner.
        console.log('[geo] requesting foreground location permission...');
        const permResult = await Promise.race([
          Location.requestForegroundPermissionsAsync(),
          new Promise<{ status: string }>(resolve =>
            setTimeout(() => {
              console.warn('[geo] permission request timed out after', PERM_TIMEOUT_MS, 'ms');
              resolve({ status: 'timeout' });
            }, PERM_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;

        const status = permResult.status;
        console.log('[geo] permission status =', status);

        if (status !== 'granted') {
          setGeoState(status === 'timeout' ? 'error' : 'denied');
          return;
        }

        // ── Step 2: Position ───────────────────────────────────────────────────
        setGeoState('resolving');

        let pos = await getPosition();
        if (cancelled) return;
        console.log('[geo] getPosition() returned:', pos ? `${pos.coords.latitude}, ${pos.coords.longitude}` : 'null');

        if (!pos) {
          if (__DEV__) {
            // DEV fallback: no emulator location — inject fixed coords to test city flow.
            console.warn('[geo] ⚠️  DEV FALLBACK: injecting Ho Chi Minh City (10.7769, 106.7009)');
            pos = {
              coords: { latitude: 10.7769, longitude: 106.7009, altitude: null, accuracy: 0,
                        altitudeAccuracy: null, heading: null, speed: null },
              timestamp: Date.now(),
            } as Location.LocationObject;
          } else {
            console.log('[geo] no position obtained → error state');
            setGeoState('error');
            return;
          }
        }

        // ── Step 3: City resolution ────────────────────────────────────────────
        console.log('[geo] resolving city for coords', pos.coords.latitude, pos.coords.longitude);
        const city = await resolveLocation(pos.coords.latitude, pos.coords.longitude)
          .catch(err => { console.warn('[geo] resolveLocation failed:', err); return null; });

        if (cancelled) return;
        console.log('[geo] city resolved:', city?.name ?? 'null', 'channelId:', city?.channelId ?? 'null');
        setDetectedCity(city);
        setGeoState(city ? 'resolved' : 'error');
      } catch (err) {
        if (!cancelled) {
          console.warn('[geo] unexpected error in resolveGeo:', err);
          setGeoState('error');
        }
      } finally {
        clearTimeout(absoluteTimer);
      }
    }

    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // ── Geo-only retry effect ───────────────────────────────────────────────────
  // Triggered independently by retryGeo() — re-runs geo without re-booting.

  useEffect(() => {
    if (geoRetryCount === 0) return;  // skip initial mount
    let cancelled = false;

    async function rerunGeo() {
      if (cancelled) return;
      console.log('[geo] retrying (attempt', geoRetryCount, ')');

      const absoluteTimer = setTimeout(() => {
        if (!cancelled) {
          console.warn('[geo] retry absolute timeout — falling to error state');
          setGeoState('error');
        }
      }, GEO_ABSOLUTE_TIMEOUT_MS);

      try {
        const permResult = await Promise.race([
          Location.requestForegroundPermissionsAsync(),
          new Promise<{ status: string }>(resolve =>
            setTimeout(() => resolve({ status: 'timeout' }), PERM_TIMEOUT_MS),
          ),
        ]);
        if (cancelled) return;

        const status = permResult.status;
        console.log('[geo] retry permission status =', status);
        if (status !== 'granted') {
          setGeoState(status === 'timeout' ? 'error' : 'denied');
          return;
        }

        setGeoState('resolving');

        let pos = await getPosition();
        if (cancelled) return;
        console.log('[geo] retry getPosition():', pos ? `${pos.coords.latitude}, ${pos.coords.longitude}` : 'null');

        if (!pos) {
          if (__DEV__) {
            console.warn('[geo] ⚠️  DEV FALLBACK: injecting Ho Chi Minh City');
            pos = {
              coords: { latitude: 10.7769, longitude: 106.7009, altitude: null, accuracy: 0,
                        altitudeAccuracy: null, heading: null, speed: null },
              timestamp: Date.now(),
            } as Location.LocationObject;
          } else {
            setGeoState('error');
            return;
          }
        }

        console.log('[geo] retry resolving city for', pos.coords.latitude, pos.coords.longitude);
        const city = await resolveLocation(pos.coords.latitude, pos.coords.longitude)
          .catch(err => { console.warn('[geo] retry resolveLocation failed:', err); return null; });
        if (cancelled) return;
        console.log('[geo] retry resolved city:', city?.name ?? 'null');
        setDetectedCity(city);
        setGeoState(city ? 'resolved' : 'error');
      } catch (err) {
        if (!cancelled) {
          console.warn('[geo] retry unexpected error:', err);
          setGeoState('error');
        }
      } finally {
        clearTimeout(absoluteTimer);
      }
    }

    rerunGeo();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoRetryCount]);

  return { retry, retryGeo };
}
