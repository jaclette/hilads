/**
 * ShareToCityPill - one-tap pill that posts this entity's deeplink into the
 * user's current city feed (see useShareToCity). Accent-styled because it's a
 * primary "spread the word" action. Renders nothing when there's no current
 * city channel to post to.
 */

import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, FontSizes } from '@/constants';
import { useShareToCity } from '@/lib/useShareToCity';

interface Props {
  url: string;
  /** Entity title, posted after the label above the link for context. */
  title?: string;
  /** Type prefix incl. emoji, e.g. "⚡ Challenge" / "🗣️ Hi now" / "🎉 Hi plan". */
  label?: string;
  style?: object;
}

export function ShareToCityPill({ url, title, label, style }: Props) {
  const { t } = useTranslation('common');
  const { canShare, sharing, shareToCity } = useShareToCity();
  if (!canShare) return null;

  const btnLabel = t('shareToCity', { defaultValue: 'Share in my city' });
  // "⚡ Challenge: My title\nhttps://..." - the city feed renders the URL card.
  const head = [label?.trim(), title?.trim()].filter(Boolean).join(': ');
  const message = head ? `${head}\n${url}` : url;
  return (
    <TouchableOpacity
      style={[styles.pill, style]}
      onPress={() => shareToCity(message)}
      activeOpacity={0.8}
      disabled={sharing}
      accessibilityRole="button"
      accessibilityLabel={btnLabel}
    >
      {sharing
        ? <ActivityIndicator size="small" color={Colors.accent} />
        : <Text style={styles.text} numberOfLines={1}>📣 {btnLabel}</Text>}
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
