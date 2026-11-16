import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useDailyToday } from '@/hooks/useDaily';
import { AppHeader } from '@/features/shell/AppHeader';
import { TodayTicket } from '@/features/today/TodayTicket';
import { TodayWeek } from '@/features/today/TodayWeek';
import { TodayCountries } from '@/features/today/TodayCountries';
import { useTodayCountries } from '@/features/today/useTodayCountries';
import { StampCelebration } from '@/features/today/StampCelebration';
import { BrandLine } from '@/features/today/BrandLine';
import { WhileAwayCard } from '@/features/notifications/WhileAwayCard';
import { ResultsCard } from '@/features/ranks/ResultsCard';
import { SeasonalScope, SeasonalTeaser } from '@/features/event/SeasonalArt';

/**
 * TODAY, the home (SPEC 9.3; UX audit 2026-11: four blocks, one place per concept):
 * 1. since you were away (one card at a time), 2. the Daily Challenge hero,
 * 3. around the world today (one card per city, "See all"), 4. your week (streak,
 * tomorrow, every past challenge). Never empty: without photos block 3 shows
 * yesterday's best cities and my city's slot. Elsewhere now: the city race and the
 * Index (Ranks › Cities), proposing a challenge (Passport), yesterday's tour (from
 * block 3 on an empty day, and the archive).
 */
export default function TodayScreen() {
  // A seasonal event's live look (Halloween...) re-colors the whole tab.
  return <SeasonalScope><TodayContent /></SeasonalScope>;
}

function TodayContent() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { city, account } = useApp();
  const { t } = useTranslation('daily');
  const daily = useDailyToday(city?.channelId, { countdown: true });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Today's cities (the hero knows whether my city is in; block 3 shows them).
  const countries = useTodayCountries(daily.data, refreshKey);
  // The card's "I'm in" pulses only while the card is on screen.
  const [ticketVisible, setTicketVisible] = useState(true);
  const ticketBottom = useRef(Number.POSITIVE_INFINITY);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y < ticketBottom.current - 24;
    setTicketVisible(v => (v === next ? v : next));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshKey(k => k + 1);
    await daily.reload();
    setRefreshing(false);
  }, [daily]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* The header, fixed: the logo row, then the brand line (stays visible while scrolling). */}
      <View style={styles.header} testID="today-screen"><AppHeader /><BrandLine /></View>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={100}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]}
                                        title={t('today.refreshing')} titleColor={colors.muted} />}
      >
        {/* Since you were away (one card at a time): unseen comments, likes and results, else
            yesterday's unread results on their own (never over the hero). */}
        <WhileAwayCard />
        <ResultsCard />
        <View onLayout={e => { ticketBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          <TodayTicket data={daily.data} countries={countries} loading={daily.loading} error={daily.error} secondsLeft={daily.secondsLeft} visible={ticketVisible} onReload={daily.reload} />
        </View>
        {/* A seasonal event's countdown (teaser days). */}
        <SeasonalTeaser />
        {/* Around the world today: one card per city (the mosaic), "See all"; yesterday's best on an empty day. */}
        <TodayCountries today={daily.data} data={countries} />
        {/* Your week: the streak, tomorrow's theme, the week strip and every past challenge. */}
        <TodayWeek today={daily.data} />
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
