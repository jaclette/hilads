import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchDailyTodayCountries } from '@/api/daily';
import { shortCityName } from '@/i18n/cityName';
import { answerText } from '@/features/compare/format';
import { hasUnseen, useSeen } from '@/features/daily/seen';
import { compareCountryGroups } from '@/features/daily/countryOrder';
import { seedProofs, useVoteState } from '@/features/daily/votes';
import { useHere } from '@/hooks/useDaily';
import { track } from '@/services/analytics';
import { Photo, SectionTitle } from '@/ui';
import { FlagSticker, themeColor } from '@/ui/joy';
import type { DailyCountryGroup, DailyToday, DailyTodayCountries } from '@/types';

const CIRCLE = 64;
const MOSAIC_MAX = 6;

let last: DailyTodayCountries | null = null;
/** The last country list Today showed: Today's photos follows its story order. */
export function lastCountries(): DailyTodayCountries | null { return last; }

/**
 * Today's photos by country, right under the hero (one request,
 * GET /daily/today/countries):
 * - the stories row, "[n] countries played today": one circle per country
 *   (its flag, the city under it), a ring in today's theme color while one of
 *   its photos is unseen (neutral once all are seen), then "+ Your city"
 *   (play, or my photo once posted). A circle opens Today's photos at that
 *   country, the next countries following (a story).
 * - the mosaic, "Same challenge. Different worlds.": up to 6 countries, each
 *   with its most voted photo, its answer in large text and its votes (my
 *   country first, then the most voted: compareCountryGroups); "See all" opens every
 *   country's photos; "Represent your city" until I play: the free slot of an odd grid,
 *   else a banner under it.
 * Nobody played yet: only "Represent your city" with an invitation. Players'
 * photos only (never a Hilads pick).
 */
export function TodayCountries({ today, refreshKey }: { today: DailyToday | null; refreshKey: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const here = useHere();
  useSeen();
  const [data, setData] = useState<DailyTodayCountries | null>(last);
  const challenge = today?.challenge ?? null;
  const guestId = account ? null : identity?.guestId ?? null;

  const load = useCallback(async () => {
    if (!challenge) return;
    try {
      // My country first: where I am, else the city I'm browsing.
      const next = await fetchDailyTodayCountries({ cityId: here?.id ?? today?.city?.id ?? null, guestId });
      seedProofs(next.items.map(i => i.top), challenge.isActive);
      last = next;
      setData(next);
    } catch { /* keep what we have */ }
  }, [challenge?.id, challenge?.isActive, here?.id, today?.city?.id, guestId]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!challenge || !data) return null;
  // The server's order, kept fresh as photos get seen here: my country, then unseen, then the most recent.
  const mine = (here?.country ?? today?.city?.country ?? '').toUpperCase();
  const items = [...data.items].sort((a, b) =>
    Number(b.country === mine) - Number(a.country === mine)
    || Number(hasUnseen(b)) - Number(hasUnseen(a))
    || b.latestAt - a.latestAt);
  // The shared country order (never the stories'): my country first, then the top photo's votes,
  // the country's photos, the most recent; at most 6.
  const tiles = [...data.items].sort((a, b) => compareCountryGroups(a, b, mine)).slice(0, MOSAIC_MAX);
  const theme = themeColor(challenge.special ? 'special' : challenge.theme?.key);
  const ring = theme.line ?? theme.fill;
  const myProof = today?.myProof ?? null;
  const canPlay = challenge.isActive && !myProof;

  const play = () => {
    track('today_countries_play', { has_photos: items.length > 0 });
    router.push((account ? '/daily/proof' : '/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof') as never);
  };
  const openCountry = (g: DailyCountryGroup) => {
    track('today_countries_story', { country: g.country, unseen: hasUnseen(g) });
    router.push(`/daily/photos?country=${g.country}&source=today_stories` as never);
  };
  const openTile = (g: DailyCountryGroup) => {
    track('today_countries_tile', { country: g.country });
    router.push(`/daily/photos?proof=${g.top.id}&source=today_mosaic` as never);
  };
  const yourCity = () => {
    if (myProof) router.push(`/daily/photos?proof=${myProof.id}&source=today_stories` as never);
    else play();
  };

  return (
    <View style={styles.wrap} testID="today-countries">
      {items.length > 0 && (
        <View style={styles.block}>
          <SectionTitle small title={t('countries.played', { count: items.length })} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {items.map(g => {
              const unseen = hasUnseen(g);
              return (
                <TouchableOpacity key={g.country} style={styles.story} onPress={() => openCountry(g)} accessibilityRole="button"
                                  testID="country-story" accessibilityLabel={t('countries.openCountry', { city: shortCityName(g.city.name) })}>
                  <View style={[styles.ring, { borderColor: unseen ? ring : colors.line }]}>
                    <View style={styles.inner}><FlagSticker country={g.country} size={CIRCLE - 22} /></View>
                  </View>
                  <Text style={[styles.storyName, !unseen && styles.storySeen]} numberOfLines={1}>{shortCityName(g.city.name)}</Text>
                </TouchableOpacity>
              );
            })}
            {(canPlay || myProof) && (
              <TouchableOpacity style={styles.story} onPress={yourCity} accessibilityRole="button" testID="country-story-mine"
                                accessibilityLabel={myProof ? t('vote.yours') : t('countries.represent')}>
                <View style={[styles.ring, styles.dashed]}>
                  <Ionicons name={myProof ? 'image-outline' : 'add'} size={28} color={colors.primaryText} />
                </View>
                <Text style={styles.storyName} numberOfLines={1}>{t('countries.yourCity')}</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {(items.length > 0 || canPlay) && (
        <View style={styles.block}>
          <SectionTitle small title={t('worlds.tagline')}
                        action={items.length > 0 ? { label: t('today.seeAll'), onPress: () => router.push('/daily/countries?source=today_mosaic' as never) } : undefined} />
          {items.length === 0 && <Text style={styles.invite}>{t('countries.emptyBody')}</Text>}
          <View style={styles.grid}>
            {tiles.map(g => <Tile key={g.country} group={g} onPress={() => openTile(g)} />)}
            {/* An odd grid: "Represent your city" fills its free slot. */}
            {canPlay && tiles.length % 2 === 1 && (
              <TouchableOpacity style={[styles.tile, styles.representTile]} onPress={play} accessibilityRole="button" testID="represent-tile">
                <View style={styles.camera}><Ionicons name="camera-outline" size={28} color={colors.primaryText} /></View>
                <Text style={styles.representText}>{t('countries.represent')}</Text>
              </TouchableOpacity>
            )}
          </View>
          {/* An even grid (or none): a shorter full-width banner under it, no lone half row. */}
          {canPlay && tiles.length % 2 === 0 && (
            <TouchableOpacity style={styles.representBanner} onPress={play} accessibilityRole="button" testID="represent-tile">
              <View style={styles.camera}><Ionicons name="camera-outline" size={26} color={colors.primaryText} /></View>
              <Text style={[styles.representText, styles.representBannerText]}>{t('countries.represent')}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.primaryText} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

/** A mosaic tile: the country's most voted photo, its flag and city, its answer (else the caption) large, its votes. */
function Tile({ group, onPress }: { group: DailyCountryGroup; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { i18n } = useTranslation('daily');
  const { account, identity } = useApp();
  const state = useVoteState(group.top.id, account ? null : identity?.guestId ?? null);
  const p = group.top;
  const line = p.answer && !p.backHome ? answerText(p.answer, i18n.language) : p.caption ?? p.spot?.name ?? p.place?.name ?? '';
  const votes = state?.voteCount ?? p.voteCount;
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} accessibilityRole="button" testID="mosaic-tile"
                      accessibilityLabel={[shortCityName(group.city.name), line, String(votes)].filter(Boolean).join(', ')}>
      <View style={styles.photo}>
        <Photo thumb={p.thumbUrl} full={p.photoUrl} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
      </View>
      <View style={styles.tileBody}>
        <View style={styles.cityRow}>
          <FlagSticker country={group.country} size={16} />
          <Text style={styles.city} numberOfLines={1}>{shortCityName(group.city.name)}</Text>
        </View>
        <Text style={styles.answer} numberOfLines={2}>{line}</Text>
        <View style={styles.votes}>
          <Ionicons name={state?.myVote ? 'heart' : 'heart-outline'} size={15} color={state?.myVote ? colors.primary : colors.muted} />
          <Text style={styles.votesText}>{votes}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { gap: 14 },
  block:     { gap: 8 },
  row:       { gap: 14, paddingVertical: 2, paddingRight: 4 },
  story:     { width: CIRCLE + 8, alignItems: 'center', gap: 6 },
  ring:      { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  inner:     { width: CIRCLE - 10, height: CIRCLE - 10, borderRadius: (CIRCLE - 10) / 2, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  dashed:    { borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  storyName: { fontSize: 12, fontWeight: '700', color: c.text, maxWidth: CIRCLE + 8 },
  storySeen: { fontWeight: '700', color: c.muted },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  tile:      { width: '48.5%', borderRadius: 16, overflow: 'hidden', backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  photo:     { width: '100%', aspectRatio: 1, backgroundColor: c.bg3 },
  tileBody:  { padding: 10, gap: 4 },
  cityRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  city:      { flexShrink: 1, fontSize: 13, fontWeight: '700', color: c.text },
  answer:    { fontSize: FontSizes.lg, lineHeight: 22, fontWeight: '800', color: c.text, minHeight: 44 },
  votes:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  votesText: { fontSize: 13, fontWeight: '700', color: c.muted },
  representTile: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10, padding: Spacing.md,
                   borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  representBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16,
                     borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  representBannerText: { flex: 1, textAlign: 'left' },
  camera:    { width: 52, height: 52, borderRadius: 26, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  representText: { fontSize: FontSizes.md, fontWeight: '800', color: c.primaryOnTint, textAlign: 'center' },
  invite:    { fontSize: 14, lineHeight: 20, fontWeight: '500', color: c.muted },
});
