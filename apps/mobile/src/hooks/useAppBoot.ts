import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { useApp } from '@/context/AppContext';
import { loadOrCreateIdentity, generateSessionId, saveIdentity, loadDetectedCity } from '@/lib/identity';
import { socket } from '@/lib/socket';
import { bootstrapChannel, fetchChannels } from '@/api/channels';
import { fetchIpCity } from '@/api/geo';
import { authMe } from '@/api/auth';
import { fetchMyBlocks } from '@/api/blocks';
import { blockedSetFromApiRows } from '@/lib/blockFilter';
import { loadSavedToken } from '@/services/session';
import { applyStoredLocale } from '@/i18n';
import { getColdStartNotificationRoute } from '@/features/notifications/NotificationHandler';
import { track } from '@/services/analytics';
import type { GuestIdentity } from '@/types';

// Boot: max time to wait for fetchChannels() before giving up. If the API is
// unreachable, fetch() has no built-in timeout and the OS TCP timeout is ~75s.
const BOOT_FETCH_TIMEOUT_MS = 8_000;

interface Result {
  retry: () => void;
}

// ── useAppBoot ────────────────────────────────────────────────────────────────
//
// City selection no longer uses GPS. First launch resolves the city server-side
// from the device IP (fetchIpCity → hilads.live/api/geo, no permission prompt);
// on a confident match the guest is silently auto-joined, otherwise routed to the
// first-time city picker. Precise GPS is requested later, per-feature (see
// src/lib/geoFeature.ts). There is NO boot-time or foreground location prompt.

export function useAppBoot(): Result {
  const {
    setIdentity, setSessionId, setAccount,
    setCity, setBooting, setBootError, setWsConnected,
    setUnreadNotifications,
    setDetectedCity, setJustPlacedCity, setJoined, setBootstrapData,
    setBlockedSet,
  } = useApp();

  const [retryCount, setRetryCount] = useState(0);

  function retry() {
    setBootError(null);
    setBooting(true);
    setRetryCount(c => c + 1);
  }

  useEffect(() => {
    let cancelled = false;

    // First-launch city selection WITHOUT GPS. Holds the boot screen until the
    // IP lookup settles (≤500ms), then either silently auto-joins the matched
    // city (auto guest nickname) or routes to the first-time picker.
    async function runFirstLaunchDetection(identity: GuestIdentity, sessionId: string) {
      track('first_launch_ip_detection_started');
      const { city, failure } = await fetchIpCity();
      if (cancelled) return;

      if (city) {
        track('first_launch_ip_detection_resolved', { city: city.name });
        const nickname = identity.nickname; // auto-generated at boot; editable later in ME
        setCity(city);
        const updated = { ...identity, channelId: city.channelId };
        saveIdentity(updated).catch(() => {});
        setIdentity(updated);
        bootstrapChannel(city.channelId, sessionId, identity.guestId, nickname)
          .then(boot => {
            if (cancelled) return;
            setBootstrapData({
              channelId:           city.channelId,
              messages:            boot.messages,
              hasMore:             boot.hasMore,
              hasUnreadDMs:        boot.hasUnreadDMs,
              unreadNotifications: boot.unreadNotifications,
            });
            if (boot.unreadNotifications !== null) setUnreadNotifications(boot.unreadNotifications);
          })
          .catch(() => {});
        socket.joinCity(city.channelId, sessionId, nickname, undefined, identity.guestId);
        setJustPlacedCity(city); // one-shot "On t'a placé à {city}" banner
        track('first_launch_city_selected', { chosen_city: city.name, method: 'ip_auto' });
        setJoined(true);
        setBooting(false);
      } else {
        if (failure) track('first_launch_ip_detection_failed', { reason: failure });
        else track('first_launch_ip_detection_resolved', { city: 'unknown' });
        track('first_launch_city_picker_shown');
        setBooting(false);
        router.replace('/switch-city?firstTime=1');
      }
    }

    async function boot() {
      try {
        // Phase 1: Identity + session (~10ms, AsyncStorage reads)
        const [identity, cachedDetectedCity] = await Promise.all([
          loadOrCreateIdentity(),
          loadDetectedCity(),
          applyStoredLocale(),
        ]);
        const sessionId = generateSessionId();
        if (cancelled) return;
        setIdentity(identity);
        setSessionId(sessionId);
        // Restore last-known geo city (from a prior session) so "Back to my
        // location" is available without a boot prompt.
        if (cachedDetectedCity) setDetectedCity(cachedDetectedCity);

        // Phase 2: WebSocket
        const offConnected    = socket.on('connected',    () => setWsConnected(true));
        const offDisconnected = socket.on('disconnected', () => setWsConnected(false));
        socket.connect();

        // Phase 3: Auth check - background.
        const authPromise = loadSavedToken()
          .then(hadToken => (hadToken ? authMe() : null))
          .then(user => {
            if (!cancelled && user) {
              setAccount(user);
              socket.joinUser(user.id);
              fetchMyBlocks()
                .then(rows => { if (!cancelled) setBlockedSet(blockedSetFromApiRows(rows)); })
                .catch(err => console.warn('[boot] fetchMyBlocks failed (non-fatal):', String(err)));
            }
            return user ?? null;
          })
          .catch(err => {
            console.warn('[boot] auth check failed:', String(err));
            return null;
          });

        // Phase 4: City
        if (identity.channelId) {
          // Returning user (has already chosen a city): auto-rejoin it. No GPS,
          // no re-detection - their city choice is respected as-is.
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
                setCity(saved);
                bootstrapChannel(saved.channelId, sessionId, identity.guestId, displayName)
                  .then(boot => {
                    if (!cancelled) {
                      setBootstrapData({
                        channelId:           saved.channelId,
                        messages:            boot.messages,
                        hasMore:             boot.hasMore,
                        hasUnreadDMs:        boot.hasUnreadDMs,
                        unreadNotifications: boot.unreadNotifications,
                      });
                      if (boot.unreadNotifications !== null) setUnreadNotifications(boot.unreadNotifications);
                    }
                  })
                  .catch(() => {});
                socket.joinCity(saved.channelId, sessionId, displayName, user?.id, identity.guestId);
                setJoined(true);
                const notifRoute = await getColdStartNotificationRoute();
                setBooting(false);
                if (notifRoute) {
                  setTimeout(() => router.push(notifRoute as Parameters<typeof router.push>[0]), 300);
                }
              } else {
                // Their saved city no longer exists → let them re-pick (normal
                // picker; they're an existing user, not first-launch).
                console.log('[boot] saved city not found → city picker');
                setBooting(false);
                router.replace('/switch-city');
              }
            })
            .catch(() => {
              if (!cancelled) {
                console.log('[boot] returning-user channel fetch failed → city picker');
                setBooting(false);
                router.replace('/switch-city');
              }
            });
        } else {
          // New user (never chose a city - including the edge case of a prior
          // install that got stuck without one): IP-detect the city, no GPS.
          // Wait for the auth check first so a logged-in user isn't misrouted.
          authPromise.then(() => {
            if (!cancelled) runFirstLaunchDetection(identity, sessionId);
          });
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

  return { retry };
}
