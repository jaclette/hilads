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
import { TodayTour } from '@/features/tour/TodayTour';
import { IndexCarousel } from '@/features/index/IndexCarousel';
import { ProposeCard } from '@/features/today/ProposeCard';
import { StampCelebration } from '@/features/today/StampCelebration';
import { BrandLine } from '@/features/today/BrandLine';
import { WhileAwayCard } from '@/features/notifications/WhileAwayCard';
import { ResultsCard, TodayRace } from '@/features/ranks/TodayRace';
import { SeasonalScope, SeasonalTeaser } from '@/features/event/SeasonalArt';

/**
 * TODAY, the home (SPEC 9.3, V3 polish): the Daily Challenge hero, the
 * seasonal banner, today's photos by city (stories row and mosaic), your week
 * (streak, tomorrow), yesterday with every past challenge, the Index and the
 * "Got a challenge idea?" card (the spots live on the Map tab). Never empty:
 * without photos it shows yesterday's best cities and my city's slot.
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
  // Today's cities, one list for the hero's live strip and the compare section.
  const countries = useTodayCountries(daily.data, refreshKey);
  // The card's "I'm in" pulses only while the card is on screen.
  const [ticketVisible, setTicketVisible] = useState(true);
  const ticketBottom = useRef(Number.POSITIVE_INFINITY);
  // The propose card at the bottom: its lightbulb wiggles when it scrolls into view.
  const [proposeInView, setProposeInView] = useState(false);
  const proposeTop = useRef(Number.POSITIVE_INFINITY);
  const viewportH = useRef(0);
  const scrollY = useRef(0);
  const checkPropose = useCallback(() => {
    const next = scrollY.current + viewportH.current > proposeTop.current + 60;
    setProposeInView(v => (v === next ? v : next));
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y < ticketBottom.current - 24;
    setTicketVisible(v => (v === next ? v : next));
    scrollY.current = e.nativeEvent.contentOffset.y;
    viewportH.current = e.nativeEvent.layoutMeasurement.height;
    checkPropose();
  }, [checkPropose]);

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
        onLayout={e => { viewportH.current = e.nativeEvent.layout.height; checkPropose(); }}
        scrollEventThrottle={100}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]}
                                        title={t('today.refreshing')} titleColor={colors.muted} />}
      >
        {/* V6: unseen comments, likes and results since the last visit. */}
        <WhileAwayCard />
        <View onLayout={e => { ticketBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          <TodayTicket data={daily.data} countries={countries} loading={daily.loading} error={daily.error} secondsLeft={daily.secondsLeft} visible={ticketVisible} onReload={daily.reload} />
        </View>
        {/* V6: yesterday's results are out (once). */}
        <ResultsCard />
        {/* A seasonal event's countdown (teaser days). */}
        <SeasonalTeaser />
        {/* Today's photos by country: the stories row and the mosaic (players' photos only). */}
        <TodayCountries today={daily.data} data={countries} />
        {/* V6: the city race of the day, live. */}
        <TodayRace refreshKey={refreshKey} />
        {/* Your week: the streak, tomorrow's theme and the week strip. */}
        <TodayWeek today={daily.data} />
        {/* Yesterday around the world (SPEC 10.7) and every past challenge. */}
        <TodayTour today={daily.data} refreshKey={refreshKey} />
        {/* The world, compared (SPEC 10.9): last week's comparisons, every day. */}
        <IndexCarousel refreshKey={refreshKey} />
        <View onLayout={e => { proposeTop.current = e.nativeEvent.layout.y; checkPropose(); }}>
          <ProposeCard inView={proposeInView} />
        </View>
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
