import { useCallback, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { Avatar, Button, Card, CityFlag, IconButton, ListRow, ModeLabel, RowGroup, ScreenHeader } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { thumbUrl } from '@/lib/imageThumb';
import { useDailyToday } from '@/hooks/useDaily';
import { fetchMyProposals, fetchUserDaily } from '@/api/daily';
import { fetchUserFriends } from '@/api/users';
import { fetchLeaderboard } from '@/api/leaderboard';
import { fetchMySpots, fetchWeeklyRank } from '@/api/passport';
import { CityPage } from '@/features/passport/CityPage';
import { PointsHelpSheet } from '@/features/passport/PointsHelpSheet';
import type { DailyLocalPassProgress, DailyUserStats } from '@/types';

interface Counts { spots: number | null; proposals: number | null; friends: number | null; week: number | null; alltime: number | null }

/**
 * PASSPORT (SPEC 9.7, passport.html), replacing MY PROFILE: identity (avatar,
 * username, Local / Exploring, city), streak and weekly rank, one page per
 * city with the 7 theme stamps and the Local Pass seal, then My spots, My
 * proposals, Friends and Most Local all time. Settings behind the gear; "How
 * points work" as a help sheet. Guests get an invitation to start theirs.
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

  const cityKey = city?.channelId ? (String(city.channelId).startsWith('city_') ? String(city.channelId) : `city_${city.channelId}`) : null;
  const cityNum = cityKey ? Number(cityKey.slice(5)) : null;
  const cityName = city?.name ? localizeCityName(city.name) : null;

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
    <ScreenHeader variant="tab" title={t('passport.title')} subtitle={t('subtitles.passport', { ns: 'common' })}
                  right={<IconButton icon="settings-outline" iconSize={21} label={t('settings')} onPress={() => router.push('/settings' as never)} />} />
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
  const todayTheme = today.data?.challenge?.theme?.key ?? null;
  const tomorrow = today.data?.tomorrow?.theme ?? null;
  const streak = stats?.currentStreak ?? today.data?.streak ?? 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}
      <ScrollView contentContainerStyle={styles.body}>
        <Identity
          name={account.username ? `@${account.username}` : account.display_name}
          photo={account.thumbAvatarUrl ?? account.profile_photo_url ?? null}
          mode={account.mode ?? null}
          cityName={cityName}
          cityCountry={city?.country ?? null}
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

        {progress.length > 1 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={pageWidth + 10} decelerationRate="fast"
                      contentContainerStyle={styles.pages}>
            {progress.map(p => (
              <CityPage key={p.city.id} width={pageWidth} cityName={localizeCityName(p.city.name ?? '')} country={p.city.country} themes={p.themes} earned={p.earned}
                        todayTheme={p.city.id === cityNum ? todayTheme : null} tomorrowTheme={p.city.id === cityNum ? tomorrow : null} />
            ))}
          </ScrollView>
        ) : progress.length === 1 ? (
          <CityPage cityName={localizeCityName(progress[0].city.name ?? '')} country={progress[0].city.country} themes={progress[0].themes} earned={progress[0].earned}
                    todayTheme={todayTheme} tomorrowTheme={tomorrow} />
        ) : null}

        <RowGroup>
          <ListRow title={t('passport.mySpots')} value={counts.spots !== null ? String(counts.spots) : ''} onPress={() => router.push('/my-spots' as never)} />
          <ListRow divider title={t('passport.myProposals')} value={counts.proposals ? t('passport.inReview', { count: counts.proposals }) : ''} onPress={() => router.push('/daily/proposals' as never)} />
          <ListRow divider title={t('passport.friends')} value={counts.friends !== null ? String(counts.friends) : ''} onPress={() => router.push('/friends' as never)} />
          <ListRow divider title={t('passport.mostLocalAllTime')}
                   value={counts.alltime ? (cityName ? t('passport.allTimeRank', { rank: counts.alltime, city: cityName }) : `#${counts.alltime}`) : ''}
                   onPress={() => router.push(`/leaderboard?scope=${cityKey ? 'city' : 'world'}&period=alltime` as never)} />
        </RowGroup>

        <Button variant="link" icon="help-circle-outline" label={t('passport.howPoints')} onPress={() => setHelp(true)} style={styles.center} />
      </ScrollView>
      <PointsHelpSheet visible={help} onClose={() => setHelp(false)} />
    </SafeAreaView>
  );
}

function Identity({ name, photo, mode, cityName, cityCountry }: {
  name: string; photo: string | null; mode: string | null; cityName: string | null; cityCountry: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const local = mode === 'local';
  return (
    <View style={styles.identity}>
      <Avatar uri={photo ? thumbUrl(photo) : null} name={name} size={64} ring />
      <View style={styles.identityBody}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
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
  pages:          { gap: 10 },
  center:         { alignSelf: 'center' },
  guest:          { gap: 10, padding: 16, borderRadius: 20 },
  guestTitle:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  guestBody:      { fontSize: FontSizes.sm, color: c.muted },
});
