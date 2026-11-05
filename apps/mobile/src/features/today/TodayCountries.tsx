import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Animated, {
  interpolateColor, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyProofsByIds, fetchDailyTour } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { answerText } from '@/features/compare/format';
import { hasUnseen, isSeen, useSeen } from '@/features/daily/seen';
import { seedProofs, useVoteState } from '@/features/daily/votes';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useHere } from '@/hooks/useDaily';
import { useSeasonalLive } from '@/features/event/seasonal';
import { rememberTour, useLastTour } from '@/features/tour/store';
import { track } from '@/services/analytics';
import { Avatar, DualPhoto, Photo, SectionTitle } from '@/ui';
import { selfieOf } from '@/features/daily/selfie';
import { prefetchProof } from '@/lib/prefetch';
import { FlagSticker, themeColor } from '@/ui/joy';
import type { DailyCityGroup, DailyProof, DailyToday, DailyTodayCountries, DailyTour } from '@/types';
import { todayCities } from './useTodayCountries';

const CIRCLE = 64;
const RING = 3;
const MAX_SEGMENTS = 8;
const MOSAIC_MAX = 6;

/**
 * "Same challenge. Different worlds." (V3 polish 2): today's photos by city,
 * right under the hero, from the hero's own list (useTodayCountries).
 * - The stories row, "[n] cities played today": one bubble per city (flag,
 *   name), its ring cut in one segment per photo (8 at most), in today's theme
 *   color while unseen, grey once seen, a count badge past one photo; my city,
 *   before I play, as a dashed "Saigon?" bubble that opens the camera. A
 *   bubble opens the story viewer at that city, the next cities following.
 * - The mosaic: one card per city (its most liked photo), a polaroid pile
 *   behind it when the city has several photos (top right, clear of a selfie:
 *   "2 players", or "3 · 2 players" when someone posted twice), its answer
 *   large, its players' avatars and its likes; cards lean a little, each its
 *   own way. My city's empty slot comes first until I play.
 * - Nobody played yet: yesterday's top 3 cities, greyed ("Yesterday the world
 *   said…"), and my city's slot to be the first.
 */
export function TodayCountries({ today, data }: { today: DailyToday | null; data: DailyTodayCountries | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const here = useHere();
  useSeen();
  const challenge = today?.challenge ?? null;
  // A seasonal event's live day: its copy ("3 cities are haunted 🎃") and a badge on each card.
  const seasonal = useSeasonalLive();
  const copy = seasonal?.theme.copy;
  const cities = todayCities(data);
  // Nobody played yet: yesterday's best cities teach the idea (the tour Today already loads).
  // Only the tour of the challenge just before today's: one kept from an earlier day
  // (the app left open overnight) showed the day before yesterday.
  const remembered = useLastTour();
  const swiped = useSwipedStack();
  const tour = remembered && (!remembered.today || remembered.today.id === challenge?.id) ? remembered : null;
  useEffect(() => {
    if (!challenge || cities.length > 0 || tour) return;
    fetchDailyTour({ cityId: here?.id ?? today?.city?.id ?? null, guestId: account ? null : identity?.guestId ?? null })
      .then(rememberTour).catch(() => {});
  }, [challenge?.id, cities.length > 0, !!tour]); // eslint-disable-line react-hooks/exhaustive-deps

  // One handler for every card (the cards are memoized): it reads the latest openCity.
  const openRef = useRef<(g: DailyCityGroup, photo: string) => void>(() => {});
  const openTile = useCallback((g: DailyCityGroup, photo: string) => openRef.current(g, photo), []);

  if (!challenge || !data) return null;
  const myProof = today?.myProof ?? null;
  const canPlay = challenge.isActive && !myProof;
  const myCity = here?.name ? shortCityName(here.name) : null;
  const mineIn = !!here && cities.some(c => c.city.id === here.id);
  // The server's order, kept fresh as photos get seen here: my city, then unseen, then the most recent.
  const stories = [...cities].sort((a, b) =>
    Number(b.city.id === here?.id) - Number(a.city.id === here?.id)
    || Number(hasUnseen(b)) - Number(hasUnseen(a))
    || b.latestAt - a.latestAt);
  // The mosaic: my city first, then the most liked.
  const cards = [...cities].sort((a, b) =>
    Number(b.city.id === here?.id) - Number(a.city.id === here?.id)
    || (b.totalLikes ?? b.top.voteCount) - (a.totalLikes ?? a.top.voteCount)
    || b.count - a.count).slice(0, MOSAIC_MAX);
  const theme = themeColor(challenge.special ? 'special' : challenge.theme?.key);
  const ring = theme.line ?? theme.fill;
  const slot = canPlay && !mineIn;

  const play = () => {
    track('today_countries_play', { has_photos: cities.length > 0 });
    router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  };
  const openCity = (g: DailyCityGroup, source: 'today_stories' | 'today_mosaic', photo?: string) => {
    track(source === 'today_stories' ? 'today_countries_story' : 'today_countries_tile', { country: g.city.country, unseen: hasUnseen(g) });
    router.push(`/daily/stories?city=${g.city.id}&source=${source}${photo ? `&photo=${photo}` : ''}` as never);
  };
  openRef.current = (g, photo) => openCity(g, 'today_mosaic', photo);
  const yesterday = (tour?.slides ?? []).slice().sort((a, b) => (a.podium ?? 99) - (b.podium ?? 99)).slice(0, 3);

  return (
    <View style={styles.wrap} testID="today-countries">
      {(cities.length > 0 || canPlay) && (
        <View style={styles.block}>
          {cities.length > 0 && <SectionTitle small title={t(copy?.played ?? 'stories.played', { count: cities.length })} />}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {/* My city, before I play: "Saigon?" straight to the camera. */}
            {slot && (
              <TouchableOpacity style={styles.story} onPress={play} accessibilityRole="button" testID="country-story-mine"
                                accessibilityLabel={t(copy?.represent ?? 'countries.represent')}>
                <View style={[styles.ring, styles.dashed]}>
                  <Ionicons name="add" size={28} color={colors.primaryText} />
                </View>
                <Text style={styles.storyName} numberOfLines={1}>{myCity ? t('stories.yourCity', { city: myCity }) : t('countries.yourCity')}</Text>
              </TouchableOpacity>
            )}
            {stories.map(g => {
              const unseen = hasUnseen(g);
              return (
                <TouchableOpacity key={g.city.id} style={styles.story} onPress={() => openCity(g, 'today_stories')} onPressIn={() => prefetchProof(g.top)} accessibilityRole="button"
                                  testID="country-story" accessibilityLabel={t('countries.openCountry', { city: shortCityName(g.city.name) })}>
                  <View style={styles.ringBox}>
                    <SegmentRing ids={g.ids} color={ring} seenColor={colors.line} />
                    <View style={styles.inner}><FlagSticker country={g.city.country} size={CIRCLE - 22} /></View>
                    {g.count > 1 && (
                      <View style={[styles.countBadge, { backgroundColor: theme.fill }]}>
                        <Text style={[styles.countText, { color: theme.onFill }]}>{g.count}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.storyName, !unseen && styles.storySeen]} numberOfLines={1}>{shortCityName(g.city.name)}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {(cities.length > 0 || canPlay) && (
        <View style={styles.block}>
          <SectionTitle small title={t('worlds.tagline')}
                        action={cities.length > 0 ? { label: t('today.seeAll'), onPress: () => router.push('/daily/countries?source=today_mosaic' as never) } : undefined} />
          {cities.length === 0 && yesterday.length > 0 && <Text style={styles.invite}>{t('mosaic.yesterday')}</Text>}
          <View style={styles.grid}>
            {slot && <SlotCard city={myCity} first={cities.length === 0} label={copy?.represent} onPress={play} />}
            {cities.length > 0
              ? cards.map(g => <CityCard key={g.city.id} group={g} pileColor={theme.fill} badge={seasonal?.theme.emoji} onOpen={openTile} />)
              : yesterday.map(s => <CityCard key={s.proof.id} faded pileColor={theme.fill} group={{
                  city: { id: s.city.id, name: s.city.name, country: s.city.country ?? '' }, count: s.count, authorCount: null,
                  authors: [], totalLikes: null, latestAt: 0, unseen: false, ids: [s.proof.id], top: s.proof,
                }} onOpen={() => router.push('/daily/tour?source=today_empty' as never)} />)}
          </View>
          {/* Until the first swipe ever: the piles can be swiped. */}
          {cities.length > 0 && swiped === false && cards.some(g => g.count > 1) && <Text style={styles.hint}>{t('mosaic.swipeHint')}</Text>}
          {cities.length === 0 && yesterday.length === 0 && !slot && <Text style={styles.invite}>{t('countries.emptyBody')}</Text>}
        </View>
      )}
    </View>
  );
}

/** A story ring cut in one segment per photo: theme color while unseen, grey once seen. */
function SegmentRing({ ids, color, seenColor }: { ids: string[]; color: string; seenColor: string }) {
  const n = Math.min(ids.length, MAX_SEGMENTS);
  const r = (CIRCLE - RING) / 2;
  const c = CIRCLE / 2;
  const gap = n > 1 ? 10 : 0;   // degrees between segments
  const arc = (from: number, to: number) => {
    const p = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return `${c + r * Math.cos(rad)} ${c + r * Math.sin(rad)}`;
    };
    return `M ${p(from)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`;
  };
  if (n <= 1) {
    return (
      <View style={[StyleSheet.absoluteFill, { borderRadius: CIRCLE / 2, borderWidth: RING, borderColor: isSeen(ids[0] ?? '') ? seenColor : color }]} />
    );
  }
  const step = 360 / n;
  return (
    <Svg width={CIRCLE} height={CIRCLE} style={StyleSheet.absoluteFill}>
      {ids.slice(0, n).map((id, i) => (
        <Path key={id} d={arc(i * step + gap / 2, (i + 1) * step - gap / 2)} stroke={isSeen(id) ? seenColor : color}
              strokeWidth={RING} strokeLinecap="round" fill="none" />
      ))}
    </Svg>
  );
}

/** A small, steady lean per city (±1.5°), never changing between renders. */
function lean(id: number): number {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 3 - 1.5;
}

// The pile's back poses (x, y, degrees): the next photo, then the one after; deeper ones are hidden.
const BACK1 = [8, -2, 5] as const;
const BACK2 = [-7, 3, -5] as const;

/**
 * A city's card: its most liked photo, and when the city has several, a pile of
 * them (the next ones peek out behind, theme-colored edges): swipe sideways to
 * bring the next to the front, endlessly; its answer, player, likes, comments
 * and selfie follow the photo on top, and a tap opens the stories at it. A
 * nudge shows the swipe until the first one. `faded`: yesterday's card in the empty state.
 *
 * Smoothness: every photo of the pile is mounted once (keyed by photo, card-sized
 * thumbnails) and never reloads; a swipe only changes transforms and z-order. The
 * drag runs on the UI thread (gesture handler + worklets): no React render while
 * dragging; the front index reaches React once the photo has flown off.
 */
const CityCard = memo(function CityCard({ group, onOpen, pileColor, badge, faded = false }: {
  group: DailyCityGroup; onOpen: (g: DailyCityGroup, photoId: string) => void; pileColor: string; badge?: string; faded?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const reduced = useReducedMotion();
  const photos = usePilePhotos(group, guestId);
  const n = Math.max(1, photos.length);
  const pile = group.count > 1;
  const swipeable = photos.length > 1 && !faded;
  const swiped = useSwipedStack();

  // The front photo: `top` on the UI thread (drives the pile), `front` in React (labels, the tap),
  // updated once a swipe has landed. Kept on the same photo when the pile's photos arrive.
  const top = useSharedValue(0);
  const count = useSharedValue(n);
  const [front, setFront] = useState(0);
  const frontId = useRef(group.top.id);
  useEffect(() => {
    const i = Math.max(0, photos.findIndex(x => x.id === frontId.current));
    count.value = n;
    top.value = i;
    setFront(i);
  }, [photos.map(x => x.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const p: DailyProof = photos[front % n] ?? group.top;

  // The top photo follows the thumb sideways (a slight tilt) while the next one rises from the pile;
  // past a third of the card, or a flick, it flies off and the next is on top, endlessly; short of
  // it, it springs back. Horizontal moves only: a vertical one fails the gesture, the page scrolls.
  const w = useSharedValue(160);
  const tx = useSharedValue(0);
  const fade = useSharedValue(1);
  const settle = useSharedValue(1);   // the photo just swiped away, settling back at the bottom of the pile
  const dragging = useRef(false);
  const setDragging = (v: boolean) => { dragging.current = v; };
  const landed = (i: number) => {
    Haptics.selectionAsync().catch(() => {});
    markSwiped();
    track('today_pile_swipe', { city: group.city.id, photos: photos.length });
    frontId.current = photos[i]?.id ?? frontId.current;
    setFront(i);
  };
  const fly = (dir: number) => {
    'worklet';
    const done = (finished?: boolean) => {
      'worklet';
      if (!finished) return;
      const next = (top.value + 1) % count.value;
      top.value = next;
      tx.value = 0;
      fade.value = 1;
      settle.value = 0;
      settle.value = withTiming(1, { duration: 220 });
      runOnJS(landed)(next);
    };
    if (reduced) fade.value = withTiming(0, { duration: 150 }, done);
    else tx.value = withTiming(dir * w.value * 1.4, { duration: 200 }, done);
  };
  const pan = Gesture.Pan()
    .enabled(swipeable)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => { runOnJS(setDragging)(true); })
    .onUpdate(e => { tx.value = e.translationX; })
    .onEnd(e => {
      if (Math.abs(e.translationX) > w.value * 0.33 || (Math.abs(e.velocityX) > 600 && Math.abs(e.translationX) > 24)) fly(e.translationX > 0 ? 1 : -1);
      else tx.value = withSpring(0, { damping: 15, stiffness: 200 });
    })
    .onFinalize(() => { runOnJS(setDragging)(false); });

  // Until the first swipe ever (on this phone): a second after it shows, the first pile of the
  // visit nudges aside and springs back, the next photo's edge in view.
  useEffect(() => {
    if (!swipeable || reduced || swiped !== false || !claimNudge()) return;
    tx.value = withDelay(1000, withSequence(withTiming(-35, { duration: 300 }), withSpring(0, { damping: 12, stiffness: 160 })));
  }, [swipeable, reduced, swiped, tx]);

  const line = lineOf(p, i18n.language);
  const state = useVoteState(p.id, guestId);
  const likes = state?.voteCount ?? p.voteCount;
  const comments = p.commentCount ?? 0;
  const players = group.authorCount ?? 0;
  const motion = useMemo(() => ({ top, count, tx, w, fade, settle, reduced }), [reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.cardWrap, { transform: [{ rotate: `${lean(group.city.id)}deg` }] }, faded && styles.faded]}
            onLayout={e => { w.value = e.nativeEvent.layout.width; }}>
        <TouchableOpacity onPress={() => { if (!dragging.current) onOpen(group, p.id); }} onPressIn={() => prefetchProof(p)} activeOpacity={0.9}
                          accessibilityRole="button" testID="mosaic-tile"
                          accessibilityLabel={[shortCityName(group.city.name), line, pile ? t('mosaic.players', { count: players }) : null,
                                              swipeable ? t('stories.of', { index: front + 1, total: photos.length }) : null, String(likes),
                                              comments ? t('comments.count', { count: comments }) : null].filter(Boolean).join(', ')}
                          accessibilityActions={swipeable ? [{ name: 'next', label: t('stories.next') }] : undefined}
                          onAccessibilityAction={e => { if (e.nativeEvent.actionName === 'next') runOnUI(fly)(1); }}>
          {/* Plain theme-colored sheets while the pile's photos load. */}
          {pile && photos.length < Math.min(group.count, 3) && (
            <>
              {group.count > 2 && photos.length < 3 && <View pointerEvents="none" style={[styles.layer, styles.layerBack2, { backgroundColor: pileColor }]} />}
              {photos.length < 2 && <View pointerEvents="none" style={[styles.layer, styles.layerBack, { backgroundColor: pileColor }]} />}
            </>
          )}
          {(photos.length ? photos : [group.top]).map((x, i) => (
            <PileLayer key={x.id} proof={x} index={i} n={n} motion={motion} pileColor={pileColor} lineColor={colors.line} guestId={guestId}
                       city={group} badge={badge} counter={pile && !faded} total={photos.length > 1 ? photos.length : Math.min(group.count, PILE_MAX)}
                       dots={swipeable ? photos.length : 0} />
          ))}
        </TouchableOpacity>
      </View>
    </GestureDetector>
  );
});

type PileMotion = {
  top: SharedValue<number>; count: SharedValue<number>; tx: SharedValue<number>; w: SharedValue<number>;
  fade: SharedValue<number>; settle: SharedValue<number>; reduced: boolean;
};

function lineOf(p: DailyProof, lang: string): string {
  return p.answer && !p.backHome ? answerText(p.answer, lang) : p.caption ?? p.spot?.name ?? p.place?.name ?? '';
}

/**
 * One photo of a pile, mounted for good: in front it follows the drag; just behind, it rises to
 * the front as the drag goes on; further back it waits, hidden. Its z-order changes only when a
 * swipe lands (a style of its own, so the drag never resends it); its footer shows only in front.
 * `n` (the pile's size) is a prop, not the shared count: a photo mounting as the pile loads gets
 * its depth right on its first frame.
 */
const PileLayer = memo(function PileLayer({ proof, index, n, motion, pileColor, lineColor, guestId, city, badge, counter, total, dots }: {
  proof: DailyProof; index: number; n: number; motion: PileMotion; pileColor: string; lineColor: string; guestId: string | null;
  city: DailyCityGroup; badge?: string; counter: boolean; total: number; dots: number;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { top, tx, w, fade, settle, reduced } = motion;
  const state = useVoteState(proof.id, guestId);
  const depth = () => {
    'worklet';
    return ((index - top.value) % n + n) % n;
  };
  const order = useAnimatedStyle(() => ({ zIndex: n - depth() }));
  const move = useAnimatedStyle(() => {
    const d = depth();
    const p = Math.min(1, Math.abs(tx.value) / Math.max(1, w.value));
    if (d === 0) {
      return {
        opacity: fade.value, borderColor: lineColor,
        transform: [{ translateX: tx.value }, { translateY: 0 }, { rotate: `${reduced ? 0 : (tx.value / Math.max(1, w.value)) * 10}deg` }],
      };
    }
    // The photo just swiped away comes back at the bottom of the pile, fading in.
    const back = d === n - 1 ? settle.value : 1;
    if (d > 2) return { opacity: 0, borderColor: pileColor, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }] };
    const from = d === 1 ? BACK1 : BACK2;
    const to = d === 1 ? [0, 0, 0] : BACK1;
    const at = (k: number) => from[k] + (to[k] - from[k]) * p;
    return {
      opacity: back, borderColor: d === 1 ? interpolateColor(p, [0, 1], [pileColor, lineColor]) : pileColor,
      transform: [{ translateX: at(0) }, { translateY: at(1) }, { rotate: `${at(2)}deg` }],
    };
  });
  // The footer and the photo's labels: on the front photo, fading in on the one rising behind it.
  const extras = useAnimatedStyle(() => {
    const d = depth();
    return { opacity: d === 0 ? 1 : d === 1 ? Math.min(1, Math.abs(tx.value) / Math.max(1, w.value)) : 0 };
  });

  const players = city.authorCount ?? 0;
  const likes = state?.voteCount ?? proof.voteCount;
  const comments = proof.commentCount ?? 0;
  return (
    <Animated.View pointerEvents="none" style={[index > 0 && styles.layerAbs, order]}>
      <Animated.View style={[styles.card, move]}>
        <View style={styles.photo}>
          {proof.selfieUrl
            ? <DualPhoto main={{ uri: proof.thumbUrl ?? proof.photoUrl, hash: proof.thumbHash }} selfie={selfieOf(proof)} style={StyleSheet.absoluteFill} inset="small" interactive={false} />
            : <Photo thumb={proof.thumbUrl} full={proof.photoUrl} hash={proof.thumbHash} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />}
          <Animated.View style={[StyleSheet.absoluteFill, extras]}>
            {/* Top-right, clear of the selfie inset (top-left): the count, then the event badge. */}
            {(city.count > 1 || !!badge) && (
              <View style={styles.corner}>
                {city.count > 1 && (
                  <View style={styles.pill}>
                    <Ionicons name={!counter && players > 0 && players >= city.count ? 'people' : 'camera'} size={12} color={colors.white} />
                    <Text style={styles.pillText} numberOfLines={1}>
                      {counter ? `${(index % total) + 1}/${total}`
                        : players <= 0 ? city.count
                        : players >= city.count ? t('mosaic.players', { count: players })
                        : `${city.count} · ${t('mosaic.players', { count: players })}`}
                    </Text>
                  </View>
                )}
                {!!badge && <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={styles.badgeText}>{badge}</Text></View>}
              </View>
            )}
            {/* Which photo of the pile is on top. */}
            {dots > 1 && (
              <View style={styles.dots}>
                {Array.from({ length: Math.min(dots, MAX_SEGMENTS) }, (_, i) => <View key={i} style={[styles.dot, i === index % MAX_SEGMENTS && styles.dotOn]} />)}
              </View>
            )}
          </Animated.View>
        </View>
        <Animated.View style={[styles.tileBody, extras]}>
          <View style={styles.cityRow}>
            <FlagSticker country={city.city.country} size={16} />
            <Text style={styles.city} numberOfLines={1}>{shortCityName(city.city.name)}</Text>
          </View>
          <Text style={styles.answer} numberOfLines={2}>{lineOf(proof, i18n.language)}</Text>
          <View style={styles.foot}>
            <View style={styles.avatars}>
              <View style={styles.avatar}>
                <Avatar uri={proof.user.photoUrl ?? null} name={proof.user.displayName || proof.user.username || ''} size={20} />
              </View>
            </View>
            <View style={styles.votes}>
              {comments > 0 && (
                <>
                  <Ionicons name="chatbubble-outline" size={14} color={colors.muted} />
                  <Text style={[styles.votesText, styles.commentsText]}>{comments}</Text>
                </>
              )}
              <Ionicons name={state?.myVote ? 'heart' : 'heart-outline'} size={15} color={state?.myVote ? colors.primary : colors.muted} />
              <Text style={styles.votesText}>{likes}</Text>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
});

// The city's photos for its pile (best first, the top one already there), fetched once per
// city and kept for the session: the card's back photos and what a swipe brings to the front.
const pileCache = new Map<string, DailyProof>();
/** A pile photo already loaded on Today (the story viewer opens on it at once). */
export const cachedPileProof = (id: string): DailyProof | undefined => pileCache.get(id);
const pileAsked = new Set<string>();
const PILE_MAX = 8;
function usePilePhotos(group: DailyCityGroup, guestId: string | null): DailyProof[] {
  const ids = group.ids.slice(0, PILE_MAX);
  const [, bump] = useState(0);
  const key = ids.join(',');
  useEffect(() => {
    const missing = ids.filter(id => id !== group.top.id && !pileCache.has(id) && !pileAsked.has(id));
    if (!missing.length) return;
    missing.forEach(id => pileAsked.add(id));
    let live = true;
    fetchDailyProofsByIds(missing, guestId)
      .then(list => { seedProofs(list, true); list.forEach(x => pileCache.set(x.id, x)); if (live) bump(v => v + 1); })
      .catch(() => missing.forEach(id => pileAsked.delete(id)));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return ids.map(id => (id === group.top.id ? group.top : pileCache.get(id))).filter((x): x is DailyProof => !!x);
}

// Has this phone ever swiped a pile? Until then, the nudge and the hint show the swipe.
// null while the flag is read.
const SWIPED_KEY = 'has_swiped_stack';
let swipedStack: boolean | null = null;
let swipedRead = false;
const swipedListeners = new Set<() => void>();
const setSwiped = (v: boolean) => { swipedStack = v; swipedListeners.forEach(l => l()); };
const subscribeSwiped = (l: () => void) => {
  swipedListeners.add(l);
  if (!swipedRead) {
    swipedRead = true;
    AsyncStorage.getItem(SWIPED_KEY).then(v => { if (swipedStack === null) setSwiped(v === '1'); }).catch(() => {});
  }
  return () => { swipedListeners.delete(l); };
};
function useSwipedStack(): boolean | null {
  return useSyncExternalStore(subscribeSwiped, () => swipedStack);
}
function markSwiped() {
  if (swipedStack === true) return;
  setSwiped(true);
  AsyncStorage.setItem(SWIPED_KEY, '1').catch(() => {});
}
// One nudge a visit: the first swipeable pile shown.
let nudged = false;
function claimNudge(): boolean {
  if (nudged) return false;
  nudged = true;
  return true;
}

/** My city's empty slot: "Saigon is missing! Represent your city" (or, first of all, "Represent Saigon"). */
function SlotCard({ city, first, label, onPress }: { city: string | null; first: boolean; label?: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const title = first ? (city ? t('mosaic.beFirst', { city }) : t(label ?? 'countries.represent'))
    : city ? t('mosaic.missing', { city }) : t(label ?? 'countries.represent');
  // Under the title: the call when the title names the city, else nothing to repeat.
  const sub = first ? t('mosaic.beFirstSub') : city ? t(label ?? 'countries.represent') : null;
  return (
    <TouchableOpacity style={[styles.cardWrap, styles.slot]} onPress={onPress} accessibilityRole="button" testID="represent-tile"
                      accessibilityLabel={[title, sub].filter(Boolean).join('. ')}>
      <View style={styles.camera}><Ionicons name="camera-outline" size={28} color={colors.primaryText} /></View>
      <Text style={styles.slotTitle}>{title}</Text>
      {!!sub && <Text style={styles.slotSub}>{sub}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { gap: 14 },
  block:     { gap: 8 },
  row:       { gap: 14, paddingVertical: 4, paddingRight: 4 },
  story:     { width: CIRCLE + 8, alignItems: 'center', gap: 6 },
  ringBox:   { width: CIRCLE, height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
  ring:      { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: RING, alignItems: 'center', justifyContent: 'center' },
  inner:     { width: CIRCLE - 10, height: CIRCLE - 10, borderRadius: (CIRCLE - 10) / 2, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  dashed:    { borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  countBadge: { position: 'absolute', right: -2, bottom: -2, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5,
                alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.bg },
  countText: { fontSize: 11, fontWeight: '800' },
  storyName: { fontSize: 12, fontWeight: '700', color: c.text, maxWidth: CIRCLE + 8 },
  storySeen: { color: c.muted },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16, paddingTop: 4 },
  cardWrap:  { width: '48.5%' },
  faded:     { opacity: 0.55 },
  // The polaroid pile: theme-colored sheets peeking out behind the card.
  layer:     { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16, opacity: 0.55 },
  layerBack: { transform: [{ rotate: '5deg' }, { translateX: 8 }, { translateY: -2 }] },
  layerBack2: { opacity: 0.3, transform: [{ rotate: '-5deg' }, { translateX: -7 }, { translateY: 3 }] },
  // A back sheet showing its photo: opaque, its edge in the theme color.
  // Every photo of a pile but the first lies over it (the first gives the card its size).
  layerAbs:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dots:      { position: 'absolute', bottom: 6, alignSelf: 'center', flexDirection: 'row', gap: 4, paddingHorizontal: 6, paddingVertical: 4,
               borderRadius: 8, backgroundColor: c.photoPill },
  dot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: c.photoControl },
  dotOn:     { backgroundColor: c.white },
  card:      { borderRadius: 16, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  photo:     { width: '100%', aspectRatio: 1, backgroundColor: c.bg3 },
  // Leaves the left 30 % to the selfie inset (24 % + its margin); a long count truncates.
  corner:    { position: 'absolute', top: 6, right: 6, left: '30%', flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  pill:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 1,
               borderRadius: 12, backgroundColor: c.photoPill },
  pillText:  { fontSize: 11, fontWeight: '800', color: c.white, flexShrink: 1 },
  badge:     { width: 28, height: 28, borderRadius: 14, backgroundColor: c.photoControl,
               alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 16 },
  tileBody:  { padding: 10, gap: 4 },
  cityRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  city:      { flexShrink: 1, fontSize: 13, fontWeight: '700', color: c.text },
  answer:    { fontSize: FontSizes.lg, lineHeight: 22, fontWeight: '800', color: c.text, minHeight: 44 },
  foot:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  avatars:   { flexDirection: 'row', alignItems: 'center' },
  avatar:    { borderRadius: 12, borderWidth: 2, borderColor: c.bg2 },
  avatarOverlap: { marginLeft: -7 },
  more:      { marginLeft: 4, fontSize: 12, fontWeight: '700', color: c.muted },
  votes:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  votesText: { fontSize: 13, fontWeight: '700', color: c.muted },
  commentsText: { marginRight: 6 },
  slot:      { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 8, padding: Spacing.md, borderRadius: 16,
               borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  camera:    { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  slotTitle: { fontSize: FontSizes.md, fontWeight: '800', color: c.primaryOnTint, textAlign: 'center' },
  slotSub:   { fontSize: 13, fontWeight: '600', color: c.primaryOnTint, textAlign: 'center' },
  invite:    { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.muted },
  hint:      { fontSize: 13, fontWeight: '600', color: c.muted, textAlign: 'center' },
});
