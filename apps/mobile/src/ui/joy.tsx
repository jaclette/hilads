import { useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, Text, View, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { FLAGS } from './flags';
import { ThemeIcon } from './ThemeIcon';

/**
 * The joyful layer (docs/daily-challenge/DESIGN.md): theme colors, flag
 * stickers, answer bubbles, highlighted key words, the tangerine button,
 * stamps, the dashed route, confetti and the official wordmark. Reading
 * surfaces stay cream and ink; every text here keeps 4.5:1.
 */

const LOGO = require('../../assets/logo/hilads-icon.svg'); // eslint-disable-line @typescript-eslint/no-require-imports

export const INK = '#2A1C13';
export const TANGERINE = '#FF7A3D';
export const TANGERINE_TEXT = '#B2552A';   // tangerine as text on cream (4.6:1)

type ThemeColor = { fill: string; onFill: string; textLight: string; textDark: string };
export const THEME_COLORS: Record<string, ThemeColor> = {
  hidden_gem: { fill: '#1FB5A8', onFill: INK, textLight: '#157E75', textDark: '#1FB5A8' },
  taste:      { fill: '#FF6F61', onFill: INK, textLight: '#B74F45', textDark: '#FF6F61' },
  ask_local:  { fill: '#3D9BF0', onFill: INK, textLight: '#2E75B6', textDark: '#3D9BF0' },
  local_find: { fill: '#FF7EB0', onFill: INK, textLight: '#AD5577', textDark: '#FF7EB0' },
  night_out:  { fill: '#5B5BD6', onFill: '#FFFFFF', textLight: '#5B5BD6', textDark: '#9A9AF5' },
  sip:        { fill: '#FFC93C', onFill: INK, textLight: '#896C20', textDark: '#FFC93C' },
  only_here:  { fill: '#FF8A3D', onFill: INK, textLight: '#A85B28', textDark: '#FF8A3D' },
  special:    { fill: '#FF7A3D', onFill: INK, textLight: '#B2552A', textDark: '#FF7A3D' },
};
export const ACCENTS = ['#FFC93C', '#FF6F61', '#1FB5A8', '#3D9BF0', '#FF7EB0', '#FF7A3D'];

export function themeColor(key: string | null | undefined): ThemeColor {
  return THEME_COLORS[key ?? ''] ?? THEME_COLORS.special;
}

/** A 16% tint of a fill, for a chip or highlight ground (ink text on it). */
export function tint(hex: string, alpha = 0.16): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A city's flag as a round sticker: white border, soft shadow. Decorative. */
export function FlagSticker({ country, size = 28, style }: { country: string | null | undefined; size?: number; style?: StyleProp<ViewStyle> }) {
  const source = country ? FLAGS[country.toUpperCase()] : undefined;
  if (!source) return null;
  const border = Math.max(2, Math.round(size / 14));
  return (
    <View style={[styles.sticker, { width: size, height: size, borderRadius: size / 2, borderWidth: border }, style]}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Image source={source} style={{ width: size * 1.34, height: size }} contentFit="cover" />
    </View>
  );
}

/** The value given to the day's question, in a speech bubble (white with ink; on dark grounds the card color). */
export function AnswerBubble({ text, tail = 'left', onPhoto = false, size = 'md', style }: {
  text: string; tail?: 'left' | 'right' | 'none'; onPhoto?: boolean; size?: 'sm' | 'md' | 'lg'; style?: StyleProp<ViewStyle>;
}) {
  const { colors, theme } = useTheme();
  const bg = onPhoto || theme !== 'dark' ? '#FFFFFF' : '#3A2F26';   // dark: a step above the card
  const fg = onPhoto || theme !== 'dark' ? INK : colors.text;
  const fs = size === 'sm' ? 13 : size === 'lg' ? 20 : 15;
  return (
    <View style={[styles.bubbleWrap, style]}>
      <View style={[styles.bubble, { backgroundColor: bg, paddingHorizontal: fs * 0.75, paddingVertical: fs * 0.4, borderRadius: fs }]}>
        <Text style={[styles.bubbleText, { color: fg, fontSize: fs, lineHeight: fs * 1.25 }]} numberOfLines={1}>{text}</Text>
      </View>
      {tail !== 'none' && (
        <View style={[styles.tail, { backgroundColor: bg, width: fs * 0.7, height: fs * 0.7, bottom: -fs * 0.22 },
                      tail === 'left' ? { left: fs * 0.9 } : { right: fs * 0.9 }]} />
      )}
    </View>
  );
}

/**
 * A title whose key word (marked "*word*" in the copy) sits on a colored
 * block, as on the store captions. No mark: plain text.
 */
export function HighlightText({ text, color = TANGERINE, style }: { text: string; color?: string; style?: StyleProp<TextStyle> }) {
  const parts = text.split('*');
  const onColor = color === THEME_COLORS.night_out.fill ? '#FFFFFF' : INK;
  return (
    <Text style={style}>
      {parts.map((p, i) => (i % 2 === 1
        ? <Text key={i} style={[styles.hl, { backgroundColor: color, color: onColor }]}>{` ${p} `}</Text>
        : p))}
    </Text>
  );
}

/** The primary action (DESIGN.md proposal): tangerine with ink text; `onPhoto`: solid white. 52 px, radius 16. */
export function JoyButton({ label, onPress, icon, onPhoto = false, style }: {
  label: string; onPress?: () => void; icon?: React.ComponentProps<typeof Ionicons>['name']; onPhoto?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
               style={({ pressed }) => [styles.btn, { backgroundColor: onPhoto ? '#FFFFFF' : TANGERINE, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
      {icon && <Ionicons name={icon} size={20} color={onPhoto ? TANGERINE_TEXT : INK} />}
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

/** A theme chip in its color (fill + its text color), with the theme icon. */
export function ThemeChipJoy({ theme, label }: { theme: string; label: string }) {
  const c = themeColor(theme);
  return (
    <View style={[styles.chip, { backgroundColor: c.fill }]}>
      <ThemeIcon theme={theme} size={15} color={c.onFill} />
      <Text style={[styles.chipText, { color: c.onFill }]}>{label}</Text>
    </View>
  );
}

/** A passport stamp: round, dashed border in the theme color; earned stamps are filled with a tint. */
export function Stamp({ theme, label, earned = true, size = 72 }: { theme: string; label?: string; earned?: boolean; size?: number }) {
  const { theme: mode } = useTheme();
  const c = themeColor(theme);
  const line = earned ? c.fill : mode === 'dark' ? '#4A3E34' : '#D9CBBD';
  return (
    <View style={{ alignItems: 'center', gap: 4, width: size + 8 }}>
      <View style={[styles.stamp, { width: size, height: size, borderRadius: size / 2, borderColor: line, backgroundColor: earned ? tint(c.fill, 0.18) : 'transparent',
                                    transform: [{ rotate: earned ? '-8deg' : '0deg' }] }]}>
        <ThemeIcon theme={theme} size={size * 0.4} color={earned ? (mode === 'dark' ? c.textDark : c.textLight) : line} />
      </View>
      {!!label && <Text style={[styles.stampLabel, { color: mode === 'dark' ? '#F3EAE0' : INK }]} numberOfLines={2}>{label}</Text>}
    </View>
  );
}

/** The dashed route motif behind a header (decorative, 30% opacity). */
export function DashedRoute({ width, height, color, style }: { width: number; height: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <Svg width={width} height={height} style={[{ position: 'absolute' }, style]} pointerEvents="none">
      <Path d={`M 4 ${height * 0.8} C ${width * 0.25} ${height * 0.1}, ${width * 0.45} ${height * 1.1}, ${width * 0.7} ${height * 0.4} S ${width - 10} ${height * 0.2}, ${width - 4} ${height * 0.5}`}
            fill="none" stroke={color ?? colors.text} strokeOpacity={0.3} strokeWidth={1.5} strokeDasharray="6 6" strokeLinecap="round" />
    </Svg>
  );
}

/** The official lockup: the app icon mark and the "hilads" wordmark (ExtraBold, the logo's orange; white on dark grounds), never plain UI text. */
export function Wordmark({ height = 28, onDark = false }: { height?: number; onDark?: boolean }) {
  const { theme } = useTheme();
  return (
    <View style={styles.lockup} accessibilityRole="header" accessibilityLabel="Hilads">
      <Image source={LOGO} style={{ width: height, height }} contentFit="contain" />
      <Text style={[styles.word, { fontSize: height * 1.02, lineHeight: height * 1.1, color: onDark ? '#FFFFFF' : theme === 'dark' ? '#FF8A50' : '#BF4E34' }]}>hilads</Text>
    </View>
  );
}

/** A confetti burst for a victory moment; nothing with "reduce motion" (the caller shows a simple fade). */
export function Confetti({ run, count = 28 }: { run: boolean; count?: number }) {
  const reduced = useReducedMotion();
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (i * 37) % 100, delay: (i * 53) % 300, color: ACCENTS[i % ACCENTS.length], rot: (i * 47) % 360, drift: ((i * 29) % 60) - 30,
  })), [count]);
  if (!run || reduced) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {pieces.map((p, i) => <Piece key={i} {...p} />)}
    </View>
  );
}

function Piece({ x, delay, color, rot, drift }: { x: number; delay: number; color: string; rot: number; drift: number }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(delay, withTiming(1, { duration: 1200, easing: Easing.out(Easing.quad) })); }, [delay, t]);
  const st = useAnimatedStyle(() => ({
    opacity: 1 - t.value * 0.9,
    transform: [{ translateY: -20 + t.value * 420 }, { translateX: drift * t.value }, { rotate: `${rot + t.value * 360}deg` }],
  }));
  return <Animated.View style={[styles.piece, { left: `${x}%`, backgroundColor: color }, st]} />;
}

/** A sticker that pops in (scale 0.6 → 1, small bounce); a plain fade with "reduce motion". */
export function StickerPop({ children, play }: { children: ReactNode; play: boolean }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(play ? 0 : 1);
  useEffect(() => {
    if (!play) return;
    s.value = 0;
    s.value = withTiming(1, { duration: reduced ? 150 : 420, easing: reduced ? Easing.linear : Easing.out(Easing.back(2.2)) });
  }, [play, reduced, s]);
  const st = useAnimatedStyle(() => (reduced ? { opacity: s.value } : { opacity: Math.min(1, s.value * 2), transform: [{ scale: 0.6 + s.value * 0.4 }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  sticker:    { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderColor: '#FFFFFF', backgroundColor: '#FFFFFF',
                shadowColor: '#2A1406', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  bubbleWrap: { alignSelf: 'flex-start' },
  bubble:     { shadowColor: '#2A1406', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  bubbleText: { fontWeight: '800' },
  tail:       { position: 'absolute', transform: [{ rotate: '45deg' }], borderRadius: 2 },
  hl:         { fontWeight: '800', borderRadius: 6 },
  btn:        { height: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 18 },
  btnText:    { fontSize: 16, fontWeight: '800', color: INK },
  chip:       { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999 },
  chipText:   { fontSize: 13, fontWeight: '800' },
  stamp:      { borderWidth: 2.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  stampLabel: { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  lockup:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word:       { fontWeight: '800', letterSpacing: -0.9 },
  piece:      { position: 'absolute', top: 0, width: 9, height: 14, borderRadius: 2 },
});
