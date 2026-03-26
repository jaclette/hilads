import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '@/context/AppContext';
import { useAppBoot } from '@/hooks/useAppBoot';
import { BootScreen } from '@/components/BootScreen';
import { Colors } from '@/constants';

// Keep native splash visible while booting
SplashScreen.preventAutoHideAsync();

// ── Inner layout (has access to AppContext) ───────────────────────────────────

function RootLayoutInner() {
  const { booting, bootError } = useApp();
  useAppBoot();

  useEffect(() => {
    if (!booting) {
      SplashScreen.hideAsync();
    }
  }, [booting]);

  if (booting || bootError) {
    return <BootScreen error={bootError} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
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
