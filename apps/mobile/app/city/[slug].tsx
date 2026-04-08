import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { fetchCityBySlug } from '@/api/channels';
import { useApp } from '@/context/AppContext';
import { socket } from '@/lib/socket';
import { Colors } from '@/constants';

/**
 * City deep link handler — https://hilads.live/city/{slug}
 *
 * Resolves the city from the URL slug, switches the app to that city,
 * then navigates to the chat tab.
 *
 * Works for both cold start (waits for boot to complete) and warm start
 * (switches city immediately when the app is already running).
 */
export default function CityDeepLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router   = useRouter();
  const { joined, sessionId, identity, account, setCity } = useApp();

  useEffect(() => {
    // Wait until the app has finished booting and joined a city.
    // For warm starts joined is already true; for cold starts this fires
    // once the boot process (geolocation + join) completes.
    if (!joined || !slug) return;

    fetchCityBySlug(slug as string)
      .then(city => {
        if (city) {
          setCity(city);
          // Re-join the WS room so presence and messages update immediately.
          if (sessionId) {
            const nickname = account?.display_name ?? identity?.nickname ?? '';
            socket.joinCity(
              city.channelId,
              sessionId,
              nickname,
              account?.id      ?? undefined,
              identity?.guestId ?? undefined,
            );
          }
        }
        router.replace('/(tabs)/chat');
      })
      .catch(() => {
        // Unknown slug — fall back to the chat tab (user's current city).
        router.replace('/(tabs)/chat');
      });
  }, [joined, slug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show a minimal loading indicator while resolving.
  // The BootScreen overlay covers this during cold start anyway.
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={Colors.accent} size="large" />
    </View>
  );
}
