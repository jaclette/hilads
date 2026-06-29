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
  style?: object;
}

export function ShareToCityPill({ url, style }: Props) {
  const { t } = useTranslation('common');
  const { canShare, sharing, shareToCity } = useShareToCity();
  if (!canShare) return null;

  const label = t('shareToCity', { defaultValue: 'Share in my city' });
  return (
    <TouchableOpacity
      style={[styles.pill, style]}
      onPress={() => shareToCity(url)}
      activeOpacity={0.8}
      disabled={sharing}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {sharing
        ? <ActivityIndicator size="small" color={Colors.accent} />
        : <Text style={styles.text} numberOfLines={1}>📣 {label}</Text>}
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
