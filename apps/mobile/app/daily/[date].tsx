import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { setStatusBarStyle } from 'expo-status-bar';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { shortCityName } from '@/i18n/cityName';
import { canAccessProfile } from '@/lib/profileAccess';
import { goBack } from '@/lib/nav';
import { track } from '@/services/analytics';
import { deleteDailyProof, fetchDailyProof, fetchDailySheet, fetchDailyToday, fetchDailyTodayCountries } from '@/api/daily';
import { formatCountdown, isFinalHours, useCountdown, useDailySheet, useHere, getLastToday } from '@/hooks/useDaily';
import { SheetSkeleton } from '@/features/daily/SheetSkeleton';
import { DailyProofViewer } from '@/features/daily/DailyProofViewer';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { formatAmount } from '@/features/daily/currency';
import { compareCountryGroups, compareCountryProofs } from '@/features/daily/countryOrder';
import { dailyTrackProps } from '@/features/daily/track';
import { OriginalToggle, useOriginal } from '@/features/daily/OriginalToggle';
import { ProposedBy } from '@/features/daily/DailyChannelCard';
import { themeName, isPlaceTheme } from '@/features/daily/themes';
import { answerText } from '@/features/compare/format';
import { WorldBubbles } from '@/features/challenge/WorldBubbles';
import { themeCover } from '@/features/today/covers';
import { ShareSheet } from '@/features/share/ShareSheet';
import { todayShare, type ShareContent } from '@/features/share/content';
import { Avatar, Button, Chip, CityFlag, EmptyState, IconButton, Photo, Screen, ScreenHeader } from '@/ui';
import type { DailyProof, DailySheet, DailyTodayCountries } from '@/types';

/** The hero takes this share of the screen height. */
const HERO_SHARE = 0.4;
// The hero is always a photo: dark shades in both themes (fixed photo tokens).
const SHADE_TOP = ['rgba(0,0,0,0.6)', 'rgba(0,0,0,0)'] as const;
/** Back and the timer on the photo: dark enough to read on any cover. */
const ON_PHOTO = 'rgba(0,0,0,0.5)';
const SHADE_BOTTOM = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)'] as const;

/**
 * The Daily Challenge screen (/daily/today or /daily/YYYY-MM-DD), made to
 * make people play: an illustrated hero (the challenge's cover, else its
 * theme's: never a player's photo) with back, timer, theme, the question
 * large and the instruction; "The world says" (a bubble per country with its
 * top answer, a tap opens that country in "See all"); Good to know (price
 * range, places pinned → the map on the theme); my photo (status, edit,
 * delete) once I played; my city (its top photo, a tap opens it in "See
 * all"); and a sticky "Play today" (or "See my photo"). The photo grids and
 * Top 10 live in "See all" (/daily/countries). ?proof=<id> opens that photo
 * on arrival (?share=1 its share sheet).
 */
export default function DailySheetScreen() {
  const { date: dateParam, proof: proofParam, source, push_type: pushType, share } = useLocalSearchParams<{ date: string; proof?: string; source?: string; push_type?: string; share?: string }>();
  const { city } = useApp();
  // /daily/today from the hero: today's date is already known (no loader).
  const [date, setDate] = useState<string | null>(dateParam && dateParam !== 'today' ? dateParam : getLastToday()?.challenge?.date ?? null);

  // /daily/today: resolve today's date first (the sheet API is by date).
  useEffect(() => {
    if (date) return;
    fetchDailyToday(city?.channelId)
      .then(d => setDate(d.challenge?.date ?? 'none'))
      .catch(() => setDate('none'));
  }, [date, city?.channelId]);

  if (!date) return <Loading />;   // a cold deep link only: the frame with placeholders
  return <Challenge date={date} openProofId={proofParam ?? null} source={source ?? null} pushType={pushType ?? null} shareProof={share === '1'} />;
}

function Loading() {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <Screen>
      <ScreenHeader title={t('kicker')} testID="daily-sheet" />
      <View style={styles.pad}><SheetSkeleton /></View>
    </Screen>
  );
}

function Challenge({ date, openProofId, source, pushType, shareProof }: {
  date: string; openProofId: string | null; source: string | null; pushType: string | null;
  /** ?share=1: open the share sheet on the ?proof= one (mine, from yesterday's podium). */
  shareProof: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors, theme } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The hero is a photo: light status bar text while this screen is on top, the theme's again after.
  useFocusEffect(useCallback(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle(theme === 'dark' ? 'light' : 'dark');
  }, [theme]));
  const { height } = useWindowDimensions();
  const { city, account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const here = useHere();   // "Play for [city]", my city block: where I am, not the browsed city
  const [viewing, setViewing] = useState<DailyProof | null>(null);
  const [autoShare, setAutoShare] = useState(shareProof);
  const [inviteShare, setInviteShare] = useState<ShareContent | null>(null);
  const [showOriginal, toggleOriginal] = useOriginal();
  // The sticky bar's measured height (safe area included): the scroll ends right above it.
  const [barHeight, setBarHeight] = useState(140);   // a close guess until measured
  const { sheet: loaded, error, reload, setMyProof } = useDailySheet(date, 'world', city?.channelId);
  // Until the sheet arrives (prefetched by Today): its top from Today's challenge. Never a full-screen loader.
  const sheet = useMemo<DailySheet | null>(() => {
    if (loaded) return loaded;
    const today = getLastToday();
    if (!today?.challenge || today.challenge.date !== date) return null;
    return { ...today, scope: 'world', proofs: [], hasMore: false, nextBefore: null, practical: { priceRanges: [], places: [] }, results: null };
  }, [loaded, date]);
  const challenge = sheet?.challenge ?? null;
  const myProof = sheet?.myProof ?? null;
  const secondsLeft = useCountdown(challenge?.isActive ? challenge.endsAt : null, sheet?.serverTime);
  const isToday = date === getLastToday()?.challenge?.date;

  // "The world says": the day's countries (the same data as Today's mosaic).
  const [countries, setCountries] = useState<DailyTodayCountries | null>(null);
  // My city: its top photo and count (where I am, else the browsed city).
  const myCityId = here?.id ?? sheet?.city?.id ?? null;
  const myCityName = here?.name ?? sheet?.city?.name ?? null;
  const [mine, setMine] = useState<{ top: DailyProof | null; count: number } | null>(null);
  useEffect(() => {
    fetchDailyTodayCountries({ date: isToday ? null : date, cityId: myCityId, guestId }).then(setCountries).catch(() => {});
  }, [date, isToday, myCityId, guestId]);
  useEffect(() => {
    if (!myCityId) { setMine(null); return; }
    // Its top photo: the most liked (newest on a tie), like a country's top in the mosaic.
    fetchDailySheet(date, { scope: 'city', cityId: myCityId, limit: 50, guestId })
      .then(s => setMine({ top: s.proofs.filter(p => !p.suggestion).sort(compareCountryProofs)[0] ?? null, count: s.counts.city ?? 0 }))
      .catch(() => {});
  }, [date, myCityId, guestId]);

  const tracked = useRef(false);
  useEffect(() => {
    if (!sheet?.challenge || tracked.current) return;
    tracked.current = true;
    const props = dailyTrackProps(sheet, account?.mode);
    track('daily_challenge_viewed', { source: source ?? (openProofId ? 'proof_link' : 'sheet'), ...(pushType ? { push_type: pushType } : {}), ...props });
    if (source === 'link') track('daily_link_opened', props);
  }, [sheet, openProofId, source, pushType, account?.mode]);

  // ?proof=<id>: open it once (from the sheet, or fetched).
  const opened = useRef(false);
  useEffect(() => {
    if (!openProofId || opened.current || !sheet) return;
    opened.current = true;
    const local = sheet.proofs.find(p => p.id === openProofId) ?? (sheet.myProof?.id === openProofId ? sheet.myProof : null);
    if (local) { setViewing(local); return; }
    fetchDailyProof(openProofId).then(setViewing).catch(() => {});
  }, [openProofId, sheet]);

  const goProfile = useCallback((userId: string) => {
    if (!canAccessProfile(account)) { router.push('/auth-gate?reason=view_profile' as never); return; }
    router.push(`/user/${userId}` as never);
  }, [account, router]);

  const play = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    track('challenge_cta_tapped', { played: !!myProof });
    if (myProof) { setViewing(myProof); return; }
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    router.push('/daily/proof' as never);
  };
  const seeAll = (country: string | null) => {
    track('challenge_bubble_tapped', { country });
    const q = [isToday ? null : `date=${date}`, country ? `country=${country}` : null, 'source=challenge'].filter(Boolean).join('&');
    router.push(`/daily/countries?${q}` as never);
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

  if (!challenge) {
    return (
      <Screen>
        <ScreenHeader title={t('kicker')} testID="daily-sheet" />
        {error ? (
          <View style={styles.center}>
            <EmptyState icon={error === 'failed' ? 'cloud-offline-outline' : 'calendar-clear-outline'}
                        body={error === 'failed' ? t('loadFailed') : t('notFound')}
                        action={error === 'failed' ? <Button variant="secondary" size="sm" label={t('retry')} onPress={reload} /> : undefined} />
          </View>
        ) : <View style={styles.pad}><SheetSkeleton /></View>}
      </Screen>
    );
  }

  const cover = challenge.coverUrl ? { uri: challenge.coverUrl } : themeCover(challenge.theme?.key ?? null, challenge.date, challenge.special?.id);
  const question = challenge.compare ? (showOriginal && challenge.compare.original ? challenge.compare.original : challenge.compare.question) : null;
  const text = showOriginal && challenge.original ? challenge.original.text : challenge.text;
  const priceRange = sheet!.practical.priceRanges[0];
  const placesCount = sheet!.practical.places.length;
  const canPlay = challenge.isActive;
  const showBar = canPlay || !!myProof;
  const isLive = !!sheet!.city?.isLive;
  const items = [...(countries?.items ?? [])].sort((a, b) =>
    compareCountryGroups(a, b, here?.country ?? sheet!.city?.country ?? null));
  const cityShort = myCityName ? shortCityName(myCityName) : null;
  const ruleLine = isPlaceTheme(challenge.theme?.key) ? t('proofHint.place') : t('proofHint.noPlace');
  const myCountry = items.find(g => g.city.id === myCityId)?.country ?? (here?.country ?? sheet!.city?.country ?? null);

  return (
    <View style={styles.screen} testID="daily-sheet">
      <ScrollView contentContainerStyle={{ paddingBottom: (showBar ? barHeight : insets.bottom) + 24 }} showsVerticalScrollIndicator={false}>
        {/* 1. The hero: the cover, back and timer on top, the theme, question and instruction at the bottom. */}
        <View style={[styles.hero, { height: Math.max(300, height * HERO_SHARE) }]}>
          {cover && <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />}
          <LinearGradient colors={SHADE_TOP} style={styles.shadeTop} pointerEvents="none" />
          <LinearGradient colors={SHADE_BOTTOM} style={styles.shadeBottom} pointerEvents="none" />
          <View style={styles.heroBottom}>
            {!!challenge.theme && <Chip theme={challenge.theme.key} special={challenge.special?.icon} label={themeName(challenge.theme.key, { special: challenge.special })} style={styles.theme} />}
            <Text style={styles.question}>{question ?? text}</Text>
            {/* Under the question: its subtitle (set in the back office), else the challenge text. */}
            <Text style={styles.instruction} numberOfLines={4}>
              {question ? (showOriginal && challenge.original ? text : challenge.subtitle || text)
                : (showOriginal && challenge.original ? challenge.original.context : challenge.context) ?? ''}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          {(!!challenge.original || !!sheet!.twist?.originalText || !!challenge.proposedBy) && (
            <View style={styles.meta}>
              <OriginalToggle translated={!!challenge.original || !!sheet!.twist?.originalText} showingOriginal={showOriginal} onPress={toggleOriginal} />
              {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} />}
            </View>
          )}

          {/* 2. The world says. */}
          <View style={styles.block}>
            <Text style={styles.title}>{t('worldSays.title')}</Text>
            <WorldBubbles items={items} seed={challenge.date} onOpen={seeAll} onFirst={canPlay && !myProof ? play : undefined} />
          </View>

          {/* The Local Twist of my city (locals of a live city). */}
          {sheet!.twist && isLive && (
            <View style={styles.twist}>
              <View style={styles.row}>
                <CityFlag country={sheet!.city?.country} />
                <Text style={styles.twistLabel}>{t('twistIn', { city: sheet!.city?.name ? shortCityName(sheet!.city.name) : '' })}</Text>
              </View>
              <Text style={styles.twistText}>{showOriginal && sheet!.twist.originalText ? sheet!.twist.originalText : sheet!.twist.text}</Text>
              {sheet!.twist.author ? (
                <TouchableOpacity style={styles.row} onPress={() => goProfile(sheet!.twist!.author!.id)} accessibilityRole="button">
                  <Avatar uri={sheet!.twist.author.photoUrl} name={sheet!.twist.author.displayName || sheet!.twist.author.username || '?'} size={22} />
                  <Text style={styles.muted}>{t('twistBy', { name: sheet!.twist.author.displayName || sheet!.twist.author.username })}</Text>
                </TouchableOpacity>
              ) : !!sheet!.twist.credit && <Text style={styles.muted}>{t('twistBy', { name: sheet!.twist.credit })}</Text>}
            </View>
          )}

          {/* 3. Good to know: two small tiles. */}
          {(priceRange || placesCount > 0) && (
            <View style={styles.block}>
              <Text style={styles.title}>{t('practicalTitle')}</Text>
              <View style={styles.tiles}>
                {priceRange && (
                  <View style={styles.tile}>
                    <Ionicons name="cash-outline" size={18} color={colors.primaryText} />
                    <Text style={styles.tileValue} numberOfLines={2}>
                      {priceRange.min === priceRange.max
                        ? t('priceOne', { amount: formatAmount(priceRange.min, i18n.language), currency: priceRange.currency })
                        : t('priceRange', { min: formatAmount(priceRange.min, i18n.language), max: formatAmount(priceRange.max, i18n.language), currency: priceRange.currency })}
                    </Text>
                    {!!priceRange.count && <Text style={styles.tileSub}>{t('priceFrom', { count: priceRange.count })}</Text>}
                  </View>
                )}
                {placesCount > 0 && (
                  <TouchableOpacity style={styles.tile} accessibilityRole="button" testID="challenge-places"
                                    onPress={() => router.push(`/(tabs)/map?source=challenge${challenge.theme && isPlaceTheme(challenge.theme.key) ? `&theme=${challenge.theme.key}` : ''}` as never)}>
                    <Ionicons name="location-outline" size={18} color={colors.primaryText} />
                    <Text style={styles.tileValue}>{t('places', { count: placesCount })}</Text>
                    <Text style={styles.tileLink}>{t('map.see')} ›</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* My photo: its status, edit and delete. */}
          {myProof && (
            <View style={styles.cardRow}>
              <TouchableOpacity onPress={() => setViewing(myProof)} accessibilityRole="button">
                <Photo thumb={myProof.thumbUrl} full={myProof.photoUrl} style={styles.thumb} contentFit="cover" />
              </TouchableOpacity>
              <View style={styles.flex}>
                <View style={styles.row}>
                  <Text style={styles.rowTitle}>{t('yourProof')}</Text>
                  <DailyStatusChip status={myProof.status} />
                </View>
                {myProof.status === 'pending' && <Text style={styles.muted}>{t('pendingHint')}</Text>}
                {!!myProof.rejectionReason && <Text style={styles.reason}>{t('reasonLabel', { reason: myProof.rejectionReason })}</Text>}
                <View style={styles.row}>
                  {challenge.isActive && myProof.status !== 'removed' && (
                    <TouchableOpacity onPress={() => router.push(`/daily/proof?edit=${myProof.id}` as never)} accessibilityRole="button" style={styles.linkHit}>
                      <Text style={styles.link}>{myProof.status === 'rejected' ? t('fixIt') : t('edit')}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={onDelete} accessibilityRole="button" style={styles.linkHit}>
                    <Text style={styles.linkDanger}>{t('delete')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* 4. My city: its top photo, or be its first. */}
          {cityShort && (mine?.top ? (
            <TouchableOpacity style={styles.cardRow} onPress={() => seeAll(myCountry)} accessibilityRole="button" testID="challenge-my-city">
              <Photo thumb={mine.top.thumbUrl} full={mine.top.photoUrl} style={styles.thumb} contentFit="cover" />
              <View style={styles.flex}>
                <Text style={styles.rowTitle} numberOfLines={1}>{t('myCity.in', { city: cityShort, count: mine.count })}</Text>
                {(mine.top.answer && !mine.top.backHome) || mine.top.caption ? (
                  <Text style={styles.rowAnswer} numberOfLines={1}>
                    {mine.top.answer && !mine.top.backHome ? answerText(mine.top.answer, i18n.language) : mine.top.caption}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </TouchableOpacity>
          ) : mine && canPlay && !myProof ? (
            <TouchableOpacity style={[styles.cardRow, styles.firstRow]} onPress={play} accessibilityRole="button" testID="challenge-my-city">
              <View style={styles.camera}><Ionicons name="camera-outline" size={24} color={colors.primaryText} /></View>
              <Text style={[styles.rowTitle, styles.flex]}>{t('myCity.first', { city: cityShort })}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.primaryText} />
            </TouchableOpacity>
          ) : null)}
        </View>
      </ScrollView>
      {/* Back and the timer stay on top while scrolling (dark pills: readable on the photo and the page). */}
      <View style={[styles.heroTop, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <IconButton icon="chevron-back" tone="onPhoto" onPress={goBack} label={t('back')} testID="header-back" style={styles.onPhoto} />
        <View style={styles.heroTopRight}>
          {myProof && challenge.isActive && (
            <IconButton icon="paper-plane-outline" tone="onPhoto" label={t('share.challengeFriend')} style={styles.onPhoto}
                        onPress={() => setInviteShare(todayShare(challenge, here ?? sheet!.city ?? null))} />
          )}
          <View style={styles.timer}>
            <Ionicons name="time-outline" size={14} color={challenge.isActive && isFinalHours(secondsLeft) ? colors.warning : colors.white} />
            <Text style={[styles.timerText, challenge.isActive && isFinalHours(secondsLeft) && styles.timerWarn]}>
              {challenge.isActive && secondsLeft !== null ? t('timeLeft', { time: formatCountdown(secondsLeft) }) : t('closed')}
            </Text>
          </View>
        </View>
      </View>

      {/* 5. Sticky: the photo rule in one line, then Play today (or See my photo). */}
      {showBar && (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 10 }]} onLayout={e => setBarHeight(e.nativeEvent.layout.height)}>
          {!myProof && <Text style={styles.rule} numberOfLines={2}>{ruleLine}</Text>}
          <Button icon={myProof ? 'image-outline' : 'camera-outline'} variant={myProof ? 'secondary' : 'primary'} testID="challenge-cta"
                  label={myProof ? t('myCity.seeMine') : here?.name ? t('ctaAnswer', { city: shortCityName(here.name) }) : t('ctaAnswerNoCity')}
                  onPress={play} />
        </View>
      )}

      <ShareSheet content={inviteShare} source="sheet_after_answer" onClose={() => setInviteShare(null)} />
      <DailyProofViewer proof={viewing} challenge={challenge} autoShare={autoShare && viewing?.id === openProofId}
                        onClose={() => { setViewing(null); setAutoShare(false); }} />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen:      { flex: 1, backgroundColor: c.bg },
  pad:         { padding: Spacing.md },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
  flex:        { flex: 1 },
  hero:        { backgroundColor: c.photoScrim, justifyContent: 'flex-end', overflow: 'hidden' },
  shadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: 130 },
  shadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' },
  heroTop:     { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  heroTopRight:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  onPhoto:     { backgroundColor: ON_PHOTO },
  timer:       { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: ON_PHOTO },
  timerText:   { fontSize: 13, fontWeight: '800', color: c.white },
  timerWarn:   { color: c.warning },
  heroBottom:  { padding: Spacing.md, paddingBottom: 18, gap: 8 },
  theme:       { alignSelf: 'flex-start' },
  question:    { fontSize: FontSizes.xxl, lineHeight: 34, fontWeight: '800', color: c.white },
  instruction: { fontSize: FontSizes.sm, lineHeight: 20, fontWeight: '600', color: 'rgba(255,255,255,0.88)' },
  body:        { padding: Spacing.md, gap: 18 },
  meta:        { gap: 4, marginTop: -6 },
  block:       { gap: 10 },
  title:       { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  twist:       { backgroundColor: c.primaryTint, borderRadius: Radius.button, padding: 12, gap: 6 },
  twistLabel:  { fontSize: 12, fontWeight: '800', color: c.primaryOnTint },
  twistText:   { fontSize: FontSizes.sm, fontWeight: '500', color: c.text },
  tiles:       { flexDirection: 'row', gap: 10 },
  tile:        { flex: 1, gap: 4, padding: 12, borderRadius: 16, backgroundColor: c.bg2, borderWidth: Border, borderColor: c.line },
  tileValue:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  tileSub:     { fontSize: 12, fontWeight: '600', color: c.muted },
  tileLink:    { fontSize: 12, fontWeight: '800', color: c.primaryText },
  cardRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: c.bg2, borderWidth: Border, borderColor: c.line },
  firstRow:    { borderStyle: 'dashed', borderColor: c.primaryText, borderWidth: 2, backgroundColor: c.primaryTint },
  thumb:       { width: 64, height: 64, borderRadius: 12, backgroundColor: c.bg3 },
  camera:      { width: 48, height: 48, borderRadius: 24, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  rowTitle:    { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  rowAnswer:   { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryText, marginTop: 2 },
  muted:       { fontSize: 12, fontWeight: '600', color: c.muted },
  reason:      { fontSize: 12, fontWeight: '600', color: c.red },
  linkHit:     { minHeight: 36, justifyContent: 'center', marginRight: 14 },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  linkDanger:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.red },
  bar:         { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: Spacing.md, paddingTop: 10, gap: 8,
                 backgroundColor: c.bg, borderTopWidth: Border, borderTopColor: c.line },
  rule:        { fontSize: 12, lineHeight: 16, fontWeight: '600', color: c.muted, textAlign: 'center' },
});
