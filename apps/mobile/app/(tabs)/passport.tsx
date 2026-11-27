import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import type { ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Spacing, Type, IconSize, type ThemeColors, type ThemeName } from '@/constants';
import { HeaderInbox } from '@/features/shell/HeaderInbox';
import { Avatar, AvatarSize, Button, Card, CityFlag, IconButton, ListRow, ModeLabel, RowGroup, ScreenHeader, Tappable } from '@/ui';
import { themeColor, tint } from '@/ui/joy';
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
import { fetchMySpots } from '@/api/passport';
import { CityPage } from '@/features/passport/CityPage';
import { SpecialStamps } from '@/features/passport/SpecialStamps';
import { PioneerBadges } from '@/features/passport/PioneerBadges';
import { PointsHelpSheet } from '@/features/passport/PointsHelpSheet';
import { CrewCard, InvitedBy, SeasonMedals, WeekCard } from '@/features/passport/ScoringCards';
import type { DailyLocalPassProgress, DailyUserStats } from '@/types';
import i18n from '@/i18n';
import { ordinal } from '@/lib/ordinal';

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
// The Passport's numbers from the last visit, per account and city (in memory).
const passportCache = new Map<string, { at: number; stats: DailyUserStats | null; counts: Counts }>();
const PASSPORT_FRESH_MS = 60_000;
const EMPTY_COUNTS: Counts = { spots: null, proposals: null, friends: null, week: null, alltime: null };

/** A menu row's color: a theme's pair (its fill for the disc, its text color for the icon). */
function toneOf(key: string, mode: ThemeName) {
  const tc = themeColor(key);
  return { fill: tc.fill, ink: mode === 'dark' ? tc.textDark : tc.textLight };
}

export default function PassportScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme: mode } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const scroller = useRef<ScrollViewInstance>(null);
  const focused = useRef(false);
  const { account, identity, city } = useApp();
  const today = useDailyToday(city?.channelId);
  const cacheKey = account ? `${account.id}|${city?.channelId ?? ''}` : '';
  // Shown at once from the last visit (stale-while-revalidate), refreshed below.
  const [stats, setStats]   = useState<DailyUserStats | null>(() => passportCache.get(cacheKey)?.stats ?? null);
  const [counts, setCounts] = useState<Counts>(() => passportCache.get(cacheKey)?.counts ?? EMPTY_COUNTS);
  const [help, setHelp]     = useState(false);
  const [page, setPage]     = useState(0);
  const [share, setShare]   = useState<ShareContent | null>(null);
  // The first answer for this account + city has landed (or a cached one exists): until then the
  // numbers below are skeletons, never defaults shown as real ("0-day streak", "0 of 7 stamps").
  const [loadedKey, setLoadedKey] = useState<string | null>(() => (passportCache.get(cacheKey) ? cacheKey : null));
  const ready = loadedKey === cacheKey || !!passportCache.get(cacheKey);

  const cityKey = city?.channelId ? (String(city.channelId).startsWith('city_') ? String(city.channelId) : `city_${city.channelId}`) : null;
  const cityNum = cityKey ? Number(cityKey.slice(5)) : null;
  const cityName = city?.name ? shortCityName(city.name) : null;

  // On focus: the cached numbers right away; fetched again when older than a minute, all six
  // requests together and set once (one render, not six).
  useFocusEffect(useCallback(() => {
    if (!account) return;
    const cached = passportCache.get(cacheKey);
    if (cached) { setStats(cached.stats); setCounts(cached.counts); }
    if (cached && Date.now() - cached.at < PASSPORT_FRESH_MS) return;
    let alive = true;
    const val = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
    Promise.allSettled([
      fetchUserDaily(account.id),
      fetchMySpots(),
      fetchMyProposals(),
      fetchUserFriends(account.id, 1, 1),
      // Scoring v2: this season's rank (the leaderboard's "month" is the season, by challenge date).
      fetchLeaderboard({ scope: cityKey ? 'city' : 'world', period: 'month', limit: 1, cityId: cityKey ?? undefined }),
      fetchLeaderboard({ scope: cityKey ? 'city' : 'world', period: 'alltime', limit: 1, cityId: cityKey ?? undefined }),
    ]).then(([st, sp, pr, fr, wk, at]) => {
      if (!alive) return;
      const prev = passportCache.get(cacheKey);
      const s1 = val(st) ?? prev?.stats ?? null;
      const p = val(pr);
      const c: Counts = {
        spots:     val(sp)?.length ?? prev?.counts.spots ?? null,
        proposals: p ? p.items.filter(x => x.status === 'pending').length : prev?.counts.proposals ?? null,
        friends:   val(fr)?.total ?? prev?.counts.friends ?? null,
        week:      val(wk)?.me?.rank ?? prev?.counts.week ?? null,
        alltime:   val(at)?.me?.rank ?? prev?.counts.alltime ?? null,
      };
      passportCache.set(cacheKey, { at: Date.now(), stats: s1, counts: c });
      setStats(s1);
      setCounts(c);
      setLoadedKey(cacheKey);
    });
    return () => { alive = false; };
  }, [account, cityKey, cacheKey]));

  const header = (
    <ScreenHeader variant="tab" title={t('passport.title')} subtitle={t('subtitles.passport', { ns: 'common' })} art="passport"
                  right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm }}>
                    <HeaderInbox />
                    <IconButton icon="settings-outline" iconSize={21} label={t('settings')} onPress={() => router.push('/settings' as never)} testID="passport-settings" />
                  </View>} />
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
      <ScrollView ref={scroller} contentContainerStyle={styles.body}>
        <Identity
          name={account.username ? `@${account.username}` : account.display_name}
          photo={account.thumbAvatarUrl ?? account.profile_photo_url ?? null}
          mode={account.mode ?? null}
          cityName={home ? shortCityName(home.name ?? '') : cityName}
          cityCountry={home ? home.country : city?.country ?? null}
          since={since}
          stats={stats ? { cities: stats.citiesPlayed ?? null, photos: stats.photos ?? stats.completed, likes: stats.likesReceived ?? null }
            : ready ? null : { cities: null, photos: null, likes: null }}
        />
        {!!stats?.invitedBy && <InvitedBy by={stats.invitedBy} />}

        {!ready ? <PassportSkeleton /> : (<>
        {/* Streak and weekly rank: two cards of one height, an icon disc, the title on two lines at most. */}
        <View style={styles.cards}>
          <Card style={styles.card}>
            <View style={[styles.cardDisc, { backgroundColor: tint(colors.cta, 0.24) }]}>
              <Ionicons name={streak ? 'flame' : 'flame-outline'} size={IconSize.md} color={colors.primaryText} />
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>{t('streak', { ns: 'daily', count: streak })}</Text>
            <Text style={styles.cardSub} numberOfLines={1}>{t('passport.best', { count: stats?.bestStreak ?? 0 })}</Text>
          </Card>
          {/* Scoring v2: this season's rank, opens Ranks › Players › This season. */}
          <Tappable style={styles.cardTap} accessibilityRole="button" testID="passport-week-rank"
                    onPress={() => router.navigate(`/ranks?tab=players&period=season&scope=${cityKey ? 'city' : 'world'}` as never)}>
            <Card style={[styles.card, styles.cardFill]}>
              <View style={[styles.cardDisc, { backgroundColor: tint(colors.medalGold, 0.28) }]}>
                <Ionicons name="trophy" size={IconSize.md} color={colors.gold} />
              </View>
              <Text style={styles.cardTitle} numberOfLines={2}>{counts.week ? t('passport.seasonRank', { rank: counts.week }) : t('passport.seasonNone')}</Text>
              <Text style={styles.cardSub} numberOfLines={1}>{cityName ? t('passport.mostLocalIn', { city: cityName }) : t('passport.mostLocalWorld')}</Text>
            </Card>
          </Tappable>
        </View>
        {/* Scoring v2: this week's Perfect week, the crew, the season medals. */}
        {!!stats?.week && (
          // "?focus=week" (How it works › Perfect week) scrolls to this card once it's laid out.
          <View onLayout={e => { if (focus === 'week' && !focused.current) { focused.current = true; scroller.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 12), animated: true }); } }}>
            <WeekCard week={stats.week} />
          </View>
        )}
        <CrewCard />
        {(stats?.seasonMedals?.length ?? 0) > 0 && <SeasonMedals medals={stats!.seasonMedals!} />}
        {/* Your rivals moved to World › Cities (UX audit: one place to compare cities). */}
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

        </>)}
        {(stats?.pioneerOf?.length ?? 0) > 0 && <PioneerBadges pioneers={stats!.pioneerOf!} />}
        {(stats?.specialStamps?.length ?? 0) > 0 && <SpecialStamps stamps={stats!.specialStamps!} />}

        {/* Notifications and Messages: in the header (the bell, the messages button), on every tab. */}
        <RowGroup>
          <ListRow icon="images-outline" tone={toneOf('taste', mode)} title={t('passport.myPhotos')} value={stats?.photos !== undefined ? String(stats.photos) : ''} onPress={() => router.push('/my-photos' as never)} />
          <ListRow divider icon="location-outline" tone={toneOf('local_find', mode)} title={t('passport.mySpots')} value={counts.spots !== null ? String(counts.spots) : ''} onPress={() => router.push('/my-spots' as never)} />
          <ListRow divider icon="bulb-outline" tone={toneOf('sip', mode)} title={t('passport.myProposals')} value={counts.proposals ? t('passport.inReview', { count: counts.proposals }) : ''} onPress={() => router.push('/daily/proposals' as never)} />
          {/* Propose a challenge lives here now (moved from Today, V3 polish 3.3). */}
          <ListRow divider icon="add-circle-outline" tone={{ fill: colors.cta, ink: colors.primaryText }} title={t('propose.cta', { ns: 'daily' })} onPress={() => router.push('/daily/propose?source=passport' as never)} />
          <ListRow divider icon="people-outline" tone={toneOf('night_out', mode)} title={t('passport.friends')} value={counts.friends !== null ? String(counts.friends) : ''} onPress={() => router.push('/friends' as never)} />
          <ListRow divider title={t('passport.mostLocalAllTime')}
                   icon={counts.alltime && counts.alltime <= 3 ? undefined : 'trophy-outline'} tone={{ fill: colors.medalGold, ink: colors.gold }}
                   leading={counts.alltime && counts.alltime <= 3 ? <RankMedal rank={counts.alltime} size={36} /> : undefined}
                   value={counts.alltime ? (cityName ? t('passport.allTimeRank', { rank: counts.alltime, city: cityName }) : ordinal(counts.alltime, i18n.language)) : ''}
                   onPress={() => router.navigate(`/ranks?tab=players&period=alltime&scope=${cityKey ? 'city' : 'world'}` as never)} />
        </RowGroup>

        <Button icon="share-social-outline" label={t('passport.share')} onPress={sharePassport} testID="passport-share" />
        {/* My profile as other players see it (the same screen, no actions). */}
        <Button variant="link" icon="eye-outline" label={t('passport.viewAsOthers')} onPress={() => router.push(`/user/${account.id}?preview=1` as never)} style={styles.center} testID="passport-view-as-others" />
        <Button variant="link" icon="help-circle-outline" label={t('passport.howPoints')} onPress={() => setHelp(true)} style={styles.center} />
      </ScrollView>
      <PointsHelpSheet visible={help} onClose={() => setHelp(false)} />
      <ShareSheet content={share} source="passport" onClose={() => setShare(null)} />
    </SafeAreaView>
  );
}

/** While the Passport's first answer is on its way: its two cards and a stamp page, as quiet blocks. */
function PassportSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View accessibilityLabel="…" style={{ gap: Space.md }}>
      <View style={styles.cards}>
        <View style={[styles.card, styles.skelBlock, { height: 120 }]} />
        <View style={[styles.card, styles.skelBlock, { height: 120 }]} />
      </View>
      <View style={[styles.skelBlock, { height: 230 }]} />
    </View>
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
    <View style={styles.identityWrap}>
      <View style={styles.identity}>
        {/* A seasonal event's live day: the passport photo wears the hat. */}
        <View><Avatar uri={photo ? thumbUrl(photo) : null} name={name} size={AvatarSize.lg} ring /><LogoHat logoSize={AvatarSize.lg} /></View>
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
        </View>
      </View>
      {/* Cities, photos, likes: the passport's numbers, large (design pass), under the identity. */}
      {stats && (
        <View style={styles.stats}>
          {([['cities', stats.cities], ['photos', stats.photos], ['likes', stats.likes]] as const).map(([k, n], i) => (
            <View key={k} style={[styles.stat, i > 0 && styles.statDivider]}>
              <Text style={styles.statN}>{n ?? '–'}</Text>
              <Text style={styles.statLabel} numberOfLines={1}>{t(`passportStats.${k}`, { ns: 'me', count: n ?? 0 })}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  skelBlock: { borderRadius: Radius.card, backgroundColor: c.bg3 },
  container:      { flex: 1, backgroundColor: c.bg },
  body:           { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl, gap: Space.lg },
  identityWrap:   { gap: Space.lg },
  identity:       { flexDirection: 'row', alignItems: 'center', gap: Space.lg },
  identityBody:   { flex: 1, gap: Space.sm },
  name:           { ...Type.title, color: c.text },
  chips:          { flexDirection: 'row', gap: Space.sm, flexWrap: 'wrap' },
  chip:           { flexDirection: 'row', alignItems: 'center', gap: Space.xs, height: 26, paddingHorizontal: Space.md, borderRadius: Radius.control },
  chipCity:       { backgroundColor: c.bg3, maxWidth: 200 },
  chipCityText:   { ...Type.caption, color: c.muted },
  cards:          { flexDirection: 'row', gap: Space.md, alignItems: 'stretch' },
  card:           { flex: 1, padding: Space.lg, gap: Space.xs },
  cardDisc:       { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: Space.xs },
  cardTap:        { flex: 1 },
  cardFill:       { flex: 1 },
  cardTitle:      { ...Type.label, color: c.text },
  cardSub:        { ...Type.caption, fontWeight: '500', color: c.muted },
  pagesWrap:      { gap: Space.sm },
  dots:           { flexDirection: 'row', justifyContent: 'center', gap: Space.sm },
  dot:            { width: 7, height: 7, borderRadius: 4, backgroundColor: c.line },
  dotOn:          { backgroundColor: c.primary, width: 18 },
  since:          { ...Type.caption, fontWeight: '500', color: c.muted },
  stats:          { flexDirection: 'row', paddingVertical: Space.md, borderRadius: Radius.card, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.line },
  stat:           { flex: 1, alignItems: 'center', gap: Space.xxs, paddingHorizontal: Space.sm },
  statDivider:    { borderLeftWidth: 1, borderLeftColor: c.line },
  statN:          { ...Type.display, color: c.text },
  statLabel:      { ...Type.caption, color: c.muted },
  pages:          { gap: Space.md },
  center:         { alignSelf: 'center' },
  guest:          { gap: Space.md, padding: Space.lg, borderRadius: Radius.card },
  guestTitle:     { ...Type.title, color: c.text },
  guestBody:      { ...Type.body, color: c.muted },
});
