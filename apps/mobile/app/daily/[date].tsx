import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { canAccessProfile } from '@/lib/profileAccess';
import { track } from '@/services/analytics';
import { deleteDailyProof, fetchDailyProof, fetchDailyToday } from '@/api/daily';
import { formatCountdown, useCountdown, useDailySheet } from '@/hooks/useDaily';
import { DailyProofTile, MEDALS } from '@/features/daily/DailyProofTile';
import { DailyProofViewer } from '@/features/daily/DailyProofViewer';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { formatAmount } from '@/features/daily/currency';
import { dailyTrackProps } from '@/features/daily/track';
import { OriginalToggle, useOriginal } from '@/features/daily/OriginalToggle';
import { DailyPlacesMap } from '@/features/daily/DailyPlacesMap';
import type { DailyProof } from '@/types';

/**
 * Daily Challenge sheet (/daily/today or /daily/YYYY-MM-DD). Challenge,
 * context, Local Twist and its author, my proof, practical info from approved
 * proofs, the results once closed (World top 3, best of each live city), and
 * the proofs with World / City tabs (City only for live cities).
 * ?proof=<id> opens that proof on arrival.
 */
export default function DailySheetScreen() {
  const { date: dateParam, proof: proofParam, source } = useLocalSearchParams<{ date: string; proof?: string; source?: string }>();
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
  return <Sheet date={date} openProofId={proofParam ?? null} source={source ?? null} />;
}

function Loading() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return <SafeAreaView style={[styles.container, styles.center]}><ActivityIndicator color={colors.accent} /></SafeAreaView>;
}

function Sheet({ date, openProofId, source }: { date: string; openProofId: string | null; source: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { city, account } = useApp();
  const [scope, setScope] = useState<'world' | 'city'>('world');
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
        <View style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.kicker}>🔥 {t('kicker')}</Text>
            <Text style={styles.countdown}>
              {challenge.isActive && secondsLeft !== null ? `⏱ ${t('timeLeft', { time: formatCountdown(secondsLeft) })}` : t('closed')}
            </Text>
          </View>
          <Text style={styles.text}>{showOriginal && challenge.original ? challenge.original.text : challenge.text}</Text>
          {!!challenge.context && (
            <Text style={styles.context}>{showOriginal && challenge.original ? challenge.original.context : challenge.context}</Text>
          )}
          <OriginalToggle translated={!!challenge.original || !!sheet.twist?.originalText} showingOriginal={showOriginal} onPress={toggleOriginal} />

          {sheet.twist && isLive && (
            <View style={styles.twist}>
              <Text style={styles.twistLabel}>📍 {t('twistIn', { city: cityName })}</Text>
              <Text style={styles.twistText}>{showOriginal && sheet.twist.originalText ? sheet.twist.originalText : sheet.twist.text}</Text>
              {sheet.twist.author ? (
                <TouchableOpacity style={styles.author} onPress={() => goProfile(sheet.twist!.author!.id)} accessibilityRole="button">
                  {sheet.twist.author.photoUrl
                    ? <Image source={{ uri: sheet.twist.author.photoUrl }} style={styles.avatar} />
                    : <View style={[styles.avatar, styles.avatarEmpty]} />}
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
                    <TouchableOpacity onPress={() => router.push(`/daily/proof?edit=${myProof.id}` as never)} accessibilityRole="button">
                      <Text style={styles.link}>{myProof.status === 'rejected' ? t('fixIt') : t('edit')}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={onDelete} accessibilityRole="button">
                    <Text style={[styles.link, styles.linkDanger]}>{t('delete')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : challenge.isActive && (
            <TouchableOpacity style={styles.cta} onPress={onCta} activeOpacity={0.85} accessibilityRole="button">
              <Text style={styles.ctaText}>{t('cta')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {sheet.results && (
          <View style={styles.practical}>
            <Text style={styles.sectionTitle}>🏆 {t('results.title')}</Text>
            {sheet.results.world.length === 0 && sheet.results.cities.length === 0 && (
              <Text style={styles.hint}>{t('results.none')}</Text>
            )}
            {sheet.results.world.map((p, i) => (
              <ResultRow key={p.id} proof={p} label={MEDALS[i]} onPress={() => setViewing(p)} />
            ))}
            {sheet.results.cities.length > 0 && (
              <Text style={[styles.sectionTitle, styles.resultsSub]}>{t('results.bestInCities')}</Text>
            )}
            {sheet.results.cities.map(p => (
              <ResultRow key={`c${p.id}`} proof={p} label="📍" city onPress={() => setViewing(p)} />
            ))}
          </View>
        )}

        {(priceRange || places.length > 0) && (
          <View style={styles.practical}>
            <Text style={styles.sectionTitle}>{t('practicalTitle')}</Text>
            {priceRange && (
              <Text style={styles.practicalLine}>
                💸 {priceRange.min === priceRange.max
                  ? t('priceOne', { amount: formatAmount(priceRange.min, i18n.language), currency: priceRange.currency })
                  : t('priceRange', { min: formatAmount(priceRange.min, i18n.language), max: formatAmount(priceRange.max, i18n.language), currency: priceRange.currency })}
                {priceRange.count ? ` · ${t('priceFrom', { count: priceRange.count })}` : ''}
              </Text>
            )}
            {places.length > 0 && (
              <>
                <Text style={styles.practicalLine}>📍 {t('places', { count: places.length })}</Text>
                <TouchableOpacity
                  style={styles.mapPreview}
                  onPress={() => router.push(`/daily/places?date=${date}&scope=${scope}&source=sheet` as never)}
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel={t('map.see')}
                >
                  <DailyPlacesMap key={`${scope}:${places.map(p => p.proofId).join(',')}`} pins={places} interactive={false} />
                  <View style={styles.mapCta}><Text style={styles.mapCtaText}>🗺️ {t('map.see')}</Text></View>
                </TouchableOpacity>
                {places.slice(0, 5).map(p => (
                  <TouchableOpacity key={p.proofId} onPress={() => {
                    const proof = sheet.proofs.find(x => x.id === p.proofId);
                    if (proof) setViewing(proof); else fetchDailyProof(p.proofId).then(setViewing).catch(() => {});
                  }}>
                    <Text style={styles.place} numberOfLines={1}>· {p.name || t('unnamedPlace')}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}

        {isLive && (
          <View style={styles.tabs}>
            {(['world', 'city'] as const).map(s => (
              <TouchableOpacity key={s} style={[styles.tab, scope === s && styles.tabActive]} onPress={() => setScope(s)} accessibilityRole="tab" accessibilityState={{ selected: scope === s }}>
                <Text style={[styles.tabText, scope === s && styles.tabTextActive]}>{s === 'world' ? `🌍 ${t('tabWorld')}` : `🏙️ ${cityName}`}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }, [sheet, challenge, myProof, isLive, cityName, scope, secondsLeft, styles, t, i18n.language, router, goProfile, account, setMyProof, reload, showOriginal, toggleOriginal, date]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{t('kicker')}</Text>
        <Text style={styles.navDate}>{challenge?.date ?? ''}</Text>
      </View>

      {loading && !sheet ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : error || !challenge ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{error === 'failed' ? t('loadFailed') : t('notFound')}</Text>
          {error === 'failed' && (
            <TouchableOpacity onPress={reload}><Text style={styles.link}>{t('retry')}</Text></TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={sheet!.proofs}
          keyExtractor={p => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          renderItem={({ item }) => <DailyProofTile proof={item} onPress={() => setViewing(item)} />}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.more} /> : null}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>✨ {t('beFirst')}</Text>
              <Text style={styles.empty}>{t('beFirstSub')}</Text>
            </View>
          }
        />
      )}

      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </SafeAreaView>
  );
}

/** One results line: medal (or pin), thumb, author · city (or "Best in <city>"), votes. */
function ResultRow({ proof, label, city = false, onPress }: { proof: DailyProof; label: string; city?: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  const cityName = proof.city ? localizeCityName(proof.city.name) : '';
  return (
    <TouchableOpacity style={styles.resultRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${name}`}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Image source={{ uri: proof.thumbUrl ?? proof.photoUrl }} style={styles.resultThumb} contentFit="cover" />
      <View style={styles.resultBody}>
        <Text style={styles.resultName} numberOfLines={1}>{city ? t('results.bestIn', { city: cityName }) : name}</Text>
        <Text style={styles.resultSub} numberOfLines={1}>
          {city ? name : cityName}
          {proof.validatedByLocal ? ` · ✓ ${t('validatedByLocal')}` : ''}
        </Text>
      </View>
      <Text style={styles.resultVotes}>♥ {proof.voteCount}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: Spacing.md },
  nav:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:        { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  navDate:     { fontSize: FontSizes.xs, color: c.muted },
  list:        { paddingHorizontal: Spacing.md, paddingBottom: 40, gap: 10 },
  row:         { gap: 10 },
  headerWrap:  { gap: 12, marginBottom: 4 },
  card:        { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,122,60,0.45)', padding: 16, gap: 10 },
  topRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  kicker:      { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.accentText },
  countdown:   { fontSize: 12, fontWeight: '700', color: c.muted },
  text:        { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, lineHeight: 26 },
  context:     { fontSize: FontSizes.sm, color: c.muted, lineHeight: 20 },
  twist:       { backgroundColor: c.bg3, borderRadius: Radius.md, padding: 10, gap: 4 },
  twistLabel:  { fontSize: 11, fontWeight: '800', color: c.accentText, textTransform: 'uppercase', letterSpacing: 0.4 },
  twistText:   { fontSize: FontSizes.sm, color: c.text },
  author:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  avatar:      { width: 20, height: 20, borderRadius: 10 },
  avatarEmpty: { backgroundColor: c.border },
  authorText:  { fontSize: FontSizes.xs, color: c.muted, fontWeight: '600' },
  mine:        { flexDirection: 'row', gap: 12, backgroundColor: c.bg3, borderRadius: Radius.md, padding: 10 },
  mineThumb:   { width: 72, height: 72, borderRadius: Radius.sm, backgroundColor: c.border },
  mineBody:    { flex: 1, gap: 4 },
  mineTitle:   { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  mineActions: { flexDirection: 'row', gap: 16, marginTop: 2 },
  hint:        { fontSize: 12, color: c.muted },
  reason:      { fontSize: 12, color: c.red, fontWeight: '600' },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.accentText },
  linkDanger:  { color: c.red },
  cta:         { backgroundColor: c.accent, borderRadius: Radius.full, paddingVertical: 13, alignItems: 'center' },
  ctaText:     { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
  practical:   { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 14, gap: 4 },
  sectionTitle:{ fontSize: FontSizes.sm, fontWeight: '800', color: c.text, marginBottom: 2 },
  practicalLine:{ fontSize: FontSizes.sm, color: c.text },
  place:       { fontSize: FontSizes.xs, color: c.muted, paddingLeft: 18 },
  tabs:        { flexDirection: 'row', gap: 8 },
  tab:         { flex: 1, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg2, alignItems: 'center' },
  tabActive:   { backgroundColor: c.accent, borderColor: c.accent },
  tabText:     { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  tabTextActive:{ color: c.white },
  emptyWrap:   { alignItems: 'center', paddingVertical: 30, gap: 6 },
  emptyTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  empty:       { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
  more:        { marginVertical: 16 },
  mapPreview:  { height: 150, borderRadius: Radius.md, overflow: 'hidden', marginVertical: 6, backgroundColor: c.bg3 },
  mapCta:      { position: 'absolute', right: 8, bottom: 8, backgroundColor: c.bg2, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: c.border },
  mapCtaText:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
  resultsSub:  { marginTop: 8 },
  resultRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  resultLabel: { fontSize: 20, width: 26, textAlign: 'center' },
  resultThumb: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  resultBody:  { flex: 1, gap: 1 },
  resultName:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  resultSub:   { fontSize: 12, color: c.muted },
  resultVotes: { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
});
