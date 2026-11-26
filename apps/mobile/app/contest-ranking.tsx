import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';

/** Old address of the campaign ranking: forwards to the Trip tab's Ranking section. */
export default function ContestRankingRedirect() {
  const router = useRouter();
  const { colors } = useTheme();
  useEffect(() => {
    router.navigate({ pathname: '/(tabs)/trip', params: { section: 'ranking' } } as never);
  }, [router]);
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
