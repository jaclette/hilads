import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useThemedStyles } from '@/context/ThemeContext';
import { FontSizes, Radius, Space, Spacing, type ThemeColors } from '@/constants';
import { DualPhoto } from '@/ui';
import { ACCENTS, TANGERINE } from '@/ui/joy';

/**
 * The publishing screen of a Daily photo (full screen, over the form): the photo
 * floating, a bar with the real progress (the upload's bytes, then the post) and
 * a cheerful line that changes every two seconds. `phase`: 'upload' while the
 * photo goes up, 'post' while the server saves it, 'done' for the last beat at 100%.
 */
export type PublishPhase = 'upload' | 'post' | 'done';

const UPLOAD_SHARE = 0.8;   // the bar's part for the upload; the post fills the rest
const LINE_EVERY_MS = 2000;
const UPLOAD_LINES = ['publishing.pack', 'publishing.send', 'publishing.polish'] as const;
const POST_LINES = ['publishing.map', 'publishing.almost'] as const;

export function PublishProgress({ photo, selfie, upload, phase, city }: {
  photo: string;
  selfie: string | null;
  upload: number;          // 0..1, the uploads still to finish
  phase: PublishPhase;
  city: string | null;
}) {
  const { t } = useTranslation('daily');
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();

  // The bar: the upload's real share, then a slow creep while the server works, then full.
  const bar = useSharedValue(0);
  useEffect(() => {
    if (phase === 'done') bar.value = withTiming(1, { duration: 250 });
    else if (phase === 'post') {
      bar.value = withSequence(withTiming(UPLOAD_SHARE, { duration: 200 }),
                               withTiming(0.97, { duration: 6000, easing: Easing.out(Easing.cubic) }));
    } else bar.value = withTiming(Math.max(0.04, upload * UPLOAD_SHARE), { duration: 250 });
  }, [phase, upload]); // eslint-disable-line react-hooks/exhaustive-deps
  const fill = useAnimatedStyle(() => ({ width: `${Math.round(bar.value * 100)}%` }));

  // The percentage, read from the bar a few times a second.
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPct(Math.round(bar.value * 100)), 120);
    return () => clearInterval(id);
  }, [bar]);

  // The photo floats; three dots hop.
  const float = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    float.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(float);
  }, [reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const floating = useAnimatedStyle(() => ({
    transform: [{ translateY: -8 * float.value }, { rotate: `${-2 + 4 * float.value}deg` }],
  }));

  // The line: the upload's while it goes up, the post's after.
  const lines: readonly string[] = phase === 'upload' ? UPLOAD_LINES : POST_LINES;
  const [n, setN] = useState(0);
  useEffect(() => { setN(0); }, [phase]);
  useEffect(() => {
    const id = setInterval(() => setN(i => i + 1), LINE_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  const key = phase === 'done' ? 'publishing.done' : lines[n % lines.length];
  const line = key === 'publishing.map' && !city ? t('publishing.mapNoCity') : t(key, { city: city ?? '' });

  return (
    <View style={styles.wrap} accessibilityViewIsModal accessibilityLiveRegion="polite">
      <Animated.View style={[styles.photoWrap, floating]}>
        <DualPhoto main={{ uri: photo }} selfie={selfie ? { uri: selfie } : null} style={styles.photo} />
      </Animated.View>
      <Text style={styles.title} accessibilityRole="header">{t('publishing.title')}</Text>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
        <Animated.View style={[styles.fill, fill]} />
      </View>
      <Text style={styles.pct}>{pct}%</Text>
      <View style={styles.lineBox}>
        <Animated.Text key={key} entering={reduced ? undefined : FadeIn.duration(250)} exiting={reduced ? undefined : FadeOut.duration(150)}
                       style={styles.line}>{line}</Animated.Text>
      </View>
      <View style={styles.dots}>
        {ACCENTS.slice(0, 3).map((color, i) => <Dot key={color} color={color} delay={i * 160} still={reduced} />)}
      </View>
    </View>
  );
}

function Dot({ color, delay, still }: { color: string; delay: number; still: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    y.value = withDelay(delay, withRepeat(withSequence(
      withTiming(-10, { duration: 280, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 240 }),
    ), -1));
    return () => cancelAnimation(y);
  }, [still]); // eslint-disable-line react-hooks/exhaustive-deps
  const hop = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }, hop]} />;
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: Space.md, zIndex: 20 },
  photoWrap: { width: 200, height: 200, marginBottom: Space.md, borderRadius: 24, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  photo:     { width: 200, height: 200, borderRadius: 24, backgroundColor: c.bg3 },
  title:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, textAlign: 'center' },
  track:     { alignSelf: 'stretch', maxWidth: 320, width: '100%', height: 12, borderRadius: Radius.full, backgroundColor: c.bg3, overflow: 'hidden', marginTop: Space.sm },
  fill:      { height: '100%', borderRadius: Radius.full, backgroundColor: TANGERINE },
  pct:       { fontSize: FontSizes.md, fontWeight: '800', color: c.text, fontVariant: ['tabular-nums'] },
  lineBox:   { minHeight: 44, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  line:      { fontSize: FontSizes.body, fontWeight: '600', color: c.muted, textAlign: 'center' },
  dots:      { flexDirection: 'row', gap: Space.sm, height: 20, alignItems: 'flex-end' },
});
