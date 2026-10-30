import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, PanResponder, Pressable, Text, View, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyTour } from '@/api/daily';
import { track } from '@/services/analytics';
import { CommentButton } from '@/features/daily/CommentButton';
import { commentsTargetOf, PhotoCommentsHost, useCommentsOpen } from '@/features/daily/PhotoCommentsSheet';
import { shortCityName } from '@/i18n/cityName';
import { Button, CityFlag, DualPhoto, IconButton } from '@/ui';
import { selfieOf } from '@/features/daily/selfie';
import { AnswerChip } from '@/features/compare/AnswerChip';
import { BackHomeBlock } from '@/features/compare/BackHomeBlock';
import { useMoney } from '@/features/compare/money';
import { RankMedal } from '@/features/daily/RankMedal';
import { themeName } from '@/features/daily/themes';
import { lastTour } from '@/features/tour/store';
import { proofShare, type ShareContent } from '@/features/share/content';
import { ShareSheet } from '@/features/share/ShareSheet';
import { themeCover } from '@/features/today/covers';
import { coverThumbUrl } from '@/lib/imageThumb';
import { useHere } from '@/hooks/useDaily';
import type { DailyTour } from '@/types';
import { goBack } from '@/lib/nav';

/** How long a slide stays before the next one (no auto-advance with reduce motion). */
const SLIDE_MS = 6000;
// The viewer is dark in both themes, like every photo lightbox (fixed photo tokens).
const SHADE_TOP = ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] as const;
const SHADE_BOTTOM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.92)'] as const;

/**
 * Yesterday around the world (SPEC 10.7): a full-screen story of yesterday's
 * challenge, one slide per city (its best proof: photo full-bleed, city and
 * flag, theme, answer, price in my currency, moment of the day, @username,
 * caption, Back home), then "Your turn" with today's challenge. Tap to
 * advance (left third goes back), hold to pause, swipe down to close.
 * Readable without an account; each slide can be shared.
 */
export default function TourScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity, city } = useApp();
  const { start, source } = useLocalSearchParams<{ start?: string; source?: string }>();
  const money = useMoney();
  const [tour, setTour] = useState<DailyTour | null>(lastTour());
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(Math.max(0, Number(start) || 0));
  const [paused, setPaused] = useState(false);
  const commentsOpen = useCommentsOpen();
  const [share, setShare] = useState<ShareContent | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const seen = useRef(new Set<number>());

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    track('world_tour_opened', { source: source ?? 'today', start: Number(start) || 0 });
    if (lastTour()) return;
    fetchDailyTour({ cityId: city?.channelId, guestId: account ? null : identity?.guestId })
      .then(setTour)
      .catch(() => setFailed(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const slides = tour?.slides ?? [];
  const total = slides.length + 1;   // + "Your turn"
  const last = index >= slides.length;
  const close = () => goBack();
  const go = (next: number) => {
    if (next < 0) return;
    if (next >= total) { close(); return; }
    setIndex(next);
  };

  // Tracking: each city once, and the end of the tour.
  useEffect(() => {
    if (!tour || seen.current.has(index)) return;
    seen.current.add(index);
    if (index < slides.length) track('world_tour_slide_viewed', { city: slides[index].city.name, index, date: tour.date });
    else track('world_tour_completed', { date: tour.date, cities: new Set(slides.map(s => s.city.id)).size, photos: slides.length });
  }, [index, tour]); // eslint-disable-line react-hooks/exhaustive-deps

  // The progress bar of the current slide, then the next one (paused while held, a finger on the selfie
  // inset, a sheet open, or reduce motion). A pause resumes where it stopped; another slide starts over.
  const [interacting, setInteracting] = useState(false);
  useEffect(() => { progress.setValue(0); }, [index, tour]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tour || last || paused || interacting || share || commentsOpen || reduceMotion) return;
    let anim: Animated.CompositeAnimation | null = null;
    progress.stopAnimation(at => {
      anim = Animated.timing(progress, { toValue: 1, duration: Math.max(0, (1 - at) * SLIDE_MS), easing: Easing.linear, useNativeDriver: false });
      anim.start(({ finished }) => { if (finished) go(index + 1); });
    });
    return () => { anim?.stop(); };
  }, [index, tour, paused, interacting, share, commentsOpen, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 80) goBack(); },
  })).current;

  // A hook: above the early return below (after it, the first render without a tour had one hook
  // fewer than the next: "Rendered more hooks than during the previous render", the tour crashed).
  const here = useHere();   // "Answer for [city]": where I am, not the browsed city

  if (!tour) {
    return (
      <View style={[styles.wrap, styles.center]}>
        {failed ? <Text style={styles.caption}>{t('loadFailed')}</Text> : <ActivityIndicator color={colors.white} />}
        <IconButton icon="close" tone="onPhoto" onPress={close} label={t('back')} style={[styles.close, { top: insets.top + 24 }]} />
      </View>
    );
  }

  const slide = last ? null : slides[index];
  const proof = slide?.proof ?? null;
  const theme = tour.challenge.theme
    ? themeName(tour.challenge.theme.key, { special: tour.challenge.special, city: slide?.city.name }) : '';
  const price = proof?.price && !proof.backHome ? money.price(proof.price) : null;
  const todayChallenge = tour.today;
  const cover = last && todayChallenge
    ? (todayChallenge.coverUrl ? { uri: coverThumbUrl(todayChallenge.coverUrl) } : themeCover(todayChallenge.theme?.key ?? 'only_here', todayChallenge.date))
    : proof ? { uri: proof.photoUrl } : null;
  const takeIt = () => {
    goBack();
    router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  };

  return (
    <View style={styles.wrap} {...pan.panHandlers} testID="daily-tour">
      {/* Tap zones: the left third goes back, the rest forward; hold to pause. The photo over them lets
          touches through; its selfie inset (dual photo) catches its own taps. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={e => go(e.nativeEvent.locationX < 120 ? index - 1 : index + 1)}
                 onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} delayLongPress={250}
                 accessibilityRole="button" accessibilityLabel={t('tour.next')} />
      {!last && proof
        ? <DualPhoto main={{ uri: proof.photoUrl, thumb: proof.thumbUrl }} selfie={selfieOf(proof)} style={StyleSheet.absoluteFill}
                     transition={120} insetTop={insets.top + 64} onInteract={setInteracting} />
        // In a View: expo-image ignores pointerEvents on Android, and would take the tap zones' touches.
        : cover && <View style={StyleSheet.absoluteFill} pointerEvents="none"><Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} /></View>}
      <LinearGradient colors={SHADE_TOP} style={styles.shadeTop} pointerEvents="none" />
      <LinearGradient colors={SHADE_BOTTOM} style={styles.shadeBottom} pointerEvents="none" />

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.bars}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={styles.bar}>
              {i < index ? <View style={[styles.barFill, { width: '100%' }]} />
                : i === index ? <Animated.View style={[styles.barFill, {
                    width: last || reduceMotion ? '100%' : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                  }]} />
                : null}
            </View>
          ))}
        </View>
        <View style={styles.head}>
          {slide ? (
            <View style={styles.cityRow}>
              <CityFlag country={slide.city.country} size={24} />
              <View style={styles.flex}>
                <Text style={styles.city} numberOfLines={1}>{shortCityName(slide.city.name)}</Text>
                <Text style={styles.theme} numberOfLines={1}>{t('tour.kicker', { theme })}</Text>
              </View>
              {slide.podium && <RankMedal rank={slide.podium} size={28} />}
            </View>
          ) : <View style={styles.flex} />}
          <IconButton icon="close" tone="onPhoto" onPress={close} label={t('back')} />
        </View>
      </View>

      {slide && proof ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
          {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
          <Text style={styles.meta}>
            {[price?.main, t(`tour.moment.${slide.moment}`), proof.user.username ? `@${proof.user.username}` : null].filter(Boolean).join('  ·  ')}
          </Text>
          {!!proof.caption && <Text style={styles.caption} numberOfLines={3}>{proof.caption}</Text>}
          {proof.backHome && <BackHomeBlock proof={proof} />}
          <View style={styles.actions} pointerEvents="box-none">
            <Text style={styles.tagline}>{t('worlds.tagline')}</Text>
            <CommentButton target={commentsTargetOf(proof)} variant="side" />
            <IconButton icon="share-social-outline" tone="onPhoto" label={t('share.shareProof')}
                        onPress={() => { setShare(proofShare(proof, tour.challenge)); track('world_tour_shared', { city: slide.city.name, date: tour.date }); }} />
          </View>
        </View>
      ) : (
        // The last slide: today's challenge.
        <View style={[styles.bottom, styles.turn, { paddingBottom: insets.bottom + 24 }]} pointerEvents="box-none">
          <Text style={styles.turnTitle}>{t('tour.yourTurn')}</Text>
          {todayChallenge && <Text style={styles.turnText}>{t('tour.todayIs', { question: todayChallenge.compare?.question ?? todayChallenge.text })}</Text>}
          {todayChallenge?.isActive && (
            <Button icon="camera-outline" label={here?.name ? t('ctaAnswer', { city: shortCityName(here.name) }) : t('ctaAnswerNoCity')} onPress={takeIt} />
          )}
          <Button variant="link" label={t('tour.close')} onPress={close} />
        </View>
      )}

      <ShareSheet content={share} source="world_tour" onClose={() => setShare(null)} />
      {/* A native full-screen modal: comments open in its own layer. */}
      <PhotoCommentsHost />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:        { flex: 1, backgroundColor: c.photoScrim },
  center:      { alignItems: 'center', justifyContent: 'center' },
  flex:        { flex: 1 },
  close:       { position: 'absolute', right: 16 },
  shadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 200 },
  shadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%' },
  top:         { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 12 },
  bars:        { flexDirection: 'row', gap: 4 },
  bar:         { flex: 1, height: 3, borderRadius: 2, backgroundColor: c.onPhotoLine, overflow: 'hidden' },
  barFill:     { height: 3, backgroundColor: c.white },
  head:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cityRow:     { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  city:        { fontSize: FontSizes.xl, fontWeight: '800', color: c.white },
  theme:       { fontSize: FontSizes.xs, fontWeight: '700', color: c.onCaramelMuted },
  bottom:      { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, gap: 10 },
  meta:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.white },
  caption:     { fontSize: FontSizes.md, fontWeight: '500', color: c.white },
  actions:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 4 },
  tagline:     { flex: 1, fontSize: FontSizes.xs, fontWeight: '700', color: c.onCaramelMuted },
  turn:        { top: 0, justifyContent: 'flex-end' },
  turnTitle:   { fontSize: FontSizes.xxl, fontWeight: '800', color: c.white },
  turnText:    { fontSize: FontSizes.lg, lineHeight: 28, fontWeight: '700', color: c.white, marginBottom: 12 },
});
