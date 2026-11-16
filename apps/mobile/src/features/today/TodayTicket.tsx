import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Space, Spacing, Radius, Type, Elevation, type ThemeColors } from '@/constants';
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
import { CoverScrim } from '@/ui/CoverScrim';
import { themeColor } from '@/ui/joy';
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
 * Compare) (the cities that played today are the block under it, not a strip
 * here: UX audit 2026-11); "Snap it for [city]" (straight to the camera), then "You played
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
  // Today's cities, the same list as the block under the hero (for the tracking).
  const cities = todayCities(countries);
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
  // The full ask under a short headline ("...and share its local name"): the subtitle, else the text,
  // unless the text only says the headline again in other words (V6: "Find where locals hang out at
  // night." / "Find the place where locals gather after dark.").
  // The subtitle (back office) too, only when it adds something: context or a local twist.
  const subtitle = challenge.subtitle && !sameAsk(headline, challenge.subtitle) ? challenge.subtitle : null;
  const ask = original ? null : subtitle
    || (challenge.headline && challenge.headline !== challenge.text && !sameAsk(challenge.headline, challenge.text) ? challenge.text : null);
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
        {/* The shade behind the text only: the photo keeps its real brightness above it. */}
        <CoverScrim />
        <View style={styles.titles}>
          <Text style={styles.headline} numberOfLines={3}>{headline}</Text>
          {!!ask && <Text style={styles.ask} numberOfLines={2}>{ask}</Text>}
        </View>
        {showSteps && <Steps compareType={challenge.compare?.type ?? null} price={!!challenge.compare?.priceLabel} />}
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

// White on the photo: a soft shadow keeps 4.5:1 over the gradients (SPEC 9.3).
// On the photo the button is white (or "sun orange"); the primary stays for small accents.
const HERO_CTA_TONE: PulseTone = 'white';
// A safety net on bright covers, on top of the scrim (CoverScrim).
const ON_PHOTO_SHADOW = { textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  hero:        { aspectRatio: 4 / 5, borderRadius: Radius.hero, overflow: 'hidden', backgroundColor: c.bg3, justifyContent: 'space-between' },
  heroTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Space.sm, padding: Space.lg },
  heroTopRight: { alignItems: 'flex-end', gap: Space.sm, flexShrink: 1 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexShrink: 1, paddingHorizontal: Space.md, paddingVertical: Space.sm,
                 borderRadius: Radius.control, backgroundColor: c.photoButton },
  chipText:    { flexShrink: 1, ...Type.caption, fontWeight: '800', color: c.white },
  themeChip:   { paddingHorizontal: Space.md },
  heroBottom:  { gap: Space.md, padding: Space.lg },
  titles:      { gap: Space.xs },
  // The day's question is the screen's display title (design pass).
  headline:    { ...Type.display, color: c.white, ...ON_PHOTO_SHADOW },
  ask:         { ...Type.body, fontWeight: '600', color: 'rgba(255,255,255,0.92)', ...ON_PHOTO_SHADOW },
  steps:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: Space.sm },
  stepWrap:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginRight: Space.xs },
  step:        { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingHorizontal: Space.sm, paddingVertical: Space.xs, borderRadius: 999,
                 backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  stepText:    { ...Type.caption, fontWeight: '800', color: c.white },
  ticket:      { backgroundColor: c.bg2, borderWidth: 1, borderColor: c.ticketLine, borderRadius: Radius.hero, ...Elevation(c, 'rest') },
  placeholder: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  top:         { paddingHorizontal: Spacing.md, paddingTop: Space.lg, paddingBottom: Space.md, gap: Space.sm, zIndex: 2 },
  kicker:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  kickerText:  { ...Type.caption, fontWeight: '800', color: c.primaryText },
  text:        { ...Type.title, color: c.text },
  meta:        { ...Type.caption, color: c.muted, fontVariant: ['tabular-nums'] },
  cta:         { minHeight: 56 },
});

/** Words every challenge uses, ignored when checking that a subtitle adds something (sameAsk). */
const FILLER = new Set('find snap show share take spot photo picture your you the and for from with that this its their our city cities local locals love loves loved favorite favourite favorites best most one people where what which who how can get here there only every any just like'.split(' '));

/**
 * The subtitle only says the headline again, so it is hidden (it must add context or a local twist):
 * - at least half of the headline's words (3+ letters) are in it and it is barely longer (at most 1.5×);
 * - or, without the words every challenge uses ("find", "your", "city", "locals", "love", "favorite"...),
 *   it shares a word with the headline and adds at most one new one ("Find your city's favorite sweet." /
 *   "Find the sweet treat locals love.": "sweet" shared, only "treat" new).
 * Scripts without spaces (CJK, Thai): the same on characters, 60% shared. Exported for tests.
 */
export function sameAsk(headline: string, subtitle: string): boolean {
  const norm = (v: string) => v.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?¡¿;:'"‘’“”«»()…\-–—]/g, ' ');
  const words = (v: string) => new Set(norm(v).split(/\s+/).filter(w => w.length >= 3));
  const share = (a: Set<string>, b: Set<string>) => { let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return a.size ? n / a.size : 0; };
  const wh = words(headline), ws = words(subtitle);
  if (wh.size >= 2 && ws.size >= 2 && share(wh, ws) >= 0.5 && ws.size <= wh.size * 1.5) return true;
  const kh = [...wh].filter(w => !FILLER.has(w)), ks = [...ws].filter(w => !FILLER.has(w));
  if (kh.length && ks.length) return kh.some(w => ks.includes(w)) && ks.filter(w => !kh.includes(w)).length <= 1;
  if (wh.size >= 2 && ws.size >= 2) return false;
  const ch = new Set([...norm(headline).replace(/\s/g, '')]), cs = new Set([...norm(subtitle).replace(/\s/g, '')]);
  return share(ch, cs) >= 0.6 && cs.size <= ch.size * 1.5;
}
