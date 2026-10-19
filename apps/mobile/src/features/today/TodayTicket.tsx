import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { useScope } from '@/context/ScopeContext';
import { shortCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { DailyStatusChip } from '@/features/daily/DailyStatusChip';
import { ProposedBy } from '@/features/daily/DailyChannelCard';
import { OriginalToggle, useOriginal } from '@/features/daily/OriginalToggle';
import { dailyTrackProps } from '@/features/daily/track';
import { trackLocalPassEarned } from '@/features/daily/localPassTracking';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { answerText } from '@/features/compare/format';
import { themeCover } from './covers';
import { PulseButton } from './PulseButton';
import { LiveDot, WorldTicker, useLiveMotion, type TickerEntry } from './WorldLive';
import { HowItWorksSheet } from './HowItWorksSheet';
import { remindMeLater } from '@/api/daily';
import { resolveLocation } from '@/api/channels';
import * as Location from 'expo-location';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { markGpsCity } from '@/lib/gpsCityCorrection';
import { askDailyPush } from '@/services/push';
import { formatCountdown, isFinalHours } from '@/hooks/useDaily';
import { Button, CityFlag } from '@/ui';
import type { DailySpecial, DailyTheme, DailyToday } from '@/types';
import { isPlaceTheme, themeName } from '@/features/daily/themes';
import { ShareSheet } from '@/features/share/ShareSheet';
import { representShare, todayShare, type ShareContent } from '@/features/share/content';

/** Brand term: English in every locale (SPEC 9.11). */
const DAILY_CHALLENGE = 'Daily Challenge';
const HOW_IT_WORKS_KEY = 'hilads_how_it_works_seen';
const COMPARE_TIP_KEY = 'hilads_compare_tip_seen';
const TIP_MS = 6000;
/** Until when the world block's tip shows (epoch ms; 0 = hidden). */
let tipUntil = 0;
/** The cover's white text and its shade: fixed in both themes (the image is the same). */
const COVER_TEXT  = '#FFFFFF';
// Measured on the covers: white text >= 5.6:1 even over a pure white image.
const COVER_SHADE = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.86)', 'rgba(0,0,0,0.9)'] as const;

/**
 * Today's Daily Challenge as a ticket (SPEC 9.3): an image band (the
 * challenge's cover, else its theme's) with "Daily Challenge" over the theme
 * and the time left; the challenge (with its "Proposed by" credit) and the
 * early-bonus hint on the light background; a perforated divider, the Local
 * Twist in live cities, "I'm in" (the card's only orange element, straight to
 * the camera) or my proof's status, and how many people took it. Tapping the
 * card opens the challenge sheet. Tomorrow's Local Twist proposal sits under
 * the week strip.
 */
export function TodayTicket({ data, loading, secondsLeft, visible = true, onReload }: {
  data: DailyToday | null; loading: boolean; secondsLeft: number | null;
  /** The card is on screen (Today's scroll): the button's pulse runs only then. */
  visible?: boolean;
  /** Refetch Today (after "Not in Saigon? Change" placed me). */
  onReload?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { account, identity, setDetectedCity } = useApp();
  const [locating, setLocating] = useState(false);
  const { scope } = useScope();
  const [showOriginal, toggleOriginal] = useOriginal();
  const tracked = useRef<string | null>(null);
  // How it works: the first "Answer for [city]" only (device), then straight to the camera.
  const [howSeen, setHowSeen] = useState<boolean | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [share, setShare] = useState<ShareContent | null>(null);
  // The world block's one-time tip (per device): "Tap to compare your city with the world."
  // Its deadline lives outside the card, which can remount while it shows.
  const [tip, setTip] = useState(() => Date.now() < tipUntil);
  const hideTip = () => { tipUntil = 0; setTip(false); };
  const hasCompare = !!data?.challenge?.compare;
  useEffect(() => {
    if (!hasCompare) return;
    AsyncStorage.getItem(COMPARE_TIP_KEY).then(v => {
      if (v === '1') return;
      tipUntil = Date.now() + TIP_MS;
      setTip(true);
      AsyncStorage.setItem(COMPARE_TIP_KEY, '1').catch(() => {});
    }).catch(() => {});
  }, [hasCompare]);
  useEffect(() => {
    if (!tip) return;
    const id = setTimeout(() => setTip(false), Math.max(0, tipUntil - Date.now()));
    return () => clearTimeout(id);
  }, [tip]);
  // The world block moves only on screen, in the foreground, without reduce motion.
  const motion = useLiveMotion(visible);
  useEffect(() => {
    AsyncStorage.getItem(HOW_IT_WORKS_KEY).then(v => setHowSeen(v === '1')).catch(() => setHowSeen(true));
  }, []);

  const challenge = data?.challenge ?? null;
  useEffect(() => {
    if (!challenge || tracked.current === challenge.id) return;
    tracked.current = challenge.id;
    track('daily_challenge_viewed', { source: 'today', ...dailyTrackProps(data, account?.mode) });
  }, [challenge, data, account?.mode]);
  useEffect(() => { trackLocalPassEarned(data?.localPass, account?.id); }, [data?.localPass, account?.id]);

  if (loading && !data) {
    return <View style={[styles.ticket, styles.placeholder]}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!challenge) {
    return (
      <View style={[styles.ticket, styles.top]}>
        <Kicker />
        <Text style={styles.text}>{t('nothingLive')}</Text>
        {secondsLeft !== null && <Text style={styles.meta}>{t('nextIn', { time: formatCountdown(secondsLeft) })}</Text>}
      </View>
    );
  }

  const city = data?.city;
  const myProof = data?.myProof ?? null;
  const twist = data?.twist && city?.isLive ? data.twist : null;
  const earlyUntil = !myProof && data?.early && data.early.until * 1000 > Date.now() ? data.early.until : null;
  const openSheet = () => router.push('/daily/today?source=today' as never);
  const world = data?.world ?? null;
  const openCompare = () => {
    track('world_teaser_tapped', { countries: world?.countries ?? 0, cities: world?.cities ?? 0 });
    router.push('/daily/today?tab=compare&source=teaser' as never);
  };
  const openWorld = () => router.push('/daily/today?tab=world&source=today_block' as never);
  // Hilads suggestions (no player answer yet): the place's name goes with its answer.
  const suggested = !!world?.suggested;
  const line = (a: NonNullable<typeof world>['answers'][number]) =>
    [a.place, a.answer ? answerText(a.answer, i18n.language) : null].filter(Boolean).join(' · ');
  const answers = (world?.answers ?? []).filter(a => a.answer || a.place).slice(0, 3).map(line);
  const compared = !!world && world.countries >= 2;
  const ticker: TickerEntry[] = (world?.answers ?? []).filter(a => (a.answer || a.place) && a.city.name)
    .map(a => ({ cityId: a.city.id, city: a.city.name, country: a.city.country ?? null, answer: line(a) }));
  const openMine = () => router.push((myProof ? `/daily/today?proof=${myProof.id}` : '/daily/today?source=today') as never);
  // Where I am (not the browsed city): "Not in Saigon? Change" and an unknown city ask for
  // the location; the server then answers for it (an account's city, a guest's here).
  const here = data?.here ?? null;
  const locateHere = async (): Promise<boolean> => {
    const r = await requestFeatureLocation('challenge_proof');
    if (!r.ok || !r.coords) return false;
    const geo = await Location.reverseGeocodeAsync({ latitude: r.coords.lat, longitude: r.coords.lng }).catch(() => null);
    const c = await resolveLocation(r.coords.lat, r.coords.lng, geo?.[0]?.isoCountryCode ?? null).catch(() => null);
    if (!c?.channelId) return false;
    markGpsCity(c.channelId);
    setDetectedCity(c);
    onReload?.();
    return true;
  };
  const changeHere = async () => {
    if (locating) return;
    setLocating(true);
    const ok = await locateHere();
    setLocating(false);
    track('here_change', { ok, from: here?.name ?? null });
    if (!ok) Alert.alert(t('represent.locationNeeded'));
  };
  const onCta = async () => {
    if (myProof) { openSheet(); return; }
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    // My city unknown: ask for the location first (the place step asks again where it needs a fix).
    if (!here) await locateHere();
    router.push('/daily/proof' as never);
  };
  const placeTheme = isPlaceTheme(challenge.theme?.key);
  // Represent your city (SPEC 9.16), city scope only, for where I am (never the browsed city):
  // nobody has represented it today (my own pending proof counts for me), and its run of
  // represented days. Browsing another city: that city's state, as information only.
  const presence = scope === 'city' ? here?.presence ?? null : null;
  const cityShort = here?.name ? shortCityName(here.name) : null;
  const emptyCity = !!presence && !presence.represented && !!cityShort && challenge.isActive;
  const cityStreak = presence && cityShort && presence.streak >= 2 ? presence.streak : 0;
  const elsewhere = scope === 'city' && !!city?.name && city.id !== here?.id;
  const emptyThere = !emptyCity && elsewhere && !!data?.presence && !data.presence.represented && challenge.isActive;
  // "Only in Saigon" in city scope, "Only here" in World; a special day's own name.
  const themeLabel = challenge.theme
    ? themeName(challenge.theme.key, { special: challenge.special, city: scope === 'city' ? city?.name : null })
    : '';
  const props = { ...dailyTrackProps(data, account?.mode), place_theme: placeTheme };
  // The first tap shows How it works instead of the camera (never again after).
  const firstTap = () => {
    if (howSeen !== false) return false;
    setHowOpen(true);
    track('how_it_works_shown', props);
    return true;
  };
  const howDone = (choice: 'camera' | 'later' | 'dismissed') => {
    setHowOpen(false);
    setHowSeen(true);
    AsyncStorage.setItem(HOW_IT_WORKS_KEY, '1').catch(() => {});
    track('how_it_works_choice', { ...props, choice });
  };
  const remindLater = async () => {
    howDone('later');
    if (!account) return;   // a guest has no reminder to schedule
    // The reminder is a push: ask for permission in context first.
    await askDailyPush('remind_me', identity?.guestId);
    const r = await remindMeLater().catch(() => null);
    if (r?.queued) Alert.alert(t('howItWorks.laterDone'));
  };

  return (
    <TouchableOpacity style={styles.ticket} onPress={() => { hideTip(); openSheet(); }} activeOpacity={0.85} accessibilityRole="button"
                      accessibilityLabel={`${DAILY_CHALLENGE}${challenge.theme ? `, ${themeLabel}` : ''}: ${challenge.text}`}>
      <Cover coverUrl={challenge.coverUrl ?? null} themeKey={challenge.theme?.key ?? null} label={themeLabel}
             special={challenge.special ?? null} date={challenge.date} secondsLeft={secondsLeft} />
      <View style={styles.top}>
        <Text style={styles.text}>{showOriginal && challenge.original ? challenge.original.text : challenge.text}</Text>
        {/* The comparison question and the world's answers, one block (SPEC 10.2, 10.6): from 2
            countries it opens the Compare tab, before the sheet's World tab. Without a question it
            stays: flags, "Already 5 countries answered", the World tab. */}
        <View>
          <Pressable style={({ pressed }) => [styles.world, pressed && styles.worldPressed]} accessibilityRole="button"
                     onPress={() => { hideTip(); (compared && challenge.compare ? openCompare : openWorld)(); }}>
            <View style={styles.worldKicker}>
              <LiveDot live={motion.live} />
              <Text style={styles.worldKickerText}>{suggested ? t('compare.picksTitle') : t('compare.worldAnswers')}</Text>
            </View>
            {challenge.compare && (
              <Text style={styles.worldQuestion}>
                {showOriginal && challenge.compare.original ? challenge.compare.original : challenge.compare.question}
              </Text>
            )}
            {/* Answered: the world block is the focus now. */}
            {myProof && <Text style={styles.worldMine}>{t('compare.youAnswered')}</Text>}
            <View style={styles.worldLine}>
              {compared && !challenge.compare ? (
                <WorldTicker entries={[]} flags={world!.flags ?? []} live={false} reduced
                             staticLine={t('compare.answeredRow', { count: world!.countries })} />
              ) : compared ? (
                <WorldTicker entries={ticker} flags={world!.flags ?? world!.answers.map(a => a.city.country ?? '')}
                             live={motion.live} reduced={motion.reduced}
                             staticLine={[t('compare.nCountries', { count: world!.countries }), ...answers].join(' · ')} />
              ) : <Text style={styles.worldAnswers} numberOfLines={1}>{t('compare.firstIn')}</Text>}
              <Text style={styles.worldSee}>{t('compare.seeAnswers')}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primaryText} />
            </View>
          </Pressable>
          {/* Once per device: what the block does. Any tap or 6 seconds closes it. */}
          {tip && (
            <Pressable style={styles.tip} onPress={hideTip} accessibilityRole="button">
              <View style={styles.tipArrow} />
              <Text style={styles.tipText}>{t('compare.tip')}</Text>
            </Pressable>
          )}
        </View>
        <OriginalToggle translated={!!challenge.original || !!twist?.originalText || !!challenge.compare?.original} showingOriginal={showOriginal} onPress={toggleOriginal} ink />
        {challenge.proposedBy && <ProposedBy credit={challenge.proposedBy} ink />}
        {earlyUntil !== null && (
          <Text style={styles.early}>
            {t('today.early', { time: new Date(earlyUntil * 1000).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })}
          </Text>
        )}
      </View>

      <Perforation />

      <View style={styles.bottom}>
        {twist && (
          <View style={styles.twist}>
            <View style={styles.twistHead}>
              <CityFlag country={city?.country} />
              <Text style={styles.twistLabel}>{t('twistIn', { city: shortCityName(city?.name ?? '') })}</Text>
            </View>
            <Text style={styles.twistText}>{showOriginal && twist.originalText ? twist.originalText : twist.text}</Text>
          </View>
        )}
        {emptyCity && (
          <View style={styles.emptyCity} accessibilityRole="text">
            <CityFlag country={here?.country} size={18} />
            <Text style={styles.emptyCityText}>{t('represent.empty', { city: cityShort })}</Text>
          </View>
        )}
        {emptyThere && (
          <View style={styles.emptyCity} accessibilityRole="text">
            <CityFlag country={city?.country} size={18} />
            <Text style={styles.emptyCityText}>{t('represent.emptyThere', { city: shortCityName(city!.name!) })}</Text>
          </View>
        )}
        {!myProof && (
          <View style={styles.hint}>
            <View style={styles.hintIcon}><Ionicons name="camera-outline" size={20} color={colors.primaryOnTint} /></View>
            <View style={styles.hintBody}>
              <Text style={styles.hintTitle}>{t('proofHint.title')}</Text>
              <Text style={styles.hintText}>{placeTheme ? t('proofHint.place') : t('proofHint.noPlace')}</Text>
            </View>
          </View>
        )}
        {myProof ? (
          <>
            {myProof.status !== 'approved' && <DailyStatusChip status={myProof.status} />}
            {/* Posted: no pulse; the button opens my proof. */}
            <Button variant="secondary" icon="checkmark-circle-outline" label={t('ctaTaken')} onPress={openMine} style={styles.cta} />
          </>
        ) : (
          // The card's only orange element, pulsing; straight to the camera (SPEC 9.3).
          <PulseButton label={cityShort ? t('ctaAnswer', { city: cityShort }) : t('ctaAnswerNoCity')} onPress={onCta} intercept={firstTap} visible={visible && !howOpen}
                       fast={secondsLeft !== null && isFinalHours(secondsLeft)} />
        )}
        {/* My city is an IP guess (a VPN gets it wrong): "Not in Saigon? Change" asks for the location. */}
        {!myProof && here?.source === 'ip' && !!cityShort && (
          <TouchableOpacity style={styles.notHere} onPress={changeHere} disabled={locating} hitSlop={8} accessibilityRole="button">
            <Text style={styles.notHereText}>
              {t('represent.notIn', { city: cityShort })} <Text style={styles.notHereLink}>{t('represent.change')}</Text>
            </Text>
            {locating && <ActivityIndicator size="small" color={colors.muted} />}
          </TouchableOpacity>
        )}
        {cityStreak > 0 && (
          <View style={styles.streak}>
            <Ionicons name="flame-outline" size={16} color={colors.primaryText} />
            <Text style={styles.streakText}>{t('represent.streak', { count: cityStreak, city: cityShort })}</Text>
          </View>
        )}
        {/* Challenge a friend (SPEC 9.14): hilads.live/today with the card; an empty city: "Help me represent Saigon". */}
        {challenge.isActive && (
          <TouchableOpacity style={styles.friend}
                            onPress={() => setShare(emptyCity && here ? representShare(challenge, here) : todayShare(challenge, here ?? city ?? null))}
                            accessibilityRole="button" accessibilityLabel={emptyCity ? t('represent.invite') : t('share.challengeFriend')}>
            <Ionicons name="paper-plane-outline" size={16} color={colors.text} />
            <Text style={styles.link}>{emptyCity ? t('represent.invite') : t('share.challengeFriend')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <HowItWorksSheet visible={howOpen} placeTheme={placeTheme}
                       onCamera={() => { howDone('camera'); onCta(); }} onLater={remindLater} onClose={() => howDone('dismissed')} />
      <ShareSheet content={share} source={share?.type === 'today' && share.represent ? 'represent_today_card' : 'today_card'} onClose={() => setShare(null)} />
    </TouchableOpacity>
  );
}

/**
 * The card's image band: the challenge's cover (back office) or its theme's
 * default, with a dark gradient at the bottom so the white label stays
 * readable (4.5:1): "Daily Challenge" small above the theme with its icon
 * (a special day: its own name and icon), and the time left. Decorative image.
 */
function Cover({ coverUrl, themeKey, label, special, date, secondsLeft }: {
  coverUrl: string | null; themeKey: DailyTheme['key'] | null; label: string; special: DailySpecial | null; date: string; secondsLeft: number | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const source = coverUrl ? { uri: coverUrl } : themeCover(themeKey, date, special?.id);
  return (
    <View style={styles.cover}>
      {source !== null && (
        <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={150}
               accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      )}
      <LinearGradient colors={COVER_SHADE} locations={[0, 0.28, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.coverRow}>
        <View style={styles.coverLabel}>
          <Text style={styles.coverKicker}>{DAILY_CHALLENGE}</Text>
          {themeKey !== null && (
            <View style={styles.coverThemeRow}>
              <ThemeIcon theme={themeKey} special={special?.icon} size={22} color={COVER_TEXT} />
              <Text style={styles.coverTheme} numberOfLines={1}>{label}</Text>
            </View>
          )}
        </View>
        {secondsLeft !== null && (
          <View style={styles.coverTime}>
            <Ionicons name="time-outline" size={15} color={COVER_TEXT} />
            <Text style={styles.coverTimeText}>{t('timeLeft', { time: formatCountdown(secondsLeft) })}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Kicker() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  return (
    <View style={styles.kicker}>
      <Ionicons name="flame-outline" size={17} color={colors.primaryText} />
      <Text style={styles.kickerText}>{t('kicker')}</Text>
    </View>
  );
}

/** The ticket's perforated divider: a dashed line between two round cut-outs. */
export function Perforation() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.perf} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.perfLine}>
        {Array.from({ length: 48 }, (_, i) => <View key={i} style={styles.dash} />)}
      </View>
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />
    </View>
  );
}

const NOTCH = 20;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  ticket:      { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.ticketLine, borderRadius: 22 },
  placeholder: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  // Image band: the ticket's top corners (radius 22 minus the 1.5 border).
  cover:       { height: 160, borderTopLeftRadius: 20.5, borderTopRightRadius: 20.5, overflow: 'hidden', backgroundColor: c.bg3, justifyContent: 'flex-end' },
  coverRow:    { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, paddingHorizontal: 18, paddingBottom: 12 },
  coverLabel:  { flexShrink: 1, gap: 1 },
  coverKicker: { fontSize: 13, fontWeight: '700', color: COVER_TEXT },
  coverThemeRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  coverTheme:  { flexShrink: 1, fontSize: 24, lineHeight: 30, fontWeight: '800', color: COVER_TEXT, letterSpacing: -0.3 },
  coverTime:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 4 },
  coverTimeText: { fontSize: FontSizes.xs, fontWeight: '700', color: COVER_TEXT, fontVariant: ['tabular-nums'] },
  top:         { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, gap: 8, zIndex: 2 },
  kicker:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerText:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  text:        { fontSize: FontSizes.lg, lineHeight: 25, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
  meta:        { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, fontVariant: ['tabular-nums'] },
  early:       { fontSize: FontSizes.xs, fontWeight: '600', color: c.localText },
  perf:        { height: NOTCH, justifyContent: 'center', paddingHorizontal: 18 },
  // Dashes drawn as views: a dashed top border isn't reliable on Android.
  perfLine:    { flexDirection: 'row', gap: 5, height: 2, overflow: 'hidden' },
  dash:        { width: 6, height: 2, borderRadius: 1, backgroundColor: c.ticketLine },
  notch:       { position: 'absolute', top: 0, width: NOTCH, height: NOTCH, borderRadius: NOTCH / 2, backgroundColor: c.bg },
  notchLeft:   { left: -NOTCH / 2 - 1.5 },
  notchRight:  { right: -NOTCH / 2 - 1.5 },
  bottom:      { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10, gap: 6 },
  twist:       { gap: 4, marginBottom: 4 },
  twistHead:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  twistLabel:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  twistText:   { fontSize: 15, lineHeight: 22, fontWeight: '500', color: c.text },
  cta:         { minHeight: 56 },
  // The photo step: its own soft block, 12 px from the Local Twist above and the button below.
  hint:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.stepBg, marginTop: 2, marginBottom: 6 },
  hintIcon:    { width: 40, height: 40, borderRadius: 20, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  hintBody:    { flex: 1, gap: 2 },
  hintTitle:   { fontSize: 16, lineHeight: 21, fontWeight: '800', color: c.text },
  hintText:    { fontSize: 13, lineHeight: 18, fontWeight: '500', color: c.muted },
  mine:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 },
  // Secondary links in ink: the button is the card's only orange element.
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, textDecorationLine: 'underline' },
  world:       { gap: 4, minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, borderWidth: 1,
                 borderColor: c.line, backgroundColor: c.stepBg },
  worldPressed: { opacity: 0.7 },
  worldKicker: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  worldKickerText: { fontSize: 12, fontWeight: '600', color: c.muted },
  worldQuestion: { fontSize: 16, lineHeight: 21, fontWeight: '800', color: c.text },
  worldLine:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  worldAnswers: { flex: 1, fontSize: 13, fontWeight: '600', color: c.muted },
  worldMine:   { fontSize: 13, fontWeight: '700', color: c.primaryText },
  worldSee:    { fontSize: 13, fontWeight: '800', color: c.primaryText },
  tip:         { position: 'absolute', top: '100%', left: 12, right: 12, marginTop: 10, zIndex: 10, paddingHorizontal: 14, paddingVertical: 10,
                 borderRadius: 14, backgroundColor: c.text },
  tipArrow:    { position: 'absolute', top: -6, left: 24, width: 12, height: 12, backgroundColor: c.text, transform: [{ rotate: '45deg' }] },
  tipText:     { fontSize: 14, fontWeight: '700', color: c.bg },
  emptyCity:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: c.primaryTint },
  emptyCityText: { flex: 1, fontSize: FontSizes.sm, lineHeight: 19, fontWeight: '700', color: c.primaryOnTint },
  streak:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -4 },
  streakText:  { fontSize: 13, fontWeight: '700', color: c.text },
  notHere:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 32, marginTop: -4 },
  notHereText: { fontSize: 13, fontWeight: '600', color: c.muted, textAlign: 'center' },
  notHereLink: { fontSize: 13, fontWeight: '800', color: c.primaryText },
  friend:      { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -6 },
});
