import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useDailyToday } from '@/hooks/useDaily';
import { AppHeader } from '@/features/shell/AppHeader';
import { DailyPushBanner } from '@/features/daily/DailyPushBanner';
import { TodayTicket } from '@/features/today/TodayTicket';
import { TodayWeek } from '@/features/today/TodayWeek';
import { TodayProofs } from '@/features/today/TodayProofs';
import { TodayPodium } from '@/features/today/TodayPodium';
import { SpotsNear } from '@/features/today/SpotsNear';
import { StampCelebration } from '@/features/today/StampCelebration';
import { BrandLine } from '@/features/today/BrandLine';

/**
 * TODAY, the home (SPEC 9.3, today.html): the Daily Challenge ticket, the week
 * strip, today's proofs, yesterday's podium and Spots near you (or in the
 * chosen city). Never
 * empty: without local activity it still shows the challenge, World proofs and
 * the nearest spots anywhere.
 */
export default function TodayScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { city, account } = useApp();
  const daily = useDailyToday(city?.channelId);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshKey(k => k + 1);
    await daily.reload();
    setRefreshing(false);
  }, [daily]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}><AppHeader /></View>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <BrandLine today={daily.data} guest={!account} />
        <TodayTicket data={daily.data} loading={daily.loading} secondsLeft={daily.secondsLeft} />
        <DailyPushBanner />
        <TodayWeek today={daily.data} />
        <TodayProofs today={daily.data} refreshKey={refreshKey} />
        <TodayPodium today={daily.data} refreshKey={refreshKey} />
        <SpotsNear cityId={city?.channelId ?? null} refreshKey={refreshKey} />
      </ScrollView>
      <StampCelebration progress={daily.data?.localPass} userId={account?.id ?? null} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header:    { paddingHorizontal: Spacing.md, backgroundColor: c.bg },
  content:   { paddingHorizontal: Spacing.md, paddingTop: 4, paddingBottom: Spacing.xl, gap: 14 },
});
