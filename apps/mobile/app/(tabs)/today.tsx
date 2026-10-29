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
import { SpotsNear } from '@/features/today/SpotsNear';
import { ProposeLink } from '@/features/today/ProposeLink';
import { StampCelebration } from '@/features/today/StampCelebration';
import { BrandLine } from '@/features/today/BrandLine';
import { SeasonalScope, SeasonalTeaser } from '@/features/event/SeasonalArt';

/**
 * TODAY, the home (SPEC 9.3, V3 polish): the Daily Challenge hero, the
 * seasonal banner, today's photos by city (stories row and mosaic), your week
 * (streak, tomorrow), yesterday with every past challenge, the Index, a slim
 * row to the spots near you and "Got a challenge idea? Propose it". Never
 * empty: without photos it shows yesterday's best cities and my city's slot.
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
  const daily = useDailyToday(city?.channelId);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Today's cities, one list for the hero's live strip and the compare section.
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
        <View onLayout={e => { ticketBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          <TodayTicket data={daily.data} countries={countries} loading={daily.loading} secondsLeft={daily.secondsLeft} visible={ticketVisible} onReload={daily.reload} />
        </View>
        {/* A seasonal event's countdown (teaser days). */}
        <SeasonalTeaser />
        {/* Today's photos by country: the stories row and the mosaic (players' photos only). */}
        <TodayCountries today={daily.data} data={countries} />
        {/* Your week: the streak, tomorrow's theme and the week strip. */}
        <TodayWeek today={daily.data} />
        {/* Yesterday around the world (SPEC 10.7) and every past challenge. */}
        <TodayTour today={daily.data} refreshKey={refreshKey} />
        {/* The world, compared (SPEC 10.9): last week's comparisons, every day. */}
        <IndexCarousel refreshKey={refreshKey} />
        <SpotsNear cityId={city?.channelId ?? null} refreshKey={refreshKey} />
        <ProposeLink />
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
