import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { useOriginal } from '@/features/daily/OriginalToggle';
import { dailyTrackProps } from '@/features/daily/track';
import { trackLocalPassEarned } from '@/features/daily/localPassTracking';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { CoverPhoto } from '@/ui/Photo';
import { FlagSticker, themeColor } from '@/ui/joy';
import { themeCover } from './covers';
import { PulseButton, type PulseTone } from './PulseButton';
import { HowItWorksSheet } from './HowItWorksSheet';
import { todayCities } from './useTodayCountries';
import { useSeasonalLive } from '@/features/event/seasonal';
import { AmbientBats, PumpkinIcon, SeasonalHeroDecor } from '@/features/event/SeasonalArt';
import { remindMeLater } from '@/api/daily';
import { resolveLocation } from '@/api/channels';
import * as Location from 'expo-location';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { markGpsCity } from '@/lib/gpsCityCorrection';
import { askDailyPush } from '@/services/push';
import { formatCountdown, isFinalHours } from '@/hooks/useDaily';
import { Button, WakingUp } from '@/ui';
import type { DailyCompareType, DailyToday, DailyTodayCountries } from '@/types';
import { isPlaceTheme, themeName } from '@/features/daily/themes';

/** Brand term: English in every locale (SPEC 9.11). */
const DAILY_CHALLENGE = 'Daily Challenge';
const HOW_IT_WORKS_KEY = 'hilads_how_it_works_seen';
/** Set after my first photo (app/daily/proof.tsx): the "how it works" steps fold away for good. */
const FIRST_PROOF_KEY = 'hilads_daily_first_proof_done';

/**
 * Today's Daily Challenge, the hero (SPEC 9.3, V3 polish): the cover photo
 * with the theme chip and the time left; the short headline and, under it, the
 * full ask; for a player who never played, the three steps (Snap it, Name it,
 * Compare); the live strip of the cities that played today (the same list as
 * the compare section under it: GET /daily/today/countries), which opens the
 * compare view; "Snap it for [city]" (straight to the camera), then "You played
 * · See the world" once my photo is in. Tapping the photo opens the challenge.
 */
export function TodayTicket({ data, countries, loading, error = false, secondsLeft, visible = true, onReload }: {
  data: DailyToday | null; loading: boolean; error?: boolean; secondsLeft: number | null;
  /** Today's cities (useTodayCountries), shared with the compare section. */
  countries: DailyTodayCountries | null;
  /** The card is on screen (Today's scroll): the button's pulse runs only then. */
  visible?: boolean;
  /** Refetch Today (after the location placed me). */
  onReload?: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity, setDetectedCity } = useApp();
  const { scope } = useScope();
  const [showOriginal] = useOriginal();
  const tracked = useRef<string | null>(null);
  // How it works: the first "Answer for [city]" only (device), then straight to the camera.
  const [howSeen, setHowSeen] = useState<boolean | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  // The three steps, until my first photo (this device).
  const [firstDone, setFirstDone] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(FIRST_PROOF_KEY).then(v => setFirstDone(v === '1')).catch(() => setFirstDone(true));
  }, [data?.myProof?.id]);
  const seasonal = useSeasonalLive();
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
  // The API can't be reached and nothing is kept on the phone: never "nothing live".
  if (error && !data) {
    return <View style={[styles.ticket, styles.placeholder]}><WakingUp onRetry={() => onReload?.()} /></View>;
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
  const openSheet = () => router.push('/daily/today?source=today' as never);
  // The compare view: every city's photos, side by side.
  const openCompare = (source: string) => {
    track('world_teaser_tapped', { cities: cities.length, source });
    router.push(`/daily/countries?source=${source}` as never);
  };
  // Where I am (not the browsed city): an unknown city asks for the location
  // first; the server then answers for it (an account's city, a guest's here).
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
  const onCta = async () => {
    if (myProof) { openCompare('hero_played'); return; }
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    // My city unknown: ask for the location first (the place step asks again where it needs a fix).
    if (!here) await locateHere();
    router.push('/daily/proof' as never);
  };
  const placeTheme = isPlaceTheme(challenge.theme?.key);
  const cityShort = here?.name ? shortCityName(here.name) : null;
  // Today's cities, the same list as the compare section: is mine in?
  const cities = todayCities(countries);
  const mineIn = !!myProof || (!!here && cities.some(c => c.city.id === here.id));
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

  // The hero's photo: a cover, never a player's photo (those are in the mosaic right under it):
  // the challenge's own, else its special day's, else its theme's uploaded default (all resolved
  // by the server in coverUrl), else the bundled theme cover.
  const fallbackCover = themeCover(challenge.theme?.key ?? null, challenge.date, challenge.special?.id);
  const original = showOriginal && challenge.original ? challenge.original.text : null;
  const headline = original ?? (challenge.headline || challenge.text);
  // The full ask under a short headline ("...and share its local name"): the subtitle, else the text.
  const ask = original ? null : challenge.subtitle || (challenge.headline && challenge.headline !== challenge.text ? challenge.text : null);
  // The theme's own color (DESIGN.md): the chip's fill and its text color.
  const tc = themeColor(challenge.special ? 'special' : challenge.theme?.key);
  // A seasonal event's live day (Halloween: "Snap something spooky for Lisbon") replaces the label.
  const ctaLabel = seasonal ? (cityShort ? t(seasonal.theme.copy.cta, { city: cityShort }) : t(seasonal.theme.copy.ctaNoCity))
    : cityShort ? t('hero.cta', { city: cityShort }) : t('hero.ctaNoCity');
  // Never played (this device, no streak): the three steps under the ask.
  const showSteps = !myProof && firstDone === false && !data?.streak && challenge.isActive;

  return (
    <View style={styles.hero}>
      {/* The whole photo opens the challenge sheet (twist, full question, answers). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={openSheet} accessibilityRole="button" testID="today-hero"
                 accessibilityLabel={`${DAILY_CHALLENGE}${challenge.theme ? `, ${themeLabel}` : ''}: ${challenge.text}`}>
        <CoverPhoto url={challenge.coverUrl} fallback={fallbackCover} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        <LinearGradient colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0)']} style={styles.shadeTop} />
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.88)']} locations={[0, 0.4, 1]} style={styles.shadeBottom} />
      </Pressable>
      <SeasonalHeroDecor visible={visible} />
      {/* Event mode: bats drifting across the hero. */}
      <AmbientBats />

      <View style={styles.heroTop} pointerEvents="box-none">
        <View style={[styles.chip, styles.themeChip, { backgroundColor: tc.fill }]}>
          {/* Halloween's live day: the chip wears a pumpkin. */}
          {challenge.theme && (seasonal?.key === 'halloween' && challenge.special
            ? <PumpkinIcon size={15} color={tc.onFill} />
            : <ThemeIcon theme={challenge.theme.key} special={challenge.special?.icon} size={15} color={tc.onFill} />)}
          {/* The theme alone, with its icon (never cut): "Daily Challenge" is the screen's own name. */}
          <Text style={[styles.chipText, { color: tc.onFill }]} numberOfLines={1}>{themeLabel || DAILY_CHALLENGE}</Text>
        </View>
        <View style={styles.heroTopRight}>
          {secondsLeft !== null && (
            <View style={styles.chip}>
              <Ionicons name="time-outline" size={14} color="#FFFFFF" />
              <Text style={styles.chipText}>{t('timeLeft', { time: formatCountdown(secondsLeft) })}</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.heroBottom} pointerEvents="box-none">
        <View style={styles.titles}>
          <Text style={styles.headline} numberOfLines={3}>{headline}</Text>
          {!!ask && <Text style={styles.ask} numberOfLines={2}>{ask}</Text>}
        </View>
        {showSteps && <Steps compareType={challenge.compare?.type ?? null} price={!!challenge.compare?.priceLabel} />}
        <LiveStrip cities={cities} mineIn={mineIn} city={cityShort} active={challenge.isActive}
                   onPress={() => openCompare('hero_strip')} />
        {myProof ? (
          <>
            {myProof.status !== 'approved' && <DailyStatusChip status={myProof.status} />}
            {/* Played: no pulse; the button opens the world's photos. */}
            <Button variant="secondary" icon="checkmark-circle-outline" label={t('hero.played')} onPress={() => openCompare('hero_played')} style={styles.cta} />
          </>
        ) : challenge.isActive ? (
          // White on the photo, breathing; straight to the camera (SPEC 9.3).
          <PulseButton tone={HERO_CTA_TONE} label={ctaLabel} onPress={onCta} intercept={firstTap} visible={visible && !howOpen}
                       fast={secondsLeft !== null && isFinalHours(secondsLeft)} />
        ) : null}
      </View>
      <HowItWorksSheet visible={howOpen} placeTheme={placeTheme}
                       onCamera={() => { howDone('camera'); onCta(); }} onLater={remindLater} onClose={() => howDone('dismissed')} />
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

type StepIcon = React.ComponentProps<typeof Ionicons>['name'];

/**
 * How it works in three steps, for a player who never played: Snap it, then
 * the challenge's own action (Name it for a word, Count it, Time it, Price
 * it; Tell it without a question), then Compare. On the photo, so white.
 */
function Steps({ compareType, price }: { compareType: DailyCompareType | null; price: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const second: [StepIcon, string] = price ? ['pricetag-outline', 'hero.steps.price']
    : compareType === 'number' ? ['stats-chart-outline', 'hero.steps.count']
    : compareType === 'time' ? ['time-outline', 'hero.steps.time']
    : compareType ? ['create-outline', 'hero.steps.name']
    : ['chatbubble-ellipses-outline', 'hero.steps.tell'];
  const steps: [StepIcon, string][] = [['camera-outline', 'hero.steps.snap'], second, ['earth-outline', 'hero.steps.compare']];
  return (
    <View style={styles.steps} accessibilityRole="text" accessibilityLabel={steps.map(([, k]) => t(k)).join(', ')}>
      {steps.map(([icon, key], i) => (
        <View key={key} style={styles.stepWrap}>
          {i > 0 && <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.75)" />}
          <View style={styles.step}>
            <Ionicons name={icon} size={14} color="#FFFFFF" />
            <Text style={styles.stepText} numberOfLines={1}>{t(key)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * The live strip: the flags of the cities that played today (mine first) and
 * where my city stands ("2 cities in. Saigon isn't yet!", "3 cities in ·
 * Compare", "Be the first city in the world today"). Opens the compare view.
 */
function LiveStrip({ cities, mineIn, city, active, onPress }: {
  cities: ReturnType<typeof todayCities>; mineIn: boolean; city: string | null; active: boolean; onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const n = cities.length;
  if (n === 0 && !active) return null;
  const text = n === 0 ? t('hero.firstCity')
    : mineIn ? `${t('hero.citiesIn', { count: n })} · ${t('compare.seeAnswers')}`
    : city ? t('hero.citiesMissing', { count: n, city })
    : t('hero.citiesIn', { count: n });
  return (
    <Pressable style={({ pressed }) => [styles.strip, pressed && styles.pressed]} onPress={onPress}
               accessibilityRole="button" accessibilityLabel={text} hitSlop={4} testID="today-live-strip">
      {n > 0 ? (
        <View style={styles.flags}>
          {cities.slice(0, 4).map((c, i) => (
            <FlagSticker key={c.city.id} country={c.city.country} size={22} style={i > 0 ? styles.flagOverlap : undefined} />
          ))}
        </View>
      ) : <Ionicons name="earth-outline" size={18} color="#FFFFFF" />}
      <Text style={styles.stripText} numberOfLines={1}>{text}</Text>
      <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
    </Pressable>
  );
}

// White on the photo: a soft shadow keeps 4.5:1 over the gradients (SPEC 9.3).
// On the photo the button is white (or "sun orange"); the primary stays for small accents.
const HERO_CTA_TONE: PulseTone = 'white';
const ON_PHOTO_SHADOW = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 };

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  hero:        { aspectRatio: 4 / 5, borderRadius: 24, overflow: 'hidden', backgroundColor: c.bg3, justifyContent: 'space-between' },
  shadeTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: '32%' },
  shadeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '72%' },
  heroTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, padding: 14 },
  heroTopRight: { alignItems: 'flex-end', gap: 6, flexShrink: 1 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, paddingHorizontal: 10, paddingVertical: 6,
                 borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.42)' },
  chipText:    { flexShrink: 1, fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  themeChip:   { borderRadius: 999, paddingHorizontal: 11 },
  heroBottom:  { gap: 12, padding: 16 },
  titles:      { gap: 4 },
  headline:    { fontSize: 24, lineHeight: 29, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3, ...ON_PHOTO_SHADOW },
  ask:         { fontSize: 15, lineHeight: 20, fontWeight: '600', color: 'rgba(255,255,255,0.92)', ...ON_PHOTO_SHADOW },
  steps:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 6 },
  stepWrap:    { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  step:        { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
                 backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  stepText:    { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  strip:       { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingLeft: 8, paddingRight: 10, paddingVertical: 6,
                 borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignSelf: 'flex-start', maxWidth: '100%' },
  pressed:     { opacity: 0.7 },
  flags:       { flexDirection: 'row', alignItems: 'center' },
  flagOverlap: { marginLeft: -7 },
  stripText:   { flexShrink: 1, fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  ticket:      { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.ticketLine, borderRadius: 22 },
  placeholder: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  top:         { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, gap: 8, zIndex: 2 },
  kicker:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerText:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  text:        { fontSize: FontSizes.lg, lineHeight: 25, fontWeight: '800', color: c.text, letterSpacing: -0.2 },
  meta:        { fontSize: FontSizes.xs, fontWeight: '600', color: c.muted, fontVariant: ['tabular-nums'] },
  cta:         { minHeight: 56 },
});
