import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Colors, FontSizes } from '@/constants';
import { avatarColor } from '@/lib/avatarColors';
import type { MentionSuggestion } from '@/api/mentions';

// Autocomplete list shown above the composer while typing "@". Mirrors the
// EmojiPanel overlay pattern. Registered users only (backend excludes guests).
export function MentionSuggestions({
  suggestions,
  onSelect,
}: {
  suggestions: MentionSuggestion[];
  onSelect: (s: MentionSuggestion) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.panel}>
      <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
        {suggestions.map(s => (
          <TouchableOpacity key={s.userId} style={styles.row} onPress={() => onSelect(s)} activeOpacity={0.6}>
            <View style={[styles.avatar, { backgroundColor: avatarColor(s.userId) }]}>
              {s.avatarUrl
                ? <Image source={{ uri: s.avatarUrl }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
                : <Text style={styles.letter}>{(s.displayName[0] ?? '?').toUpperCase()}</Text>}
            </View>
            <View style={styles.body}>
              <Text style={styles.username}>@{s.username}</Text>
              <Text style={styles.name} numberOfLines={1}>{s.displayName}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight:       220,
    backgroundColor: 'rgba(22, 18, 16, 0.99)',
    borderTopWidth:  1,
    borderTopColor:  Colors.border,
  },
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 16,
    paddingVertical:   8,
  },
  avatar: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    overflow:       'hidden',
  },
  letter:   { color: '#fff', fontSize: 13, fontWeight: '700' },
  body:     { flex: 1, minWidth: 0 },
  username: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text },
  name:     { fontSize: FontSizes.xs, color: Colors.muted },
});
