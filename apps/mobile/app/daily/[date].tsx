import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { canAccessProfile } from '@/lib/profileAccess';
import { track } from '@/services/analytics';
import { deleteDailyProof, fetchDailyProof, fetchDailyToday } from '@/api/daily';
import { formatCountdown, isFinalHours, useCountdown, useDailySheet } from '@/hooks/useDaily';
import { DailyProofTile } from '@/features/daily/DailyProofTile';
import { DailyLeaderboardPanel } from '@/features/daily/DailyLeaderboardPanel';
import { DailyProofViewer } from '@/features/daily/DailyProofViewer';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { formatAmount } from '@/features/daily/currency';
import { dailyTrackProps } from '@/features/daily/track';
import { OriginalToggle, useOriginal } from '@/features/daily/OriginalToggle';
import { THEME_ICON } from '@/features/today/format';
import { ProposedBy } from '@/features/daily/DailyChannelCard';
import { Avatar, Button, Card, Chip, EmptyState, Screen, ScreenHeader, Segmented } from '@/ui';
import type { DailyProof } from '@/types';
import { themeName } from '@/features/daily/themes';

/**
 * Daily Challenge sheet (/daily/today or /daily/YYYY-MM-DD). Challenge,
 * context, Local Twist and its author, my proof, practical info from approved
 * proofs, and tabs: the proofs (World / City, City only for live cities) and
 * the Top 10 (live leaderboard while active, the official podium once closed;
 * closed sheets open on it). ?proof=<id> opens that proof on arrival;
 * ?tab=top10 opens the Top 10 tab (top 10 push, hero card's top 3).
 */
export default function DailySheetScreen() {
  const { date: dateParam, proof: proofParam, source, tab } = useLocalSearchParams<{ date: string; proof?: string; source?: string; tab?: string }>();
  const { city } = useApp();
  const [date, setDate] = useState<string | null>(dateParam && dateParam !== 'today' ? dateParam : null);

  // /daily/today: resolve today's date first (the sheet API is by date).
  useEffect(() => {
    if (date) return;
    fetchDailyToday(city?.channelId)
      .then(d => setDate(d.challenge?.date ?? 'none'))
      .catch(() => setDate('none'));
  }, [date, city?.channelId]);

  if (!date) return <Loading />;
  return <Sheet date={date} openProofId={proofParam ?? null} source={source ?? null} initialTab={tab === 'top10' ? 'top10' : null} />;
}

function Loading() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return <Screen><View style={styles.center}><ActivityIndicator color={colors.primary} /></View></Screen>;
}

type Tab = 'world' | 'city' | 'top10';

function Sheet({ date, openProofId, source, initialTab }: {
  date: string; openProofId: string | null; source: string | null; initialTab: 'top10' | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { city, account } = useApp();
  const [scope, setScope] = useState<'world' | 'city'>('world');   // proofs shown by the World / City tabs
  const [tab, setTab] = useState<Tab>(initialTab ?? 'world');
  const [viewing, setViewing] = useState<DailyProof | null>(null);
  const { sheet, loading, loadingMore, error, reload, loadMore, setMyProof } = useDailySheet(date, scope, city?.channelId);
  const secondsLeft = useCountdown(sheet?.challenge?.isActive ? sheet.challenge.endsAt : null, sheet?.serverTime);
  const tracked = useRef(false);
  const [showOriginal, toggleOriginal] = useOriginal();

  useEffect(() => {
    if (!sheet?.challenge || tracked.current) return;
    tracked.current = true;
    const props = dailyTrackProps(sheet, account?.mode);
    track('daily_challenge_viewed', { source: source ?? (openProofId ? 'proof_link' : 'sheet'), ...props });
    if (source === 'link') track('daily_link_opened', props);
  }, [sheet, openProofId, source, account?.mode]);

  // ?proof=<id>: open it once (from the list, or fetched if not on this page).
  const opened = useRef(false);
  useEffect(() => {
    if (!openProofId || opened.current || !sheet) return;
    opened.current = true;
    const local = sheet.proofs.find(p => p.id === openProofId) ?? (sheet.myProof?.id === openProofId ? sheet.myProof : null);
    if (local) { setViewing(local); return; }
    fetchDailyProof(openProofId).then(setViewing).catch(() => {});
  }, [openProofId, sheet]);

  // A closed challenge opens on its podium (Top 10 tab), once.
  const tabDefaulted = useRef(initialTab !== null);
  useEffect(() => {
    if (!sheet?.challenge || tabDefaulted.current) return;
    tabDefaulted.current = true;
    if (!sheet.challenge.isActive) setTab('top10');
  }, [sheet]);

  const selectTab = (next: Tab) => {
    setTab(next);
    if (next !== 'top10') setScope(next);
  };

  const openProofById = useCallback((proofId: string) => {
    const known = [...(sheet?.proofs ?? []), sheet?.myProof, ...(sheet?.results?.world ?? []), ...(sheet?.results?.cities ?? [])]
      .find(p => p?.id === proofId);
    if (known) { setViewing(known); return; }
    fetchDailyProof(proofId).then(setViewing).catch(() => {});
  }, [sheet]);

  const isLive = !!sheet?.city?.isLive;
  const cityName = sheet?.city?.name ? localizeCityName(sheet.city.name) : '';
  const challenge = sheet?.challenge ?? null;
  const myProof = sheet?.myProof ?? null;

  const goProfile = useCallback((userId: string) => {
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${userId}` as never);
  }, [account, router]);

  const onCta = () => {
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    router.push('/daily/proof' as never);
  };

  const onDelete = () => {
    if (!myProof) return;
    Alert.alert(t('deleteTitle'), t('deleteBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          try {
            await deleteDailyProof(myProof.id);
            setMyProof(null);
            reload();
          } catch {
            Alert.alert(t('errors.generic'));
          }
        },
      },
    ]);
  };

  const header = useMemo(() => {
    if (!sheet || !challenge) return null;
    const priceRange = sheet.practical.priceRanges[0];
    const places = sheet.practical.places;
    return (
      <View style={styles.headerWrap}>
        <Card variant="ticket" style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.iconRow}>
              <Ionicons name="flame" size={14} color={colors.primaryText} />
              <Text style={styles.kicker}>{t('kicker')}</Text>
            </View>
            <View style={styles.iconRow}>
              {challenge.isActive && secondsLeft !== null && (
                <Ionicons name="time-outline" size={14} color={isFinalHours(secondsLeft) ? colors.warning : colors.muted} />
              )}
              <Text style={[styles.countdown, challenge.isActive && isFinalHours(secondsLeft) && styles.countdownWarn]}>
                {challenge.isActive && secondsLeft !== null ? t('timeLeft', { time: formatCountdown(secondsLeft) }) : t('closed')}
              </Text>
            </View>
          </View>
          {!!challenge.theme && <Chip icon={THEME_ICON[challenge.theme.key] ?? 'pricetag-outline'} label={themeName(challenge.theme.key)} style={styles.theme} />}
          <Text style={styles.text}>{showOriginal && challenge.original ? challenge.original.text : challenge.text}</Text>
          {!!challenge.context && (
            <Text style={styles.context}>{showOriginal && challenge.original ? challenge.original.context : challenge.context}</Text>
          )}
          <OriginalToggle translated={!!challenge.original || !!sheet.twist?.originalText} showingOriginal={showOriginal} onPress={toggleOriginal} />
          {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}

          {sheet.twist && isLive && (
            <View style={styles.twist}>
              <View style={styles.iconRow}>
                <Ionicons name="location-outline" size={14} color={colors.primaryText} />
                <Text style={styles.twistLabel}>{t('twistIn', { city: cityName })}</Text>
              </View>
              <Text style={styles.twistText}>{showOriginal && sheet.twist.originalText ? sheet.twist.originalText : sheet.twist.text}</Text>
              {sheet.twist.author ? (
                <TouchableOpacity style={styles.author} onPress={() => goProfile(sheet.twist!.author!.id)} accessibilityRole="button">
                  <Avatar uri={sheet.twist.author.photoUrl} name={sheet.twist.author.displayName || sheet.twist.author.username || '?'} size={24} />
                  <Text style={styles.authorText}>{t('twistBy', { name: sheet.twist.author.displayName || sheet.twist.author.username })}</Text>
                </TouchableOpacity>
              ) : !!sheet.twist.credit && (
                <Text style={styles.authorText}>{t('twistBy', { name: sheet.twist.credit })}</Text>
              )}
            </View>
          )}

          {myProof ? (
            <View style={styles.mine}>
              <Image source={{ uri: myProof.thumbUrl ?? myProof.photoUrl }} style={styles.mineThumb} contentFit="cover" />
              <View style={styles.mineBody}>
                <Text style={styles.mineTitle}>{t('yourProof')}</Text>
                <DailyStatusChip status={myProof.status} />
                {myProof.status === 'pending' && <Text style={styles.hint}>{t('pendingHint')}</Text>}
                {!!myProof.rejectionReason && <Text style={styles.reason}>{t('reasonLabel', { reason: myProof.rejectionReason })}</Text>}
                <View style={styles.mineActions}>
                  {challenge.isActive && myProof.status !== 'removed' && (
                    <Button variant="link" label={myProof.status === 'rejected' ? t('fixIt') : t('edit')}
                            onPress={() => router.push(`/daily/proof?edit=${myProof.id}` as never)} />
                  )}
                  <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} accessibilityRole="button">
                    <Text style={styles.linkDanger}>{t('delete')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : challenge.isActive && (
            <Button icon="camera-outline" label={t('cta')} onPress={onCta} />
          )}
        </Card>

        {(priceRange || places.length > 0) && (
          <Card style={styles.practical}>
            <Text style={styles.sectionTitle}>{t('practicalTitle')}</Text>
            {priceRange && (
              <View style={styles.iconRow}>
              <Ionicons name="cash-outline" size={16} color={colors.muted} />
              <Text style={styles.practicalLine}>
                {priceRange.min === priceRange.max
                  ? t('priceOne', { amount: formatAmount(priceRange.min, i18n.language), currency: priceRange.currency })
                  : t('priceRange', { min: formatAmount(priceRange.min, i18n.language), max: formatAmount(priceRange.max, i18n.language), currency: priceRange.currency })}
                {priceRange.count ? ` · ${t('priceFrom', { count: priceRange.count })}` : ''}
              </Text>
              </View>
            )}
            {places.length > 0 && (
              <>
                <View style={styles.iconRow}>
                  <Ionicons name="location-outline" size={16} color={colors.muted} />
                  <Text style={styles.practicalLine}>{t('places', { count: places.length })}</Text>
                </View>
                <Button variant="secondary" size="sm" icon="map-outline" label={t('map.see')}
                        onPress={() => router.push('/(tabs)/map?source=sheet' as never)} style={styles.mapCta} />
                {places.slice(0, 5).map(p => (
                  <TouchableOpacity key={p.proofId} onPress={() => {
                    const proof = sheet.proofs.find(x => x.id === p.proofId);
                    if (proof) setViewing(proof); else fetchDailyProof(p.proofId).then(setViewing).catch(() => {});
                  }} style={styles.placeRow} accessibilityRole="button">
                    <Text style={styles.place} numberOfLines={1}>{p.name || t('unnamedPlace')}</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.muted} />
                  </TouchableOpacity>
                ))}
              </>
            )}
          </Card>
        )}

        <Segmented<Tab>
          options={(isLive ? ['world', 'city', 'top10'] as const : ['world', 'top10'] as const).map(k => ({
            key: k, label: k === 'world' ? t('tabWorld') : k === 'city' ? cityName : t('leaderboard.tab'),
          }))}
          value={tab}
          onChange={selectTab}
        />
      </View>
    );
  }, [sheet, challenge, myProof, isLive, cityName, scope, tab, secondsLeft, styles, t, i18n.language, router, goProfile, account, setMyProof, reload, showOriginal, toggleOriginal, date]);

  return (
    <Screen>
      <ScreenHeader title={t('kicker')} right={<Text style={styles.navDate}>{challenge?.date ?? ''}</Text>} />

      {loading && !sheet ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : error || !challenge ? (
        <View style={styles.center}>
          <EmptyState
            icon={error === 'failed' ? 'cloud-offline-outline' : 'calendar-clear-outline'}
            body={error === 'failed' ? t('loadFailed') : t('notFound')}
            action={error === 'failed' ? <Button variant="secondary" size="sm" label={t('retry')} onPress={reload} /> : undefined}
          />
        </View>
      ) : (
        <FlatList
          data={tab === 'top10' ? [] : sheet!.proofs}
          keyExtractor={p => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          renderItem={({ item }) => <DailyProofTile proof={item} onPress={() => setViewing(item)} />}
          onEndReached={tab === 'top10' ? undefined : loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={styles.more} /> : null}
          ListEmptyComponent={tab === 'top10' ? (
            <DailyLeaderboardPanel
              sheet={sheet!}
              secondsLeft={secondsLeft}
              source={source === 'push' && initialTab ? 'push' : 'sheet_tab'}
              onOpenProof={openProofById}
            />
          ) : (
            <EmptyState icon="camera-outline" title={t('beFirst')} body={t('beFirstSub')} />
          )}
        />
      )}

      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: Spacing.md },
  navDate:      { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  list:         { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 40, gap: 10 },
  row:          { gap: 10 },
  headerWrap:   { gap: 12, marginBottom: 4 },
  card:         { padding: 16, gap: 10 },
  topRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  iconRow:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker:       { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.primaryText },
  countdown:    { fontSize: 12, fontWeight: '700', color: c.muted },
  countdownWarn:{ color: c.warning },
  text:         { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, lineHeight: 26 },
  theme:        { alignSelf: 'flex-start' },
  context:      { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, lineHeight: 20 },
  twist:        { backgroundColor: c.primaryTint, borderRadius: Radius.button, padding: 12, gap: 6 },
  twistLabel:   { fontSize: 12, fontWeight: '800', color: c.primaryOnTint },
  twistText:    { fontSize: FontSizes.sm, fontWeight: '500', color: c.text },
  author:       { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  authorText:   { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  mine:         { flexDirection: 'row', gap: 12, backgroundColor: c.bg, borderRadius: Radius.button, borderWidth: Border, borderColor: c.line, padding: 10 },
  mineThumb:    { width: 72, height: 72, borderRadius: 12, backgroundColor: c.bg3 },
  mineBody:     { flex: 1, gap: 4 },
  mineTitle:    { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  mineActions:  { flexDirection: 'row', alignItems: 'center', gap: 20 },
  deleteBtn:    { minHeight: 44, justifyContent: 'center' },
  linkDanger:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.red },
  hint:         { fontSize: 12, fontWeight: '500', color: c.muted },
  reason:       { fontSize: 12, fontWeight: '600', color: c.red },
  practical:    { padding: 14, gap: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.text },
  practicalLine:{ flex: 1, fontSize: FontSizes.sm, fontWeight: '500', color: c.text },
  mapCta:       { alignSelf: 'flex-start', marginVertical: 4 },
  placeRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingLeft: 22 },
  place:        { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '600', color: c.muted },
  more:         { marginVertical: 16 },
});
