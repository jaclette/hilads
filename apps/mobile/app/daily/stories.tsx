import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, PanResponder, Pressable, Text, TouchableOpacity, View, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyProofsByIds, fetchDailyTodayCountries } from '@/api/daily';
import { track } from '@/services/analytics';
import { localizeCityName } from '@/i18n/cityName';
import { canAccessProfile } from '@/lib/profileAccess';
import { goBack } from '@/lib/nav';
import { Avatar, IconButton } from '@/ui';
import { FlagSticker } from '@/ui/joy';
import { AnswerChip } from '@/features/compare/AnswerChip';
import { captionRepeatsAnswer } from '@/features/compare/format';
import { seedProofs } from '@/features/daily/votes';
import { flushSeen, markSeen } from '@/features/daily/seen';
import { useCastVote } from '@/features/daily/DailyVoteButton';
import { LocalPassBadge } from '@/features/daily/LocalPassBadge';
import { lastCountries, todayCities } from '@/features/today/useTodayCountries';
import { SeasonalScope } from '@/features/event/SeasonalArt';
import type { DailyCityGroup, DailyProof } from '@/types';

/** How long a photo stays before the next one (no auto-advance with reduce motion). */
const PHOTO_MS = 5000;
const DOUBLE_TAP_MS = 280;
// Dark in both themes, like every photo viewer (fixed photo tokens).
const SHADE_TOP = ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'] as const;
const SHADE_BOTTOM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.9)'] as const;

/**
 * Today's stories (V3 polish 2.1): the compare experience. One city at a
 * time, all its photos (best first) with a segment each at the top; tap the
 * right side for the next photo, the left third to go back, hold to pause,
 * swipe down to close; after a city's last photo the next city follows
 * (Today's order), auto-advancing every 5 s (never with Reduce motion). Each
 * photo: its player (a tap opens the profile), the answer, the caption and a
 * heart (a double tap votes too). Each photo shown counts as seen (the rings).
 * `city` = the city to start with.
 */
export default function StoriesScreen() {
  return <SeasonalScope><Stories /></SeasonalScope>;
}

function Stories() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const { city: startCity, source } = useLocalSearchParams<{ city?: string; source?: string }>();
  const [cities, setCities] = useState<DailyCityGroup[] | null>(() => {
    const list = todayCities(lastCountries());
    return list.length ? list : null;
  });
  const [failed, setFailed] = useState(false);
  const [cityIndex, setCityIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [proofs, setProofs] = useState<Record<string, DailyProof>>({});
  // Photos that couldn't load (removed, a network error): skipped, never a stuck loader.
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  // Start at the city asked for; the cities before it come at the end.
  const order = useMemo(() => {
    if (!cities) return [];
    const at = Math.max(0, cities.findIndex(c => String(c.city.id) === String(startCity)));
    return [...cities.slice(at), ...cities.slice(0, at)];
  }, [cities, startCity]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
    track('today_stories_opened', { source: source ?? 'today', city: startCity ?? null });
    if (cities) return;
    fetchDailyTodayCountries({ guestId })
      .then(d => setCities(todayCities(d)))
      .catch(() => setFailed(true));
    return () => flushSeen();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const group = order[cityIndex] ?? null;
  const ids = (group?.ids ?? []).filter(id => !gone.has(id));
  const proof = ids[photoIndex] ? proofs[ids[photoIndex]] ?? null : null;

  // A city's photos, the first time it shows (its top one is already there).
  useEffect(() => {
    if (!group) return;
    const missing = group.ids.filter(id => !proofs[id] && id !== group.top.id);
    const seed = { [group.top.id]: proofs[group.top.id] ?? group.top };
    if (!missing.length) { setProofs(p => ({ ...seed, ...p })); return; }
    const skip = (lost: string[]) => { if (lost.length) setGone(g => new Set([...g, ...lost])); };
    fetchDailyProofsByIds(missing, guestId).then(list => {
      seedProofs(list, true);
      setProofs(p => ({ ...seed, ...p, ...Object.fromEntries(list.map(x => [x.id, x])) }));
      skip(missing.filter(id => !list.some(x => x.id === id)));
    }).catch(() => { setProofs(p => ({ ...seed, ...p })); skip(missing); });
  }, [group?.city.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (proof) markSeen(proof.id, !!account); }, [proof?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => goBack();
  const next = () => {
    if (photoIndex + 1 < ids.length) { setPhotoIndex(photoIndex + 1); return; }
    if (cityIndex + 1 < order.length) { setCityIndex(cityIndex + 1); setPhotoIndex(0); return; }
    track('today_stories_completed', { cities: order.length });
    close();
  };
  const prev = () => {
    if (photoIndex > 0) { setPhotoIndex(photoIndex - 1); return; }
    if (cityIndex > 0) {
      const before = order[cityIndex - 1];
      setCityIndex(cityIndex - 1);
      setPhotoIndex(Math.max(0, before.ids.length - 1));
    }
  };

  // The current photo's segment fills, then the next photo (paused while held or with reduce motion).
  useEffect(() => {
    progress.setValue(0);
    if (!proof || paused || reduceMotion) return;
    const anim = Animated.timing(progress, { toValue: 1, duration: PHOTO_MS, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished) next(); });
    return () => anim.stop();
  }, [proof?.id, paused, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderRelease: (_, g) => { if (g.dy > 80) goBack(); },
  })).current;

  if (!group) {
    return (
      <View style={[styles.wrap, styles.center]}>
        {failed || (cities && !cities.length) ? <Text style={styles.caption}>{t('loadFailed')}</Text> : <ActivityIndicator color={colors.white} />}
        <IconButton icon="close" tone="onPhoto" onPress={close} label={t('back')} style={[styles.close, { top: insets.top + 8 }]} />
      </View>
    );
  }

  const openProfile = (p: DailyProof) => {
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${p.user.id}` as never);
  };

  return (
    <View style={styles.wrap} {...pan.panHandlers} testID="today-stories">
      {proof
        ? <Image source={{ uri: proof.photoUrl }} placeholder={proof.thumbUrl ? { uri: proof.thumbUrl } : undefined}
                 style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
        : <ActivityIndicator style={StyleSheet.absoluteFill} color={colors.white} />}
      <LinearGradient colors={SHADE_TOP} style={styles.shadeTop} pointerEvents="none" />
      <LinearGradient colors={SHADE_BOTTOM} style={styles.shadeBottom} pointerEvents="none" />

      {proof && <TapZones proof={proof} onPrev={prev} onNext={next} onHold={setPaused} />}

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {/* One segment per photo of the city: done, filling, to come. */}
        <View style={styles.bars} accessibilityLabel={t('stories.of', { index: photoIndex + 1, total: ids.length })}>
          {ids.map((id, i) => (
            <View key={id} style={styles.bar}>
              {i < photoIndex && <View style={[styles.barFill, { width: '100%' }]} />}
              {i === photoIndex && (
                <Animated.View style={[styles.barFill, {
                  width: reduceMotion ? '100%' : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                }]} />
              )}
            </View>
          ))}
        </View>
        <View style={styles.head}>
          <FlagSticker country={group.city.country} size={26} />
          <View style={styles.flex}>
            <Text style={styles.cityName} numberOfLines={1}>{localizeCityName(group.city.name)}</Text>
            <Text style={styles.cityMeta} numberOfLines={1}>
              {t('stories.cityOf', { index: cityIndex + 1, total: order.length })}
            </Text>
          </View>
          <IconButton icon="close" tone="onPhoto" onPress={close} label={t('back')} />
        </View>
      </View>

      {proof && <Bottom proof={proof} insetBottom={insets.bottom} onProfile={() => openProfile(proof)} />}
    </View>
  );
}

/** Tap zones: the left third goes back, the rest forward; a double tap votes; hold to pause. */
function TapZones({ proof, onPrev, onNext, onHold }: {
  proof: DailyProof; onPrev: () => void; onNext: () => void; onHold: (held: boolean) => void;
}) {
  const { t } = useTranslation('daily');
  const { state, canVote, press } = useCastVote({
    proofId: proof.id, date: proof.date, cityName: proof.city?.name ?? null, cityId: proof.city?.id ?? null, source: 'stories',
  });
  const lastTap = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  const onPress = (x: number) => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (pending.current) { clearTimeout(pending.current); pending.current = null; }
      if (canVote && !state?.myVote) press({ withdraw: false });
      return;
    }
    lastTap.current = now;
    // Wait out a possible second tap before moving on.
    pending.current = setTimeout(() => { pending.current = null; (x < 120 ? onPrev : onNext)(); }, DOUBLE_TAP_MS);
  };
  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={e => onPress(e.nativeEvent.locationX)}
               onLongPress={() => onHold(true)} onPressOut={() => onHold(false)} delayLongPress={250}
               accessibilityRole="button" accessibilityLabel={t('stories.next')} accessibilityHint={t('feed.doubleTap')} />
  );
}

/** The photo's player, answer, caption and heart. */
function Bottom({ proof, insetBottom, onProfile }: { proof: DailyProof; insetBottom: number; onProfile: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { state, canVote, voteLabel, press } = useCastVote({
    proofId: proof.id, date: proof.date, cityName: proof.city?.name ?? null, cityId: proof.city?.id ?? null, source: 'stories',
  });
  const pop = useRef(new Animated.Value(1)).current;
  const name = proof.user.displayName || proof.user.username || '';
  const vote = () => {
    if (!state || state.isMine || (!canVote && !state.myVote)) return;
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, friction: 3, useNativeDriver: true }).start();
    press({ withdraw: !!state.myVote });
  };
  return (
    <View style={[styles.bottom, { paddingBottom: insetBottom + 18 }]} pointerEvents="box-none">
      <View style={styles.info} pointerEvents="box-none">
        <TouchableOpacity style={styles.who} onPress={onProfile} accessibilityRole="button" hitSlop={6}>
          <Avatar uri={proof.user.photoUrl} name={name} size={38} ring />
          <Text style={styles.name} numberOfLines={1}>{proof.user.username ? `@${proof.user.username}` : name}</Text>
          {proof.user.localPass && <LocalPassBadge onDark />}
        </TouchableOpacity>
        {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
        {!!proof.caption && !captionRepeatsAnswer(proof.caption, proof.backHome ? null : proof.answer, i18n.language) && (
          <Text style={styles.caption} numberOfLines={3}>{proof.caption}</Text>
        )}
      </View>
      {proof.status === 'approved' && (
        <TouchableOpacity onPress={vote} accessibilityRole="button" testID="stories-vote" disabled={!state || state.isMine}
                          accessibilityState={{ selected: !!state?.myVote }}
                          accessibilityLabel={state?.myVote ? t('vote.withdraw') : voteLabel}>
          <Animated.View style={[styles.heart, state?.myVote && styles.heartOn, { transform: [{ scale: pop }] }]}>
            <Ionicons name={state?.myVote || state?.isMine ? 'heart' : 'heart-outline'} size={28} color={colors.white} />
          </Animated.View>
          <Text style={styles.count}>{state?.voteCount ?? proof.voteCount}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:        { flex: 1, backgroundColor: c.photoScrim },
  center:      { alignItems: 'center', justifyContent: 'center' },
  flex:        { flex: 1 },
  close:       { position: 'absolute', right: 12 },
  shadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 170 },
  shadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%' },
  top:         { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, gap: 10 },
  bars:        { flexDirection: 'row', gap: 4 },
  bar:         { flex: 1, height: 3, borderRadius: 2, backgroundColor: c.photoControl, overflow: 'hidden' },
  barFill:     { height: 3, backgroundColor: c.white },
  head:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4 },
  cityName:    { fontSize: FontSizes.lg, fontWeight: '800', color: c.white },
  cityMeta:    { fontSize: FontSizes.xs, fontWeight: '700', color: c.onCaramelMuted },
  bottom:      { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16 },
  info:        { flex: 1, gap: 8 },
  who:         { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name:        { flexShrink: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.white },
  caption:     { fontSize: FontSizes.md, fontWeight: '500', color: c.white },
  heart:       { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: c.photoControl },
  heartOn:     { backgroundColor: c.primary },
  count:       { marginTop: 4, textAlign: 'center', fontSize: FontSizes.sm, fontWeight: '800', color: c.white },
});
