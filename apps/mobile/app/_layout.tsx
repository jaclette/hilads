import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { useAppBoot } from '@/hooks/useAppBoot';
import { useAppLifecycle } from '@/hooks/useAppLifecycle';
import { BootScreen } from '@/components/BootScreen';
import { NotificationHandler } from '@/features/notifications/NotificationHandler';
import { Colors } from '@/constants';

// Keep native splash visible while booting
SplashScreen.preventAutoHideAsync();

// ── Inner layout (has access to AppContext) ───────────────────────────────────

function RootLayoutInner() {
  const { booting, bootError } = useApp();
  useAppBoot();
  useAppLifecycle();   // foreground/background WS resilience

  useEffect(() => {
    if (!booting) SplashScreen.hideAsync();
  }, [booting]);

  // NotificationHandler is always mounted (even during boot) so cold-start
  // push taps are captured early; it defers navigation until booting=false.
  return (
    <>
      <NotificationHandler />

      {booting || bootError ? (
        <BootScreen error={bootError} />
      ) : (
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="city-chat" />
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
        </Stack>
      )}
    </>
  );
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="light" backgroundColor={Colors.bg} />
        <RootLayoutInner />
      </AppProvider>
    </SafeAreaProvider>
  );
}
