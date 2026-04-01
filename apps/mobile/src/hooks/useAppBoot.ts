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
import { getAuthToken } from '@/api/client';
import { getColdStartNotificationRoute } from '@/features/notifications/NotificationHandler';

// ── Timeouts ──────────────────────────────────────────────────────────────────

// Boot: max time to wait for fetchChannels() before starting geo anyway.
// If the API is unreachable, fetch() has no built-in timeout and the OS TCP
// timeout is ~75s — this ensures geo starts even when the server is down.
const BOOT_FETCH_TIMEOUT_MS = 8_000;

// watchPositionAsync: how long to wait for first GPS fix before falling back.
const GEO_WATCH_TIMEOUT_MS = 10_000;

// getCurrentPositionAsync last-resort fallback timeout.
const GEO_CURRENT_TIMEOUT_MS = 8_000;

// getLastKnownPositionAsync: accept cached positions up to 10 minutes old.
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

// requestForegroundPermissionsAsync: OS dialog can hang on some Android builds
// if the window is not yet focused. Race against this timeout.
const PERM_TIMEOUT_MS = 6_000;

// Absolute ceiling for the entire geo flow (services + permission + position + resolve).
// If we haven't exited by this point, force the error state so the user isn't stuck.
const GEO_ABSOLUTE_TIMEOUT_MS = 20_000;

// How long after setBooting(false) before starting geo.
// Gives React one frame to render and Android to make the window focusable.
const GEO_START_DELAY_MS = 400;

interface Result {
  retry:    () => void;
  retryGeo: () => void;
}

// ── Position helper ───────────────────────────────────────────────────────────
//
// Three-step strategy (each step is skipped if the previous one succeeds):
//   1. getLastKnownPositionAsync  — instant if the OS has a recent cache
//   2. watchPositionAsync         — Android requestLocationUpdates, fires fast
//   3. getCurrentPositionAsync    — last resort, explicit timeout to avoid hang

async function getPosition(): Promise<Location.LocationObject | null> {
  // ── Step 1: last known (instant) ──────────────────────────────────────────
  console.log('[geo] getLastKnownPositionAsync...');
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) {
      console.log('[geo] last known →', last.coords.latitude, last.coords.longitude,
        '(accuracy:', last.coords.accuracy, 'm, age:',
        Math.round((Date.now() - last.timestamp) / 1000), 's)');
      return last;
    }
    console.log('[geo] no last known position in cache');
  } catch (e) {
    console.warn('[geo] getLastKnownPositionAsync error:', String(e));
  }

  // ── Step 2: watchPositionAsync (primary fresh-position strategy) ──────────
  // Android requestLocationUpdates fires as soon as the OS has any fix.
  console.log('[geo] watchPositionAsync start (timeout:', GEO_WATCH_TIMEOUT_MS, 'ms)');
  const watched = await new Promise<Location.LocationObject | null>(resolve => {
    let sub: Location.LocationSubscription | null = null;
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sub?.remove();
        console.warn('[geo] watchPositionAsync timed out after', GEO_WATCH_TIMEOUT_MS, 'ms');
        resolve(null);
      }
    }, GEO_WATCH_TIMEOUT_MS);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 1 },
      loc => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          sub?.remove();
          console.log('[geo] watchPositionAsync fix:',
            loc.coords.latitude, loc.coords.longitude,
            '(accuracy:', loc.coords.accuracy, 'm)');
          resolve(loc);
        }
      },
    ).then(s => {
      if (resolved) {
        // Already resolved (timeout fired before sub was assigned) — clean up.
        s.remove();
      } else {
        sub = s;
      }
    }).catch(err => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        console.warn('[geo] watchPositionAsync setup error:', String(err));
        resolve(null);
      }
    });
  });

  if (watched) return watched;

  // ── Step 3: getCurrentPositionAsync (last resort) ─────────────────────────
  console.log('[geo] getCurrentPositionAsync fallback (timeout:', GEO_CURRENT_TIMEOUT_MS, 'ms)');
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('getCurrentPositionAsync timed out after ' + GEO_CURRENT_TIMEOUT_MS + 'ms')),
          GEO_CURRENT_TIMEOUT_MS),
      ),
    ]);
    console.log('[geo] getCurrentPositionAsync →',
      pos.coords.latitude, pos.coords.longitude, '(accuracy:', pos.coords.accuracy, 'm)');
    return pos;
  } catch (e) {
    console.warn('[geo] getCurrentPositionAsync failed:', String(e));
    return null;
  }
}

// ── useAppBoot ────────────────────────────────────────────────────────────────

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

  // ── Shared geo flow ────────────────────────────────────────────────────────
  //
  // Single function used by both the boot effect and the geo-retry effect.
  // `isCancelled` is a thunk so each call site provides its own cancellation flag.

  async function runGeoFlow(isCancelled: () => boolean): Promise<void> {
    if (isCancelled()) return;
    console.log('[geo] ── flow start ──────────────────────────────────────');

    const absoluteTimer = setTimeout(() => {
      if (!isCancelled()) {
        console.warn('[geo] absolute timeout (' + GEO_ABSOLUTE_TIMEOUT_MS + 'ms) — forcing error state');
        setGeoState('error');
      }
    }, GEO_ABSOLUTE_TIMEOUT_MS);

    try {
      // ── Step 0: Location services ────────────────────────────────────────
      // On Android, the user can grant app permission but have GPS disabled in
      // device Settings → Location. If services are off, watchPositionAsync will
      // hang silently until our watch timeout fires. Check upfront and fail fast.
      console.log('[geo] checking location services (hasServicesEnabledAsync)...');
      let servicesEnabled = true; // assume enabled if the check throws
      try {
        servicesEnabled = await Location.hasServicesEnabledAsync();
      } catch (e) {
        console.warn('[geo] hasServicesEnabledAsync threw (assuming enabled):', String(e));
      }
      console.log('[geo] location services enabled:', servicesEnabled);

      if (!servicesEnabled) {
        if (!isCancelled()) {
          console.warn('[geo] location services are OFF → error state (user must enable GPS)');
          setGeoState('error');
        }
        return;
      }

      // ── Step 1: Permission ───────────────────────────────────────────────
      console.log('[geo] requestForegroundPermissionsAsync (timeout:', PERM_TIMEOUT_MS, 'ms)...');
      const permResult = await Promise.race([
        Location.requestForegroundPermissionsAsync(),
        new Promise<{ status: string }>(resolve =>
          setTimeout(() => {
            console.warn('[geo] permission dialog timed out after', PERM_TIMEOUT_MS, 'ms');
            resolve({ status: 'timeout' });
          }, PERM_TIMEOUT_MS),
        ),
      ]);
      if (isCancelled()) return;

      const status = permResult.status;
      const canAskAgain = (permResult as { canAskAgain?: boolean }).canAskAgain;
      console.log('[geo] permission result: status=' + status
        + ' canAskAgain=' + String(canAskAgain ?? '?'));

      if (status !== 'granted') {
        if (!isCancelled()) {
          console.warn('[geo] permission not granted (' + status + ') → '
            + (status === 'timeout' ? 'error' : 'denied') + ' state');
          setGeoState(status === 'timeout' ? 'error' : 'denied');
        }
        return;
      }

      // ── Step 2: Position ─────────────────────────────────────────────────
      console.log('[geo] permission granted → fetching position...');
      setGeoState('resolving');

      let pos = await getPosition();
      if (isCancelled()) return;

      if (!pos) {
        if (__DEV__) {
          console.warn('[geo] ⚠️  DEV: no position — injecting Ho Chi Minh City (10.7769, 106.7009)');
          pos = {
            coords: { latitude: 10.7769, longitude: 106.7009, altitude: null, accuracy: 0,
                      altitudeAccuracy: null, heading: null, speed: null },
            timestamp: Date.now(),
          } as Location.LocationObject;
        } else {
          console.warn('[geo] no position obtained → error state');
          if (!isCancelled()) setGeoState('error');
          return;
        }
      }

      // ── Step 3: City resolution ──────────────────────────────────────────
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      console.log('[geo] position:', lat, lng, '(accuracy:', accuracy, 'm)');
      console.log('[geo] calling /location/resolve for', lat, lng, '...');

      const city = await resolveLocation(lat, lng)
        .then(c => {
          console.log('[geo] resolveLocation → city:', c.name,
            'channelId:', c.channelId, 'country:', c.country);
          return c;
        })
        .catch(err => {
          console.warn('[geo] resolveLocation failed:', String(err));
          return null;
        });

      if (isCancelled()) return;
      setDetectedCity(city);
      const nextState = city ? 'resolved' : 'error';
      setGeoState(nextState);
      console.log('[geo] ── flow complete → geoState:', nextState, '─────────');
    } catch (err) {
      if (!isCancelled()) {
        console.warn('[geo] unexpected error in geo flow:', String(err));
        setGeoState('error');
      }
    } finally {
      clearTimeout(absoluteTimer);
    }
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

        // Phase 3: Auth check — runs in background.
        // NOTE: setBooting(false) is intentionally NOT called here for returning users.
        // For returning users we hold the boot screen until the saved city is confirmed,
        // so the Stack never mounts into the wrong tab. For new users it fires below.
        const authPromise = loadSavedToken()
          .then(hadToken => {
            console.log('[boot] loadSavedToken — token found in SecureStore:', hadToken);
            console.log('[boot] authToken in memory after load:',
              getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO');
            // Skip authMe() entirely for guests — no token means no registered session.
            // Avoids a guaranteed 401 round-trip on every cold start for guest users.
            return hadToken ? authMe() : null;
          })
          .then(user => {
            console.log('[boot] authMe result:', user ? `user=${user.id}` : 'null (not authenticated)');
            if (!cancelled && user) {
              setAccount(user);  // usePushRegistration in _layout.tsx reacts to this
              fetchUnreadCount()
                .then(count => { if (!cancelled) setUnreadNotifications(count); })
                .catch(() => {});
              console.log('[boot] account set — push registration will fire via usePushRegistration');
              console.log('[boot] authToken present:', getAuthToken() !== null ? 'yes' : 'NO');
            } else if (!cancelled) {
              console.log('[boot] no authenticated user — push registration will wait for login');
            }
            return user ?? null;
          })
          .catch(err => {
            console.warn('[boot] auth check failed:', String(err));
            return null;
          });

        // Phase 4: City resolution
        // Defer geo start so React has rendered LandingScreen and Android has
        // made the window interactive before we request location permission.
        const startGeo = () => setTimeout(() => {
          if (!cancelled) runGeoFlow(() => cancelled);
        }, GEO_START_DELAY_MS);

        if (identity.channelId) {
          // Returning user: hold the boot screen (BootScreen stays visible, Stack does NOT
          // mount) until we confirm the saved city. Once confirmed, setJoined(true) and
          // setBooting(false) are called together — React 18 batches them into a single
          // render. When the Stack first mounts, index.tsx sees joined=true and redirects
          // directly to /(tabs)/chat. No intermediate hot-tab flash, no router.replace jump.
          console.log('[boot] returning user, fetching channels (timeout:', BOOT_FETCH_TIMEOUT_MS, 'ms)');
          Promise.race([
            Promise.all([authPromise, fetchChannels()]),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('boot: channel fetch timeout')), BOOT_FETCH_TIMEOUT_MS),
            ),
          ])
            .then(async ([user, channels]) => {
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
                  socket.joinCity(saved.channelId, sessionId, displayName, userId, identity.guestId),
                );
                if (socket.isConnected) {
                  socket.joinCity(saved.channelId, sessionId, displayName, userId, identity.guestId);
                }
                setJoined(true);

                // Check for a cold-start notification deep link.
                const notifRoute = await getColdStartNotificationRoute();

                // Release the boot screen now — joined=true is already set so the Stack
                // mounts directly on chat (via index.tsx redirect). No router.replace needed.
                setBooting(false);

                if (notifRoute) {
                  console.log('[push-nav] notification deep link at boot:', notifRoute);
                  setTimeout(() => {
                    console.log('[push-nav] navigating to:', notifRoute);
                    router.push(notifRoute as Parameters<typeof router.push>[0]);
                  }, 300);
                }
              } else {
                console.log('[boot] saved city not found → releasing UI + starting geo');
                setBooting(false);
                startGeo();
              }
            })
            .catch(() => {
              if (!cancelled) {
                console.log('[boot] fetchChannels failed → releasing UI + starting geo');
                setBooting(false);
                startGeo();
              }
            });
        } else {
          // New user: release UI immediately → LandingScreen shows + geo starts
          console.log('[boot] new user → releasing UI + starting geo');
          setBooting(false);
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

    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryCount]);

  // ── Geo-only retry effect ───────────────────────────────────────────────────

  useEffect(() => {
    if (geoRetryCount === 0) return;
    let cancelled = false;
    console.log('[geo] retry triggered (attempt', geoRetryCount, ')');
    runGeoFlow(() => cancelled);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoRetryCount]);

  return { retry, retryGeo };
}
