import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { themeColor, tint } from '@/ui/joy';
import { fetchMyProposals } from '@/api/daily';
import { track } from '@/services/analytics';

// ✕ hides the card for a week, then it comes back.
const HIDE_KEY = 'hilads_propose_card_hidden_until';
const HIDE_MS = 7 * 24 * 3600 * 1000;
const YELLOW = themeColor('sip').fill;

/** The idea I proposed that was played, newest first: {text, cities}, or null. */
async function playedIdea(): Promise<{ text: string; cities: number } | null> {
  const { items } = await fetchMyProposals();
  const hit = items.find(p => p.type === 'challenge' && (p.playedCities ?? 0) > 0);
  if (!hit) return null;
  const text = hit.text.length > 42 ? `${hit.text.slice(0, 40).trimEnd()}…` : hit.text;
  return { text, cities: hit.playedCities ?? 0 };
}

/**
 * The bottom of Today (V6.1, replaces the "Got a challenge idea? Propose it"
 * link): a small playful card on soft yellow. A lightbulb wiggles gently
 * when the card scrolls into view (inView), "Your idea could become
 * tomorrow's challenge for the whole world", a real "Propose a challenge"
 * button (haptic). Someone whose proposal was already played sees it as
 * proof: "Your idea "X" was played in 4 cities". ✕ hides it for 7 days.
 * Guests get the sign-up sheet first (SPEC 8.6).
 */
export function ProposeCard({ inView }: { inView: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [played, setPlayed] = useState<{ text: string; cities: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(HIDE_KEY)
      .then(v => setHidden(v !== null && Number(v) > Date.now()))
      .catch(() => setHidden(false));
  }, []);
  useEffect(() => {
    if (!account) { setPlayed(null); return; }
    let alive = true;
    playedIdea().then(p => { if (alive) setPlayed(p); }).catch(() => {});
    return () => { alive = false; };
  }, [account]);

  // A gentle wiggle each time the card comes into view (at most every few seconds).
  const angle = useSharedValue(0);
  const lastWiggle = useRef(0);
  useEffect(() => {
    if (!inView || reduced || hidden !== false || Date.now() - lastWiggle.current < 4000) return;
    lastWiggle.current = Date.now();
    angle.value = withSequence(
      withTiming(-12, { duration: 120 }), withTiming(10, { duration: 140 }), withTiming(-7, { duration: 130 }),
      withTiming(4, { duration: 120 }), withTiming(0, { duration: 110 }),
    );
  }, [inView, reduced, hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  const bulbStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));

  if (hidden !== false) return null;

  const open = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    track('propose_card_tapped', { signed_in: !!account, played: !!played });
    router.push((account ? '/daily/propose?source=today_card'
      : '/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fpropose%3Fsource%3Dtoday_card') as never);
  };
  const hide = () => {
    Haptics.selectionAsync().catch(() => {});
    track('propose_card_hidden', {});
    setHidden(true);
    AsyncStorage.setItem(HIDE_KEY, String(Date.now() + HIDE_MS)).catch(() => {});
  };

  return (
    <View style={styles.card} testID="today-propose">
      <Pressable onPress={hide} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel={t('propose.cardHide')}>
        <Ionicons name="close" size={18} color={colors.muted} />
      </Pressable>
      <View style={styles.top}>
        {/* The lightbulb: a glowing disc, three rays, the bulb; it wiggles from its base. */}
        <Animated.View style={[styles.bulbBox, bulbStyle]} accessible={false}>
          <View style={styles.glow} />
          <View style={[styles.ray, styles.rayL]} />
          <View style={[styles.ray, styles.rayM]} />
          <View style={[styles.ray, styles.rayR]} />
          <Ionicons name="bulb" size={34} color={YELLOW} style={styles.bulb} />
        </Animated.View>
        <View style={styles.body}>
          <Text style={styles.title}>💡 {t('propose.linkAsk')}</Text>
          <Text style={styles.text}>{t('propose.cardBody')}</Text>
        </View>
      </View>
      {played && (
        <Text style={styles.proof} testID="today-propose-proof">{t('propose.cardPlayed', { text: played.text, count: played.cities })}</Text>
      )}
      <Pressable onPress={open} style={({ pressed }) => [styles.button, pressed && styles.pressed]} accessibilityRole="button" testID="today-propose-button">
        <Text style={styles.buttonText}>{t('propose.cta')}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:       { borderRadius: Radius.card, padding: 16, gap: 12, backgroundColor: tint(YELLOW, 0.2), borderWidth: 1.5, borderColor: tint(YELLOW, 0.55) },
  close:      { position: 'absolute', top: 6, right: 6, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  top:        { flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 24 },
  bulbBox:    { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', transformOrigin: '50% 85%' },
  glow:       { position: 'absolute', top: 7, left: 7, width: 44, height: 44, borderRadius: 22, backgroundColor: c.bg2 },
  ray:        { position: 'absolute', width: 3, height: 9, borderRadius: 2, backgroundColor: YELLOW },
  rayL:       { top: 4, left: 9, transform: [{ rotate: '-40deg' }] },
  rayM:       { top: 0, left: 27.5 },
  rayR:       { top: 4, right: 9, transform: [{ rotate: '40deg' }] },
  bulb:       { marginTop: 4 },
  body:       { flex: 1, gap: 4 },
  title:      { fontSize: 16, lineHeight: 21, fontWeight: '800', color: c.text },
  text:       { fontSize: 14, lineHeight: 19, fontWeight: '600', color: c.text, opacity: 0.85 },
  proof:      { fontSize: 13, lineHeight: 18, fontWeight: '700', color: c.text, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.md, backgroundColor: c.bg2 },
  button:     { alignSelf: 'stretch', minHeight: 48, borderRadius: Radius.full, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  pressed:    { opacity: 0.85, transform: [{ scale: 0.98 }] },
  buttonText: { fontSize: 15, fontWeight: '800', color: c.onCta },
});
