/**
 * EmojiPanel — shared emoji picker for all chat composers.
 *
 * Used by:
 *   ChatInput.tsx         (city channel + event chat)
 *   app/dm/[id].tsx       (direct messages)
 *
 * Design: appears above the composer, same dark background, scrollable grid.
 * No library required — plain Unicode emojis.
 */

import { ScrollView, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants';

// ~120 frequently-used emojis — mirrors web EmojiPicker.jsx
export const EMOJIS = [
  // Smileys
  '😀','😂','🥹','😊','😍','🤩','😎','🥳','🤔','😅','😭','🥺','😤','🤣','😏','🙄',
  '😴','😬','🤯','🤗','😇','🙃','😋','😜','🫡',
  // Gestures
  '👍','👎','👋','🙏','💪','🤙','👌','✌️','🤞','🫶','👏','🤌','💅','🙌','🫠',
  // Hearts
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❤️‍🔥','💕','💞',
  // Symbols
  '💯','✨','🎉','🔥','⚡','🌈','💫','⭐','🌟','🎊','🏆','🎯','🎲','💡','🚀',
  // Food & drink
  '🍺','🥂','🍹','🍻','☕','🍕','🍔','🍦','🎂','🥐','🌮','🍿',
  // Nature
  '🌍','🌙','🌸','🌺','🌴','🍀','🦋','🌅','🏖️','🌃',
  // Misc
  '👀','💀','🙈','🐱','🐶','🦊','🐼','🦁','🦄','🎭',
];

interface Props {
  onSelect: (emoji: string) => void;
}

export function EmojiPanel({ onSelect }: Props) {
  return (
    <ScrollView
      style={styles.panel}
      keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.grid}>
        {EMOJIS.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            style={styles.item}
            onPress={() => onSelect(emoji)}
            activeOpacity={0.6}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: {
    maxHeight:       220,
    backgroundColor: 'rgba(22, 18, 16, 0.99)',
    borderTopWidth:  1,
    borderTopColor:  Colors.border,
  },
  grid: {
    flexDirection: 'row',
    flexWrap:      'wrap',
    padding:       6,
  },
  item: {
    width:          '12.5%', // 8 columns
    aspectRatio:    1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 24,
  },
});
