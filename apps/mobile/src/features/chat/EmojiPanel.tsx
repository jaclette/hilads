/**
 * EmojiPanel - shared emoji picker for all chat composers.
 *
 * Used by:
 *   ChatInput.tsx         (city channel + event chat)
 *   app/dm/[id].tsx       (direct messages)
 *
 * Design: appears above the composer, same dark background, scrollable grid.
 * No library required - plain Unicode emojis.
 */

import { ScrollView, View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

// ~120 frequently-used emojis - mirrors web EmojiPicker.jsx
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
  const styles = useThemedStyles(makeStyles);

  return (
    <ScrollView
      style={styles.panel}
      keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator={false}
      // Stop the drag-past-the-last-emoji into empty space: no iOS rubber-band
      // bounce, no Android overscroll stretch/glow. Content ends at the grid.
      bounces={false}
      overScrollMode="never"
    >
      <View style={styles.grid}>
        {EMOJIS.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            style={styles.item}
            onPress={() => onSelect(emoji)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={emoji}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  panel: {
    maxHeight:       220,
    backgroundColor: c.bg2,
    borderTopWidth:  1,
    borderTopColor:  c.line,
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
