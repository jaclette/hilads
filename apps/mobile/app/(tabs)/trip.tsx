import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, RefreshControl, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Space, Gutter, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Button } from '@/ui';
import { fetchContestRanking, type ContestRanking, type ContestSeason } from '@/features/contest/contest';
import { refreshContestTab, reloadContestOverview, useContestOverview } from '@/features/contest/useContestTab';
import { PrizeCover } from '@/features/contest/PrizePhotos';
import { LS } from '@/features/contest/HalongArt';
import { countdownTarget, shortLeft, useLiveNow } from '@/features/contest/Countdown';
import { fetchCrew, type Crew } from '@/features/invites/invite';
import { useContestShare } from '@/features/contest/useContestShare';
import { TripOverview, TripRanking, TripFriends, TripRules, SECTIONS, type TripSection } from '@/features/contest/TripSections';
import { track } from '@/services/analytics';
import { HeaderInbox } from '@/features/shell/HeaderInbox';
import { ackRankTab } from '@/features/contest/raceSignals';

/**
 * The campaign's destination (the temporary "Trip" tab, docs/mockups/hilads_season_mockup.html):
 * the prize photo full-bleed (tap: the prize details) that collapses to a slim header, a sticky
 * sub-menu (Overview · Ranking · Friends · Rules, tap or swipe), one section at a time. Every value
 * and date comes from GET /contest (the back office), the points are the regular Hilads points.
 * No back arrow: it is a tab. Deep links (/contest, /contest-ranking, ?section=) land here.
 */
const MENU_H = 48;
const SLIM_BAR = 52;

export default function TripScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { t } = useTranslation('me');
  const { account } = useApp();
  const params = useLocalSearchParams<{ section?: string }>();
  const data = useContestOverview();
  const s = data?.season ?? null;
  const share = useContestShare(data);

  const HERO_H = insets.top + Math.round(Math.min(300, Math.max(230, height * 0.33)));
  const SLIM_H = insets.top + SLIM_BAR;
  const COLLAPSE = HERO_H - SLIM_H;

  const [section, setSection] = useState<TripSection>(() => (SECTIONS.includes(params.section as TripSection) ? params.section as TripSection : 'overview'));
  useEffect(() => {
    if (SECTIONS.includes(params.section as TripSection)) setSection(params.section as TripSection);
  }, [params.section]);

  // ── Data: the overview (shared with the tab bar and the Today banner), the ranking, my friends ──
  const [ranking, setRanking] = useState<ContestRanking | null>(null);
  const [crew, setCrew] = useState<Crew | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const part = s && (s.phase === 'final' || s.phase === 'over' || s.phase === 'ended') ? 'final' : 'season';
  const loadExtras = useCallback(() => {
    if (!s) return Promise.resolve();
    return Promise.all([
      fetchContestRanking(part).then(setRanking).catch(() => {}),
      account ? fetchCrew().then(setCrew).catch(() => {}) : Promise.resolve(),
    ]).then(() => {});
  }, [s?.id, part, account?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => {
    reloadContestOverview();
    loadExtras();
  }, [loadExtras]));
  const onRefresh = () => {
    setRefreshing(true);
    refreshContestTab();
    loadExtras().finally(() => setRefreshing(false));
  };

  // Analytics: the screen once per focus, then each section shown.
  const viewed = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    if (s) ackRankTab();   // opened: the tab's "rank changed" dot is seen
    if (s) track('trip_viewed', { section, phase: s.phase, test: s.isTest });
    viewed.current = section;
  }, [s?.id]));   // eslint-disable-line react-hooks/exhaustive-deps

  // ── The collapsing header ──
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const yNow = useRef(0);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      yNow.current = value;
      const c = value >= COLLAPSE - 8;
      setCollapsed(prev => (prev === c ? prev : c));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY, COLLAPSE]);
  const menuY = scrollY.interpolate({ inputRange: [0, COLLAPSE], outputRange: [HERO_H, SLIM_H], extrapolate: 'clamp' });
  const slimOpacity = scrollY.interpolate({ inputRange: [COLLAPSE - 40, COLLAPSE], outputRange: [0, 1], extrapolate: 'clamp' });

  // ── Sections: tap or swipe, the new one starts right under the menu ──
  const fade = useRef(new Animated.Value(1)).current;
  const [still, setStill] = useState(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => {}); }, []);
  const go = useCallback((next: TripSection, via: 'tap' | 'swipe' | 'cta') => {
    setSection(prev => {
      if (prev === next) return prev;
      track('trip_section_viewed', { section: next, via, phase: s?.phase ?? null });
      if (yNow.current > COLLAPSE) scrollRef.current?.scrollTo?.({ y: COLLAPSE, animated: false });
      if (!still) { fade.setValue(0.15); Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start(); }
      return next;
    });
  }, [COLLAPSE, fade, still, s?.phase]);
  const swipe = useMemo(() => Gesture.Pan().runOnJS(true).activeOffsetX([-24, 24]).failOffsetY([-14, 14]).onEnd(e => {
    const i = SECTIONS.indexOf(section);
    if (e.translationX < -60 && i < SECTIONS.length - 1) go(SECTIONS[i + 1], 'swipe');
    else if (e.translationX > 60 && i > 0) go(SECTIONS[i - 1], 'swipe');
  }), [section, go]);

  if (!data || !s) {
    return (
      <View style={[styles.screen, styles.center, { paddingTop: insets.top }]}>
        {!data ? <ActivityIndicator color={colors.muted} /> : (
          <>
            <Ionicons name="airplane-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyTitle}>{t('trip.noneTitle')}</Text>
            <Text style={styles.emptyText}>{t('trip.noneText')}</Text>
            <Button variant="secondary" label={t('trip.toToday')} onPress={() => router.navigate('/(tabs)/today' as never)} />
          </>
        )}
      </View>
    );
  }

  const cta = (name: string, extra?: Record<string, unknown>) => track('trip_cta', { cta: name, section, phase: s.phase, ...extra });
  const openPrize = () => { cta('prize'); router.push('/contest-prize' as never); };

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        contentContainerStyle={{ paddingBottom: Space.xxl, minHeight: height + COLLAPSE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" progressViewOffset={insets.top} />}
        testID="trip-scroll"
      >
        <Hero season={s} height={HERO_H} topInset={insets.top} onPress={openPrize} />
        <View style={{ height: MENU_H }} />
        <GestureDetector gesture={swipe}>
          <Animated.View style={[styles.body, { opacity: fade }]} collapsable={false}>
            {section === 'overview' && <TripOverview data={data} ranking={ranking} crew={crew} onSection={next => go(next, 'cta')} onCta={cta}
                                                         onShareBoarding={() => share.open({ boarding: true })} buildShare={() => share.build({ boarding: true })} />}
            {section === 'ranking'  && <TripRanking season={s} ranking={ranking} meId={account?.id ?? null} />}
            {section === 'friends'  && <TripFriends season={s} crew={crew} onCta={cta} />}
            {section === 'rules'    && <TripRules season={s} counter={data.counter ?? null} onCta={cta} onSection={next => go(next, 'cta')} />}
          </Animated.View>
        </GestureDetector>
      </Animated.ScrollView>
      {share.sheet}

      {/* The slim header once the photo has scrolled away. */}
      <Animated.View style={[styles.slim, { height: SLIM_H, paddingTop: insets.top, opacity: slimOpacity }]} pointerEvents={collapsed ? 'auto' : 'none'}>
        <Pressable onPress={openPrize} style={styles.slimRow} accessibilityRole="button" accessibilityHint={t('trip.a11yPrize')} hitSlop={4}>
          <View style={styles.slimThumb}><PrizeCover photos={s.photos} width={36} height={36} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.slimTitle} numberOfLines={1}>{s.prize?.title || s.name}</Text>
            <Text style={styles.slimLink} numberOfLines={1}>{(s.tab?.prizeCta || t('trip.prizeCta')).replace(/\s*🎁\s*$/u, '')} ›</Text>
          </View>
          <CountdownChip season={s} small />
        </Pressable>
        <View style={styles.slimInbox}><HeaderInbox /></View>
      </Animated.View>

      {/* The sub-menu: under the photo, then stuck under the slim header. */}
      <Animated.View style={[styles.menu, { transform: [{ translateY: menuY }] }]} accessibilityRole="tablist">
        {SECTIONS.map((key, i) => {
          const on = key === section;
          return (
            <Pressable key={key} onPress={() => go(key, 'tap')} style={styles.menuItem} accessibilityRole="tab" accessibilityState={{ selected: on }}
                       accessibilityLabel={t('trip.a11ySection', { name: t(`trip.sections.${key}`), index: i + 1, count: SECTIONS.length })} testID={`trip-section-${key}`}>
              <Text style={[styles.menuText, on && styles.menuTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3}>
                {t(`trip.sections.${key}`)}
              </Text>
              <View style={[styles.menuBar, on && styles.menuBarOn]} />
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

/** The prize photo: the campaign's name as a tag, the prize, "for the #1 of the final week", the countdown chip. */
function Hero({ season: s, height, topInset, onPress }: { season: ContestSeason; height: number; topInset: number; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const { t } = useTranslation('me');
  const over = s.phase === 'over' || s.phase === 'ended';
  return (
    <Pressable onPress={onPress} style={{ height, width }} accessibilityRole="button" testID="trip-hero"
               accessibilityLabel={`${s.name}. ${s.prize?.title || s.name}. ${t('trip.forFirst')}`} accessibilityHint={t('trip.a11yPrize')}>
      <View style={StyleSheet.absoluteFill}><PrizeCover photos={s.photos} width={width} height={height} /></View>
      <LinearGradient pointerEvents="none" colors={['rgba(12,8,5,0.45)', 'rgba(12,8,5,0)', 'rgba(12,8,5,0.25)', 'rgba(12,8,5,0.85)']}
                      locations={[0, 0.28, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={[styles.heroTop, { top: topInset + Space.sm }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexShrink: 1 }}>
          <Text style={styles.tag} numberOfLines={1}>{s.name.toUpperCase()}</Text>
          {s.isTest && <Text style={styles.test}>{t('contest.test')}</Text>}
        </View>
        {/* Unread notifications and messages, from every tab. */}
        <HeaderInbox />
      </View>
      <View style={styles.heroBottom}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.heroTitle} numberOfLines={2} accessibilityRole="header">{s.prize?.title || s.name}{'\u00A0'}✈️</Text>
          <Text style={styles.heroSub} numberOfLines={2}>{over && s.winner ? t('trip.over.winnerKnown') : t('trip.forFirst')}</Text>
          <PrizeButton label={s.tab?.prizeCta || t('trip.prizeCta')} onPress={onPress} />
        </View>
        <CountdownChip season={s} />
      </View>
      {/* The prize: the button under the subtitle, and the whole photo. */}
    </Pressable>
  );
}

/**
 * "See the prize 🎁" on the photo: a white translucent pill (the label from the campaign, Admin › Launch
 * Season), a soft pulse once when the screen opens (none with reduce motion), a haptic on press.
 */
function PrizeButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(still => {
      if (still) return;
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(pulse, { toValue: 1.07, duration: 260, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.05, duration: 220, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }).catch(() => {});
  }, [pulse]);
  return (
    <Animated.View style={{ alignSelf: 'flex-start', marginTop: Space.sm, transform: [{ scale: pulse }] }}>
      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
                 style={({ pressed }) => [styles.prizeBtn, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={label}
                 hitSlop={6} testID="trip-see-prize">
        <Text style={styles.prizeBtnText} numberOfLines={1}>{label}</Text>
        <Ionicons name="chevron-forward" size={14} color="#FFFFFF" />
      </Pressable>
    </Animated.View>
  );
}

/** "1d 21h · to final week" (live, ticking each minute), "2d 4h · left" with a live dot in the final week, "Finished". */
export function CountdownChip({ season: s, small }: { season: { phase: string; startsAt?: string | null; finalAt?: string | null; endsAt?: string | null }; small?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const { now } = useLiveNow();
  const target = countdownTarget(s as never);
  const label = !target ? t('trip.chip.over') : t(`trip.chip.${target.label}`);
  const value = target ? shortLeft(target.at - now, t) : null;
  const live = s.phase === 'final';
  // Before the start: "Starts in" over the time left ("Starts in 2d 4h").
  const before = target?.label === 'cdStarts' && !!value;
  return (
    <View style={[styles.chip, small && styles.chipSmall]} accessible accessibilityRole="timer" accessibilityLabel={value ? (before ? `${label} ${value}` : `${value} ${label}`) : label}>
      {before && <Text style={[styles.chipLabel, small && { fontSize: 10, lineHeight: 12 }]} numberOfLines={1}>{label}</Text>}
      {value && (
        <View style={styles.chipRow}>
          {live && <View style={styles.liveDot} />}
          <Text style={[styles.chipValue, small && { fontSize: 13, lineHeight: 16 }]} numberOfLines={1}>{value}</Text>
        </View>
      )}
      {!before && <Text style={[styles.chipLabel, !value && styles.chipValue, small && { fontSize: 10, lineHeight: 12 }]} numberOfLines={1}>{label}</Text>}
    </View>
  );
}

// The photo's overlays use fixed colors (on an image, every theme); the rest is theme tokens.
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen:     { flex: 1, backgroundColor: c.bg },
  center:     { alignItems: 'center', justifyContent: 'center', gap: Space.md, paddingHorizontal: Gutter },
  emptyTitle: { ...Type.title, color: c.text, textAlign: 'center' },
  emptyText:  { ...Type.body, color: c.muted, textAlign: 'center' },
  body:       { paddingHorizontal: Gutter, paddingTop: Space.md, gap: Space.md },
  heroTop:    { position: 'absolute', left: Gutter, right: Gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  tag:        { ...Type.caption, fontSize: 12, lineHeight: 15, fontWeight: '900', letterSpacing: 0.6, color: c.onMedal, backgroundColor: c.medalGold,
                borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden', transform: [{ rotate: '-3deg' }], flexShrink: 1 },
  test:       { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: '#FFFFFF', backgroundColor: LS.lantern, borderRadius: Radius.control,
                paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  heroBottom: { position: 'absolute', left: Gutter, right: Gutter, bottom: Space.lg, flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm },
  heroTitle:  { fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.5, color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  heroSub:    { ...Type.caption, fontSize: 14, lineHeight: 18, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  prizeBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 14, borderRadius: Radius.control,
                backgroundColor: 'rgba(255,255,255,0.24)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' },
  prizeBtnText: { fontSize: 14, lineHeight: 18, fontWeight: '800', color: '#FFFFFF' },
  chip:       { backgroundColor: 'rgba(12,8,5,0.62)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', minWidth: 76 },
  chipSmall:  { paddingVertical: 3, paddingHorizontal: 8, minWidth: 0, borderRadius: 12, backgroundColor: LS.board },
  chipRow:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipValue:  { fontSize: 16, lineHeight: 20, fontWeight: '900', color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  chipLabel:  { fontSize: 11, lineHeight: 14, fontWeight: '700', color: 'rgba(255,255,255,0.82)' },
  liveDot:    { width: 8, height: 8, borderRadius: 4, backgroundColor: LS.lantern },
  slim:       { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: c.bg, borderBottomWidth: 0, flexDirection: 'row', alignItems: 'center' },
  slimRow:    { flex: 1, height: SLIM_BAR, flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingLeft: Gutter },
  slimInbox:  { justifyContent: 'center', paddingLeft: Space.sm, paddingRight: Gutter },
  slimThumb:  { width: 36, height: 36, borderRadius: 10, overflow: 'hidden' },
  slimTitle:  { ...Type.label, fontSize: 16, color: c.text },
  slimLink:   { ...Type.caption, fontSize: 12, lineHeight: 15, fontWeight: '800', color: c.primaryText },
  menu:       { position: 'absolute', top: 0, left: 0, right: 0, height: MENU_H, flexDirection: 'row', backgroundColor: c.bg,
                borderBottomWidth: 1.5, borderBottomColor: c.line, paddingHorizontal: Space.sm },
  menuItem:   { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: 44 },
  menuText:   { ...Type.caption, fontSize: 14, lineHeight: 18, fontWeight: '800', color: c.muted, paddingBottom: Space.sm },
  menuTextOn: { color: c.primaryText },
  menuBar:    { height: 3, alignSelf: 'stretch', marginHorizontal: Space.sm, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: 'transparent' },
  menuBarOn:  { backgroundColor: c.cta },
});
