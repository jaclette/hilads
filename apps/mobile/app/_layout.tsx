import '@/polyfills'; // must be first — polyfills WeakRef for Hermes + old arch
import * as Sentry from '@sentry/react-native';
import { useEffect } from 'react';
import { Linking } from 'react-native';
import { Stack } from 'expo-router';
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
  console.log('[layout] RootLayoutInner rendered');
  const { booting, bootError, joined, account, city, sessionId, identity } = useApp();

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
            <Stack.Screen name="e/[id]" options={{ headerShown: false }} />
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
            <Stack.Screen name="notifications" />
            <Stack.Screen
              name="debug"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
          </Stack>
          {/* LandingScreen overlays until user joins a city */}
          {!joined && <LandingScreen onRetryGeo={retryGeo} />}
        </>
      )}
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
