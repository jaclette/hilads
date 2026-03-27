import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { useAppBoot } from '@/hooks/useAppBoot';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { usePresenceHeartbeat } from '@/hooks/usePresenceHeartbeat';
import { usePresence } from '@/hooks/usePresence';
import { BootScreen } from '@/components/BootScreen';
import { LandingScreen } from '@/components/LandingScreen';
import { NotificationHandler } from '@/features/notifications/NotificationHandler';
import { track } from '@/services/analytics';
import { Colors } from '@/constants';

// Keep native splash visible while booting
SplashScreen.preventAutoHideAsync();

// ── Inner layout (has access to AppContext) ───────────────────────────────────

function RootLayoutInner() {
  const { booting, bootError, joined } = useApp();
  const { retry, retryGeo } = useAppBoot();
  useAppLifecycle();       // foreground/background WS resilience
  usePresenceHeartbeat();  // keep presence alive
  usePresence();           // sync online users list to AppContext

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
            <Stack.Screen
              name="sign-in"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen
              name="sign-up"
              options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
            />
            <Stack.Screen name="dm/[id]" />
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
