import { thumbUrl } from '@/lib/imageThumb';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar } from '@/ui';
import type { MentionSuggestion } from '@/api/mentions';

// Autocomplete list shown above the composer while typing "@". Members + (in a
// city) currently-online guests, the latter tagged "Guest · online" and live-only.
export function MentionSuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: MentionSuggestion[];
  onSelect: (s: MentionSuggestion) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('chat');
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.panel}>
      <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
        {suggestions.map(s => {
          const key = s.userId ?? s.guestId ?? s.username;
          return (
          <TouchableOpacity key={key} style={styles.row} onPress={() => onSelect(s)} activeOpacity={0.6} accessibilityRole="button">
            {s.isHere
              ? <View style={styles.here}><Ionicons name="megaphone-outline" size={18} color={colors.primaryOnTint} /></View>
              : <Avatar uri={s.avatarUrl ? thumbUrl(s.thumbAvatarUrl ?? s.avatarUrl) : null} name={s.displayName || key} size={36} fallback="color" />}
            <View style={styles.body}>
              <Text style={styles.username}>@{s.username}</Text>
              <Text style={styles.name} numberOfLines={1}>{s.isHere ? s.displayName : s.isGuest ? t('guestOnline') : s.displayName}</Text>
            </View>
          </TouchableOpacity>
        ); })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  panel:    { maxHeight: 220, backgroundColor: c.bg2, borderTopWidth: 1, borderTopColor: c.line },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 8 },
  here:     { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  body:     { flex: 1, minWidth: 0 },
  username: { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  name:     { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
});
