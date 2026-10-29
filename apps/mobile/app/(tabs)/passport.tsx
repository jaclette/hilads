import { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { Avatar, Button, Card, CityFlag, IconButton, ListRow, ModeLabel, RowGroup, ScreenHeader } from '@/ui';
import { FlagSticker } from '@/ui/joy';
import { RankMedal } from '@/features/daily/RankMedal';
import { ShareSheet } from '@/features/share/ShareSheet';
import type { ShareContent } from '@/features/share/content';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { LogoHat } from '@/features/event/SeasonalArt';
import { useApp } from '@/context/AppContext';
import { shortCityName } from '@/i18n/cityName';
import { thumbUrl } from '@/lib/imageThumb';
import { useDailyToday } from '@/hooks/useDaily';
import { fetchMyProposals, fetchUserDaily } from '@/api/daily';
import { fetchUserFriends } from '@/api/users';
import { fetchLeaderboard } from '@/api/leaderboard';
import { fetchMySpots, fetchWeeklyRank } from '@/api/passport';
import { CityPage } from '@/features/passport/CityPage';
import { SpecialStamps } from '@/features/passport/SpecialStamps';
import { PioneerBadges } from '@/features/passport/PioneerBadges';
import { PointsHelpSheet } from '@/features/passport/PointsHelpSheet';
import type { DailyLocalPassProgress, DailyUserStats } from '@/types';

interface Counts { spots: number | null; proposals: number | null; friends: number | null; week: number | null; alltime: number | null }

/**
 * PASSPORT (SPEC 9.7, V3 polish 6), a real, shareable passport: identity
 * (avatar, @username, home city, "Local of Saigon since…", cities, photos and
 * likes received), streak and weekly rank, the flags of the cities I've been
 * compared with, one page per city (swipe, with dots) with the 7 stamps in
 * their theme colors (tap: the photo that earned it) and the Local Pass apart,
 * then My photos, My spots, My proposals (+ Propose), Friends and Most Local
 * all time (a medal for the podium), and "Share my passport". Settings
 * behind the gear; "How points work" as a help sheet. Guests get an
 * invitation to start theirs.
 */
export default function PassportScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { account, identity, city } = useApp();
  const today = useDailyToday(city?.channelId);
  const [stats, setStats]   = useState<DailyUserStats | null>(null);
  const [counts, setCounts] = useState<Counts>({ spots: null, proposals: null, friends: null, week: null, alltime: null });
  const [help, setHelp]     = useState(false);
  const [page, setPage]     = useState(0);
  const [share, setShare]   = useState<ShareContent | null>(null);

  const cityKey = city?.channelId ? (String(city.channelId).startsWith('city_') ? String(city.channelId) : `city_${city.channelId}`) : null;
  const cityNum = cityKey ? Number(cityKey.slice(5)) : null;
  const cityName = city?.name ? shortCityName(city.name) : null;

  useFocusEffect(useCallback(() => {
    if (!account) return;
    let alive = true;
    const set = (patch: Partial<Counts>) => { if (alive) setCounts(c => ({ ...c, ...patch })); };
    fetchUserDaily(account.id).then(s => { if (alive) setStats(s); }).catch(() => {});
    fetchMySpots().then(s => set({ spots: s.length })).catch(() => {});
    fetchMyProposals().then(p => set({ proposals: p.items.filter(x => x.status === 'pending').length })).catch(() => {});
    fetchUserFriends(account.id, 1, 1).then(f => set({ friends: f.total })).catch(() => {});
    fetchWeeklyRank(cityKey).then(r => set({ week: r.rank })).catch(() => {});
    fetchLeaderboard({ scope: cityKey ? 'city' : 'world', period: 'alltime', limit: 1, cityId: cityKey ?? undefined })
      .then(r => set({ alltime: r?.me?.rank ?? null })).catch(() => {});
    return () => { alive = false; };
  }, [account, cityKey]));

  const header = (
    <ScreenHeader variant="tab" title={t('passport.title')} subtitle={t('subtitles.passport', { ns: 'common' })} art="passport"
                  right={<IconButton icon="settings-outline" iconSize={21} label={t('settings')} onPress={() => router.push('/settings' as never)} testID="passport-settings" />} />
  );

  if (!account) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <ScrollView contentContainerStyle={styles.body}>
          <Identity name={identity?.nickname ?? '-'} photo={null} mode={identity?.mode ?? null} cityName={cityName} cityCountry={city?.country ?? null} />
          <Card variant="ticket" style={styles.guest}>
            <Text style={styles.guestTitle}>{t('passport.guestTitle')}</Text>
            <Text style={styles.guestBody}>{t('passport.guestBody')}</Text>
            <Button label={t('passport.signUp')} onPress={() => router.push('/sign-up' as never)} />
            <Button variant="link" label={t('passport.signIn')} onPress={() => router.push('/sign-in' as never)} style={styles.center} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // City pages: every city with stamps, the current city first (even with none).
  const progress: DailyLocalPassProgress[] = [...(stats?.localPassProgress ?? [])];
  if (cityNum !== null && !progress.some(p => p.city.id === cityNum)) {
    progress.unshift({ city: { id: cityNum, name: city?.name ?? null, country: city?.country ?? null }, done: 0, total: 7, themes: [], earned: false });
  }
  progress.sort((a, b) => (a.city.id === cityNum ? -1 : b.city.id === cityNum ? 1 : b.done - a.done));
  const pageWidth = width - Spacing.md * 2;
  // A special day earns its own stamp, not one of the 7.
  const todayKey = today.data?.challenge?.theme?.key ?? null;
  const todayTheme = todayKey === 'special' ? null : todayKey;
  const tomorrow = today.data?.tomorrow?.theme ?? null;
  const streak = stats?.currentStreak ?? today.data?.streak ?? 0;
  const home = stats?.homeCity ?? null;
  // "Local of Saigon since March 2026": my home city (else the city shown) and when I joined.
  const sinceCity = home?.name ? shortCityName(home.name) : cityName;
  const since = stats?.memberSince && sinceCity && account.mode === 'local'
    ? t('passport.localSince', { city: sinceCity, date: new Date(stats.memberSince * 1000).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) })
    : null;
  const openStamp = (s: { date: string; proofId: string }) => router.push(`/daily/${s.date}?proof=${s.proofId}` as never);
  const sharePassport = () => {
    const first = progress[0];
    setShare({
      type: 'passport', photoUrl: account.profile_photo_url ?? null, theme: null, text: t('passport.title'),
      city: first ? { name: first.city.name, country: first.city.country ?? null } : city ? { name: city.name, country: city.country } : null,
      username: account.username ?? null, stamps: first?.themes ?? [], earned: !!first?.earned,
      stats: { cities: stats?.citiesPlayed ?? 0, photos: stats?.photos ?? stats?.completed ?? 0, likes: stats?.likesReceived ?? 0 },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <Identity
          name={account.username ? `@${account.username}` : account.display_name}
          photo={account.thumbAvatarUrl ?? account.profile_photo_url ?? null}
          mode={account.mode ?? null}
          cityName={home ? shortCityName(home.name ?? '') : cityName}
          cityCountry={home ? home.country : city?.country ?? null}
          since={since}
          stats={stats ? { cities: stats.citiesPlayed ?? null, photos: stats.photos ?? stats.completed, likes: stats.likesReceived ?? null } : null}
        />

        <View style={styles.cards}>
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="flame-outline" size={18} color={colors.text} />
              <Text style={styles.cardTitle}>{t('streak', { ns: 'daily', count: streak })}</Text>
            </View>
            <Text style={styles.cardSub}>{t('passport.best', { count: stats?.bestStreak ?? 0 })}</Text>
          </Card>
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="trophy-outline" size={18} color={colors.text} />
              <Text style={styles.cardTitle}>{counts.week ? t('passport.weekRank', { rank: counts.week }) : t('passport.weekNone')}</Text>
            </View>
            <Text style={styles.cardSub} numberOfLines={1}>{cityName ? t('passport.mostLocalIn', { city: cityName }) : t('passport.mostLocalWorld')}</Text>
          </Card>
        </View>
        {/* The cities I've been compared with: their flags (a tap opens that city's photos today). */}
        {(stats?.comparedCities?.length ?? 0) > 0 ? (
          <View style={styles.comparedBlock}>
            <Text style={styles.comparedText}>{t('passport.comparedCities', { count: stats!.comparedCities!.length })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.flagsRow}>
              {stats!.comparedCities!.map(c => (
                <TouchableOpacity key={c.id} style={styles.flagChip} onPress={() => router.push(`/daily/stories?city=${c.id}&name=${encodeURIComponent(c.name ?? '')}&source=passport` as never)}
                                  accessibilityRole="button" accessibilityLabel={c.name ?? ''}>
                  <FlagSticker country={c.country} size={22} />
                  <Text style={styles.flagName} numberOfLines={1}>{shortCityName(c.name ?? '')}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : (stats?.comparedCountries ?? 0) > 0 && (
          <View style={styles.compared}>
            <Ionicons name="earth-outline" size={16} color={colors.muted} />
            <Text style={styles.comparedText}>{t('passport.compared', { count: stats!.comparedCountries })}</Text>
          </View>
        )}

        {progress.length > 1 ? (
          <View style={styles.pagesWrap}>
            {/* One page per city: snaps page by page (no pagingEnabled: the pages are narrower than the screen). */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={pageWidth + 10} decelerationRate="fast"
                        contentContainerStyle={styles.pages}
                        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / (pageWidth + 10)))}>
              {progress.map(p => (
                <CityPage key={p.city.id} width={pageWidth} cityName={shortCityName(p.city.name ?? '')} country={p.city.country} themes={p.themes}
                          stamps={p.stamps} total={p.total} earned={p.earned} onStamp={openStamp}
                          todayTheme={p.city.id === cityNum ? todayTheme : null} tomorrowTheme={p.city.id === cityNum ? tomorrow : null} />
              ))}
            </ScrollView>
            <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {progress.map((p, i) => <View key={p.city.id} style={[styles.dot, i === page && styles.dotOn]} />)}
            </View>
          </View>
        ) : progress.length === 1 ? (
          <CityPage cityName={shortCityName(progress[0].city.name ?? '')} country={progress[0].city.country} themes={progress[0].themes}
                    stamps={progress[0].stamps} total={progress[0].total} earned={progress[0].earned} onStamp={openStamp}
                    todayTheme={todayTheme} tomorrowTheme={tomorrow} />
        ) : null}

        {(stats?.pioneerOf?.length ?? 0) > 0 && <PioneerBadges pioneers={stats!.pioneerOf!} />}
        {(stats?.specialStamps?.length ?? 0) > 0 && <SpecialStamps stamps={stats!.specialStamps!} />}

        <RowGroup>
          <ListRow title={t('passport.myPhotos')} value={stats?.photos !== undefined ? String(stats.photos) : ''} onPress={() => router.push('/my-photos' as never)} />
          <ListRow divider title={t('passport.mySpots')} value={counts.spots !== null ? String(counts.spots) : ''} onPress={() => router.push('/my-spots' as never)} />
          <ListRow divider title={t('passport.myProposals')} value={counts.proposals ? t('passport.inReview', { count: counts.proposals }) : ''} onPress={() => router.push('/daily/proposals' as never)} />
          {/* Propose a challenge lives here now (moved from Today, V3 polish 3.3). */}
          <ListRow divider icon="add-circle-outline" title={t('propose.cta', { ns: 'daily' })} onPress={() => router.push('/daily/propose?source=passport' as never)} />
          <ListRow divider title={t('passport.friends')} value={counts.friends !== null ? String(counts.friends) : ''} onPress={() => router.push('/friends' as never)} />
          <ListRow divider title={t('passport.mostLocalAllTime')}
                   leading={counts.alltime && counts.alltime <= 3 ? <RankMedal rank={counts.alltime} size={26} /> : undefined}
                   value={counts.alltime ? (cityName ? t('passport.allTimeRank', { rank: counts.alltime, city: cityName }) : `#${counts.alltime}`) : ''}
                   onPress={() => router.push(`/leaderboard?scope=${cityKey ? 'city' : 'world'}&period=alltime` as never)} />
        </RowGroup>

        <Button icon="share-social-outline" label={t('passport.share')} onPress={sharePassport} testID="passport-share" />
        <Button variant="link" icon="help-circle-outline" label={t('passport.howPoints')} onPress={() => setHelp(true)} style={styles.center} />
      </ScrollView>
      <PointsHelpSheet visible={help} onClose={() => setHelp(false)} />
      <ShareSheet content={share} source="passport" onClose={() => setShare(null)} />
    </SafeAreaView>
  );
}

function Identity({ name, photo, mode, cityName, cityCountry, since = null, stats = null }: {
  name: string; photo: string | null; mode: string | null; cityName: string | null; cityCountry: string | null;
  /** "Local of Saigon since March 2026". */
  since?: string | null;
  stats?: { cities: number | null; photos: number | null; likes: number | null } | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const local = mode === 'local';
  return (
    <View style={styles.identity}>
      {/* A seasonal event's live day: the passport photo wears the hat. */}
      <View><Avatar uri={photo ? thumbUrl(photo) : null} name={name} size={64} ring /><LogoHat logoSize={64} /></View>
      <View style={styles.identityBody}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {!!since && <Text style={styles.since} numberOfLines={1}>{since}</Text>}
        <View style={styles.chips}>
          {mode && <ModeLabel mode={local ? 'local' : 'traveler'} label={t(`mode.${local ? 'local' : 'exploring'}.label`)} />}
          {cityName && (
            <View style={[styles.chip, styles.chipCity]}>
              {cityCountry ? <CityFlag country={cityCountry} size={14} /> : <Ionicons name="location-outline" size={13} color={colors.muted} />}
              <Text style={styles.chipCityText} numberOfLines={1}>{cityName}</Text>
            </View>
          )}
        </View>
        {stats && (
          <View style={styles.stats}>
            {([['cities', stats.cities], ['photos', stats.photos], ['likes', stats.likes]] as const).map(([k, n]) => n !== null && (
              <Text key={k} style={styles.stat}><Text style={styles.statN}>{n}</Text> {t(`passportStats.${k}`, { ns: 'me', count: n })}</Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:      { flex: 1, backgroundColor: c.bg },
  body:           { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl, gap: 14 },
  identity:       { flexDirection: 'row', alignItems: 'center', gap: 14 },
  identityBody:   { flex: 1, gap: 6 },
  name:           { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  chips:          { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 10, borderRadius: Radius.full },
  chipCity:       { backgroundColor: c.bg3, maxWidth: 200 },
  chipCityText:   { fontSize: 12, fontWeight: '600', color: c.muted },
  cards:          { flexDirection: 'row', gap: 10 },
  card:           { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  cardHead:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle:      { flexShrink: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  cardSub:        { fontSize: FontSizes.xs, color: c.muted },
  compared:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  comparedBlock:  { gap: 8 },
  flagsRow:       { gap: 8 },
  flagChip:       { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 6, paddingRight: 12, borderRadius: Radius.full,
                    borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  flagName:       { fontSize: 13, fontWeight: '700', color: c.text, maxWidth: 120 },
  pagesWrap:      { gap: 8 },
  dots:           { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot:            { width: 7, height: 7, borderRadius: 4, backgroundColor: c.line },
  dotOn:          { backgroundColor: c.primary, width: 18 },
  since:          { fontSize: 13, fontWeight: '600', color: c.muted },
  stats:          { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  stat:           { fontSize: 13, fontWeight: '600', color: c.muted },
  statN:          { fontWeight: '800', color: c.text },
  comparedText:   { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },
  pages:          { gap: 10 },
  center:         { alignSelf: 'center' },
  guest:          { gap: 10, padding: 16, borderRadius: 20 },
  guestTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  guestBody:      { fontSize: FontSizes.sm, color: c.muted },
});
