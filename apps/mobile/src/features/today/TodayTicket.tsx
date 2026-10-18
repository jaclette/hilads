import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
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
import { clock } from './format';
import { ThemeIcon } from '@/ui/ThemeIcon';
import { themeCover } from './covers';
import { PulseButton } from './PulseButton';
import { HowItWorksSheet } from './HowItWorksSheet';
import { remindMeLater } from '@/api/daily';
import { askDailyPush } from '@/services/push';
import { isFinalHours } from '@/hooks/useDaily';
import { Button, CityFlag } from '@/ui';
import type { DailySpecial, DailyTheme, DailyToday } from '@/types';
import { isPlaceTheme, themeName } from '@/features/daily/themes';
import { ShareSheet } from '@/features/share/ShareSheet';
import { todayShare, type ShareContent } from '@/features/share/content';

/** Brand term: English in every locale (SPEC 9.11). */
const DAILY_CHALLENGE = 'Daily Challenge';
const HOW_IT_WORKS_KEY = 'hilads_how_it_works_seen';
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
export function TodayTicket({ data, loading, secondsLeft, visible = true }: {
  data: DailyToday | null; loading: boolean; secondsLeft: number | null;
  /** The card is on screen (Today's scroll): the button's pulse runs only then. */
  visible?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const { scope } = useScope();
  const [showOriginal, toggleOriginal] = useOriginal();
  const tracked = useRef<string | null>(null);
  // How it works: the first "I'm in" only (device), then straight to the camera.
  const [howSeen, setHowSeen] = useState<boolean | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [share, setShare] = useState<ShareContent | null>(null);
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
        {secondsLeft !== null && <Text style={styles.meta}>{t('nextIn', { time: clock(secondsLeft) })}</Text>}
      </View>
    );
  }

  const city = data?.city;
  const myProof = data?.myProof ?? null;
  const twist = data?.twist && city?.isLive ? data.twist : null;
  const earlyUntil = !myProof && data?.early && data.early.until * 1000 > Date.now() ? data.early.until : null;
  const openSheet = () => router.push('/daily/today?source=today' as never);
  const openMine = () => router.push((myProof ? `/daily/today?proof=${myProof.id}` : '/daily/today?source=today') as never);
  // People who took it: the city's count in city scope once it has proofs, else World's.
  const took = (scope === 'city' && data?.counts?.city ? data.counts.city : data?.counts?.world) ?? 0;
  const onCta = () => {
    if (myProof) { openSheet(); return; }
    if (!account) { router.push('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never); return; }
    router.push('/daily/proof' as never);
  };
  const placeTheme = isPlaceTheme(challenge.theme?.key);
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
    <TouchableOpacity style={styles.ticket} onPress={openSheet} activeOpacity={0.92} accessibilityRole="button"
                      accessibilityLabel={`${DAILY_CHALLENGE}${challenge.theme ? `, ${themeLabel}` : ''}: ${challenge.text}`}>
      <Cover coverUrl={challenge.coverUrl ?? null} themeKey={challenge.theme?.key ?? null} label={themeLabel}
             special={challenge.special ?? null} date={challenge.date} secondsLeft={secondsLeft} />
      <View style={styles.top}>
        <Text style={styles.text}>{showOriginal && challenge.original ? challenge.original.text : challenge.text}</Text>
        <OriginalToggle translated={!!challenge.original || !!twist?.originalText} showingOriginal={showOriginal} onPress={toggleOriginal} ink />
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
          <PulseButton label={t('ctaIn')} onPress={onCta} intercept={firstTap} visible={visible && !howOpen}
                       fast={secondsLeft !== null && isFinalHours(secondsLeft)} />
        )}
        {took > 0 && (
          <TouchableOpacity style={styles.took} onPress={openSheet} accessibilityRole="button">
            <Text style={styles.tookText}>
              {t('today.tookIt', { count: took })} · <Text style={styles.link}>{t('today.seePhotos', { count: took })}</Text>
            </Text>
          </TouchableOpacity>
        )}
        {/* Challenge a friend (SPEC 9.14): hilads.live/today with the card. */}
        {challenge.isActive && (
          <TouchableOpacity style={styles.friend} onPress={() => setShare(todayShare(challenge, city ?? null))}
                            accessibilityRole="button" accessibilityLabel={t('share.challengeFriend')}>
            <Ionicons name="paper-plane-outline" size={16} color={colors.text} />
            <Text style={styles.link}>{t('share.challengeFriend')}</Text>
          </TouchableOpacity>
        )}
      </View>
      <HowItWorksSheet visible={howOpen} placeTheme={placeTheme}
                       onCamera={() => { howDone('camera'); onCta(); }} onLater={remindLater} onClose={() => howDone('dismissed')} />
      <ShareSheet content={share} source="today_card" onClose={() => setShare(null)} />
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
  const source = coverUrl ? { uri: coverUrl } : themeCover(themeKey, date);
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
            <Text style={styles.coverTimeText}>{t('timeLeft', { time: clock(secondsLeft) })}</Text>
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
  top:         { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, gap: 8 },
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
  took:        { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  friend:      { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: -6 },
  tookText:    { fontSize: 13, fontWeight: '600', color: c.muted, textAlign: 'center' },
});
