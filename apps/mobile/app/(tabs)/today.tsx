import { useCallback, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View, StyleSheet, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useDailyToday } from '@/hooks/useDaily';
import { AppHeader } from '@/features/shell/AppHeader';
import { TodayTicket } from '@/features/today/TodayTicket';
import { TodayWeek } from '@/features/today/TodayWeek';
import { TodayProofs } from '@/features/today/TodayProofs';
import { TodayTour } from '@/features/tour/TodayTour';
import { IndexCarousel } from '@/features/index/IndexCarousel';
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
      <View style={styles.header}><AppHeader /></View>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={100}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <BrandLine today={daily.data} guest={!account} />
        <View onLayout={e => { ticketBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
          <TodayTicket data={daily.data} loading={daily.loading} secondsLeft={daily.secondsLeft} visible={ticketVisible} onReload={daily.reload} />
        </View>
        <TodayWeek today={daily.data} />
        {/* Yesterday around the world (SPEC 10.7); yesterday's podium below 2 cities. */}
        <TodayTour today={daily.data} refreshKey={refreshKey} />
        <TodayProofs today={daily.data} refreshKey={refreshKey} />
        {/* The world, compared (SPEC 10.9): last week's comparisons, every day. */}
        <IndexCarousel refreshKey={refreshKey} />
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
