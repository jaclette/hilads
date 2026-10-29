import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyTour } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { answerText } from '@/features/compare/format';
import { hasUnseen, isSeen, useSeen } from '@/features/daily/seen';
import { useVoteState } from '@/features/daily/votes';
import { useHere } from '@/hooks/useDaily';
import { useSeasonalLive } from '@/features/event/seasonal';
import { lastTour, rememberTour } from '@/features/tour/store';
import { track } from '@/services/analytics';
import { Avatar, Photo, SectionTitle } from '@/ui';
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
 *   behind it when the city has several photos ("2 · 2 players"), its answer
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
  const [tour, setTour] = useState<DailyTour | null>(lastTour());
  useEffect(() => {
    if (!challenge || cities.length > 0 || tour) return;
    fetchDailyTour({ cityId: here?.id ?? today?.city?.id ?? null, guestId: account ? null : identity?.guestId ?? null })
      .then(x => { rememberTour(x); setTour(x); }).catch(() => {});
  }, [challenge?.id, cities.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const openCity = (g: DailyCityGroup, source: 'today_stories' | 'today_mosaic') => {
    track(source === 'today_stories' ? 'today_countries_story' : 'today_countries_tile', { country: g.city.country, unseen: hasUnseen(g) });
    router.push(`/daily/stories?city=${g.city.id}&source=${source}` as never);
  };
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
                <TouchableOpacity key={g.city.id} style={styles.story} onPress={() => openCity(g, 'today_stories')} accessibilityRole="button"
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
              ? cards.map(g => <CityCard key={g.city.id} group={g} pileColor={theme.fill} badge={seasonal?.theme.emoji} onPress={() => openCity(g, 'today_mosaic')} />)
              : yesterday.map(s => <CityCard key={s.city.id} faded pileColor={theme.fill} group={{
                  city: { id: s.city.id, name: s.city.name, country: s.city.country ?? '' }, count: s.count, authorCount: null,
                  authors: [], totalLikes: null, latestAt: 0, unseen: false, ids: [s.proof.id], top: s.proof,
                }} onPress={() => router.push('/daily/tour?source=today_empty' as never)} />)}
          </View>
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

/**
 * A city's card: its most liked photo (a polaroid pile behind it when the city
 * has several), its answer large, its players and its likes. `faded`:
 * yesterday's card in the empty state.
 */
function CityCard({ group, onPress, pileColor, badge, faded = false }: {
  group: DailyCityGroup; onPress: () => void; pileColor: string; badge?: string; faded?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const { account, identity } = useApp();
  const state = useVoteState(group.top.id, account ? null : identity?.guestId ?? null);
  const p: DailyProof = group.top;
  const line = p.answer && !p.backHome ? answerText(p.answer, i18n.language) : p.caption ?? p.spot?.name ?? p.place?.name ?? '';
  const likes = group.totalLikes ?? state?.voteCount ?? p.voteCount;
  const pile = group.count > 1;
  const players = group.authorCount ?? 0;
  const more = players - group.authors.length;
  return (
    <TouchableOpacity style={[styles.cardWrap, { transform: [{ rotate: `${lean(group.city.id)}deg` }] }, faded && styles.faded]} onPress={onPress}
                      accessibilityRole="button" testID="mosaic-tile"
                      accessibilityLabel={[shortCityName(group.city.name), line, pile ? t('mosaic.players', { count: players }) : null, String(likes)].filter(Boolean).join(', ')}>
      {pile && <View style={[styles.layer, styles.layerBack, { backgroundColor: pileColor }]} />}
      {pile && group.count > 2 && <View style={[styles.layer, styles.layerBack2, { backgroundColor: pileColor }]} />}
      <View style={styles.card}>
        <View style={styles.photo}>
          <Photo thumb={p.thumbUrl} full={p.photoUrl} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
          {pile && (
            <View style={styles.pill}>
              <Ionicons name="camera" size={12} color={colors.white} />
              <Text style={styles.pillText}>{players > 0 ? `${group.count} · ${t('mosaic.players', { count: players })}` : group.count}</Text>
            </View>
          )}
          {!!badge && <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={styles.badgeText}>{badge}</Text></View>}
        </View>
        <View style={styles.tileBody}>
          <View style={styles.cityRow}>
            <FlagSticker country={group.city.country} size={16} />
            <Text style={styles.city} numberOfLines={1}>{shortCityName(group.city.name)}</Text>
          </View>
          <Text style={styles.answer} numberOfLines={2}>{line}</Text>
          <View style={styles.foot}>
            <View style={styles.avatars}>
              {group.authors.map((a, i) => (
                <View key={a.id} style={[styles.avatar, i > 0 && styles.avatarOverlap]}>
                  <Avatar uri={a.photoUrl} name={a.displayName || a.username || ''} size={20} />
                </View>
              ))}
              {more > 0 && <Text style={styles.more}>+{more}</Text>}
            </View>
            <View style={styles.votes}>
              <Ionicons name={state?.myVote ? 'heart' : 'heart-outline'} size={15} color={state?.myVote ? colors.primary : colors.muted} />
              <Text style={styles.votesText}>{likes}</Text>
            </View>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
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
  layerBack: { transform: [{ rotate: '4deg' }, { translateX: 4 }, { translateY: 2 }] },
  layerBack2: { opacity: 0.3, transform: [{ rotate: '-4deg' }, { translateX: -4 }, { translateY: 3 }] },
  card:      { borderRadius: 16, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  photo:     { width: '100%', aspectRatio: 1, backgroundColor: c.bg3 },
  pill:      { position: 'absolute', left: 6, top: 6, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4,
               borderRadius: 12, backgroundColor: c.photoControl },
  pillText:  { fontSize: 11, fontWeight: '800', color: c.white },
  badge:     { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: c.photoControl,
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
  slot:      { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 8, padding: Spacing.md, borderRadius: 16,
               borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  camera:    { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  slotTitle: { fontSize: FontSizes.md, fontWeight: '800', color: c.primaryOnTint, textAlign: 'center' },
  slotSub:   { fontSize: 13, fontWeight: '600', color: c.primaryOnTint, textAlign: 'center' },
  invite:    { fontSize: 14, lineHeight: 20, fontWeight: '600', color: c.muted },
});
