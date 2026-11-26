import { useEffect } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';

/**
 * Old address of the campaign home (pushes, shared links, older builds): the campaign is now a tab,
 * so this only forwards to it (and to a section with ?section=). Navigating (not replacing) pops
 * back to the tabs already in the stack instead of stacking a second copy.
 */
export default function ContestRedirect() {
  const router = useRouter();
  const { colors } = useTheme();
  const { section } = useLocalSearchParams<{ section?: string }>();
  useEffect(() => {
    router.navigate({ pathname: '/(tabs)/trip', params: section ? { section } : {} } as never);
  }, [router, section]);
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
