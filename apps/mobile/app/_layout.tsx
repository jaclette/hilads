import '@/polyfills'; // must be first — polyfills WeakRef for Hermes + old arch
import * as Sentry from '@sentry/react-native';
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { acceptEula } from '@/api/auth';
import { EulaPromptModal } from '@/features/auth/EulaPromptModal';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { useAppBoot } from '@/hooks/useAppBoot';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { usePresence } from '@/hooks/usePresence';
import { useGlobalNotifications } from '@/hooks/useGlobalNotifications';
import { useEventChatNotifications } from '@/hooks/useEventChatNotifications';
import { useGlobalDmNotifications } from '@/hooks/useGlobalDmNotifications';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { BootScreen } from '@/components/BootScreen';
import { LandingScreen } from '@/components/LandingScreen';
import { NotificationHandler } from '@/features/notifications/NotificationHandler';
import { track } from '@/services/analytics';
import { Colors } from '@/constants';

// ── Sentry — init before any render ──────────────────────────────────────────
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
  });
}

// Keep native splash visible while booting
SplashScreen.preventAutoHideAsync();

// ── Module-level proof — runs once on JS bundle evaluation ───────────────────
console.log('[layout] ── MODULE LOADED ───────────────────────────────────────');

// ── Inner layout (has access to AppContext) ───────────────────────────────────

function RootLayoutInner() {
  const app = useApp();
  const { booting, bootError, joined, account, city, sessionId, identity, setAccount } = app;
  // DIAG (shaking repro): the auth gate is confirmed stable (guest landing), so
  // the loop driver is some OTHER context value. Log the full relevant state
  // every render — whichever field flips between consecutive lines is the
  // culprit. Remove once identified.
  console.log('[layout] render |',
    'booting=' + booting,
    'joined=' + joined,
    'account=' + !!account,
    'city=' + (city?.channelId ?? null),
    'geo=' + app.geoState,
    'ws=' + app.wsConnected,
    'detected=' + (app.detectedCity?.channelId ?? null),
    'online=' + (app.onlineUsers?.length ?? 0),
    'unreadDM=' + app.unreadDMs,
    'unreadN=' + app.unreadNotifications,
  );
  const [eulaSubmitting, setEulaSubmitting] = useState(false);
  const [eulaError, setEulaError] = useState<string | null>(null);

  // Apple G1.2 — registered users created before the moderation update have
  // a NULL eula_accepted_at on their record. Show a blocking modal until they
  // accept. New signups stamp the column at signup time (auth/signup gate),
  // so they never see this modal.
  const showEulaModal = !!account && !account.eula_accepted_at;

  async function handleAcceptEula() {
    console.log('[eula] handleAcceptEula entered');
    setEulaError(null);          // clear any prior error on retry
    setEulaSubmitting(true);
    try {
      const { user } = await acceptEula();
      console.log('[eula] api ok — user.eula_accepted_at =', user?.eula_accepted_at ?? 'null');
      // Guard: if the API somehow returns a user without the timestamp, the
      // modal would silently stay up forever. Treat that as an error too.
      if (!user?.eula_accepted_at) {
        throw new Error('Acceptance did not register. Please try again.');
      }
      setAccount(user);          // eula_accepted_at now set → showEulaModal flips false → modal hides
    } catch (err) {
      // Surface the failure instead of leaving the user staring at a dead
      // button. The most common cause is a network/timeout on the POST; the
      // user can tap "I agree" again to retry.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[eula] api FAILED —', msg);
      setEulaError(
        msg.includes('Network') || msg.includes('timeout') || msg.includes('aborted')
          ? "Couldn't reach Hilads. Check your connection and tap I agree again."
          : "Something went wrong accepting the terms. Please tap I agree again.",
      );
    } finally {
      setEulaSubmitting(false);
    }
  }

  // ── Deep link URL logging ─────────────────────────────────────────────────
  useEffect(() => {
    // Cold-start: URL that opened the app (null if not a deep link launch)
    Linking.getInitialURL().then(url => {
      console.log('[deeplink] cold-start URL:', url ?? 'none');
    }).catch(err => {
      console.warn('[deeplink] getInitialURL error:', err);
    });

    // Foreground: URLs arriving while app is already running
    const sub = Linking.addEventListener('url', ({ url }) => {
      console.log('[deeplink] incoming URL:', url);
    });

    return () => sub.remove();
  }, []);
  const { retry, retryGeo } = useAppBoot();
  useAppLifecycle();          // foreground/background WS resilience
  usePresenceHeartbeat();     // keep presence alive
  usePresence();              // sync online users list to AppContext
  useGlobalNotifications();        // always-on notification badge updates
  useEventChatNotifications();     // always-on unread event chat badge + preview updates
  useGlobalDmNotifications();      // always-on unread DM badge + global conversation rooms
  usePushRegistration();           // register push token whenever an account is available

  // Re-assert WS presence when login/logout happens mid-session so the Here screen
  // immediately reflects the updated identity on all clients.
  useEffect(() => {
    if (!joined || !city || !sessionId) return;
    const nickname = account?.display_name ?? identity?.nickname ?? '';
    socket.joinCity(city.channelId, sessionId, nickname, account?.id ?? undefined, identity?.guestId ?? undefined);
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!booting) SplashScreen.hideAsync();
  }, [booting]);

  // Logged-in users with no city skip the guest landing entirely and go
  // straight to the city picker. (The landing overlay below is gated on
  // !account so it never covers /switch-city for them.) Guests keep seeing
  // the landing. Fires once when the state settles post-boot; deps don't
  // change while sitting on /switch-city, so there's no redirect loop.
  useEffect(() => {
    if (!booting && !joined && account && !city) {
      console.log('[layout] DIAG redirect → /switch-city (logged-in, no city)');
      router.replace('/switch-city');
    }
  }, [booting, joined, account, city]);

  useEffect(() => {
    if (!booting && !bootError && joined) track('app_open');
  }, [booting, joined]);

  // NotificationHandler always mounted so cold-start push taps are captured early.
  return (
    <>
      <NotificationHandler />

      {booting || bootError ? (
        <BootScreen error={bootError} onRetry={bootError ? retry : undefined} />
      ) : (
        <>
          {/* Stack is always mounted so sign-in/sign-up routing works from LandingScreen */}
          <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: Colors.bg } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="event/create" />
            <Stack.Screen name="event/[id]" />
            <Stack.Screen name="event/[id]/edit" />
            <Stack.Screen name="event/limit-reached" />
            <Stack.Screen name="e/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="t/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="city/[slug]" options={{ headerShown: false }} />
            <Stack.Screen
              name="sign-in"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="sign-up"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="forgot-password"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen name="dm/[id]" />
            <Stack.Screen name="messages" />
            <Stack.Screen name="notifications" />
            <Stack.Screen
              name="debug"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
          </Stack>
          {/* LandingScreen overlays until user joins a city — guests only.
              Logged-in users skip it (routed to /switch-city by the effect
              above) so they never see the "anonymous · instant access" UI. */}
          {!joined && !account && <LandingScreen onRetryGeo={retryGeo} />}
        </>
      )}

      {/* EULA re-prompt — blocks the app until existing users accept (Apple G1.2). */}
      <EulaPromptModal
        visible={showEulaModal}
        loading={eulaSubmitting}
        error={eulaError}
        onAccept={handleAcceptEula}
      />
    </>
  );
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  return (
    <SafeAreaProvider style={{ backgroundColor: Colors.bg }}>
      <AppProvider>
        <StatusBar style="light" backgroundColor={Colors.bg} />
        <RootLayoutInner />
      </AppProvider>
    </SafeAreaProvider>
  );
}
