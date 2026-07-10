/**
 * ShareToWorldPill - one-tap pill that posts an INTERNATIONAL challenge's
 * deeplink into the global World channel (see useShareToWorld). Sibling of
 * ShareToCityPill; shown only for international challenges so their owner can
 * spread them worldwide, not just in their own city.
 */

import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, FontSizes } from '@/constants';
import { useShareToWorld } from '@/lib/useShareToWorld';

interface Props {
  url: string;
  /** Entity title, posted after the label above the link for context. */
  title?: string;
  /** Type prefix incl. emoji, e.g. "🌍 International Challenge 🇻🇳 → 🇧🇷". */
  label?: string;
  style?: object;
}

export function ShareToWorldPill({ url, title, label, style }: Props) {
  const { t } = useTranslation('common');
  const { canShare, sharing, shareToWorld } = useShareToWorld();
  if (!canShare) return null;

  const btnLabel = t('shareToWorld', { defaultValue: 'Share on World' });
  const head = [label?.trim(), title?.trim()].filter(Boolean).join(': ');
  const message = head ? `${head}\n${url}` : url;
  return (
    <TouchableOpacity
      style={[styles.pill, style]}
      onPress={() => shareToWorld(message)}
      activeOpacity={0.8}
      disabled={sharing}
      accessibilityRole="button"
      accessibilityLabel={btnLabel}
    >
      {sharing
        ? <ActivityIndicator size="small" color={Colors.accent} />
        : <Text style={styles.text} numberOfLines={1}>🌍 {btnLabel}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full,
    backgroundColor: 'rgba(255,122,60,0.14)', borderWidth: 1, borderColor: 'rgba(255,122,60,0.5)',
  },
  text: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.accent },
});
