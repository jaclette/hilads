import { ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Tappable } from '@/ui';
import type { WaveSource, WaveState } from '@/api/members';
import { useWave, waveLabelKey } from './wave';

/**
 * Wave 👋 (shared): `pill` is the row button ("👋 Wave" → "👋 Waved" → "Waved back 🎉"),
 * `badge` the small round 👋 on a Here now avatar. A pill that is done stays visible but
 * quiet; a mutual wave opens the "say hi in a chat" suggestion.
 */
export function WaveButton({ user, initial, source, variant = 'pill', testID }: {
  user: { id: string; displayName: string };
  initial: WaveState;
  source: WaveSource;
  variant?: 'pill' | 'badge';
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('members');
  const { state, busy, wave } = useWave(user, initial, source);
  const done = state === 'sent' || state === 'mutual';
  const label = t(waveLabelKey(state));
  const a11y = t(`wave.a11y.${state}`, { name: user.displayName });

  if (variant === 'badge') {
    return (
      <Tappable onPress={wave} disabled={state === 'sent'} style={[styles.badge, done && styles.badgeDone]} hitSlop={8}
                accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: state === 'sent' }} testID={testID}>
        <Text style={styles.badgeEmoji}>{state === 'mutual' ? '🎉' : done ? '✓' : '👋'}</Text>
      </Tappable>
    );
  }
  return (
    <Tappable onPress={wave} disabled={state === 'sent'} style={[styles.pill, done ? styles.pillDone : state === 'received' ? styles.pillBack : null]}
              accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: state === 'sent', busy }} testID={testID}>
      {busy ? <ActivityIndicator size="small" color={colors.primaryOnTint} /> : (
        <Text style={[styles.pillText, done && styles.pillTextDone, state === 'received' && styles.pillTextBack]} numberOfLines={1}>{label}</Text>
      )}
    </Tappable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pill:         { minHeight: 34, minWidth: 76, paddingHorizontal: Space.md, borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: c.primaryTint },
  pillBack:     { backgroundColor: c.primary },
  pillDone:     { backgroundColor: c.localBg },
  pillText:     { ...Type.caption, fontWeight: '800', color: c.primaryOnTint },
  pillTextDone: { color: c.localText },
  pillTextBack: { color: c.onPrimary },
  badge:        { position: 'absolute', right: -4, bottom: -2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  badgeDone:    { backgroundColor: c.localBg, borderColor: c.localBg },
  badgeEmoji:   { fontSize: 13, lineHeight: 16 },
});
