import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { Message } from '@/types';

interface Props {
  message:  Message;
  myGuestId: string | undefined;
}

export function ChatMessage({ message, myGuestId }: Props) {
  const isMine = Boolean(myGuestId && message.guest_id === myGuestId);

  // System message — centered label
  if (message.type === 'system') {
    return (
      <View style={styles.systemRow}>
        <Text style={styles.systemText}>{message.content}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, isMine && styles.rowMine]}>
      {!isMine && (
        <Text style={styles.nickname}>{message.nickname}</Text>
      )}

      {message.type === 'image' && message.image_url ? (
        <Image
          source={{ uri: message.image_url }}
          style={styles.image}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
          <Text style={styles.bubbleText}>{message.content}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  systemRow: {
    alignItems:    'center',
    paddingVertical: Spacing.xs,
  },
  systemText: {
    fontSize:  FontSizes.xs,
    color:     Colors.muted2,
    textAlign: 'center',
  },

  row: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   2,
    alignItems:        'flex-start',
  },
  rowMine: {
    alignItems: 'flex-end',
  },

  nickname: {
    fontSize:     FontSizes.xs,
    color:        Colors.muted,
    marginBottom: 2,
    marginLeft:   Spacing.xs,
  },

  bubble: {
    maxWidth:     '80%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   6,
  },
  bubbleOther: {
    backgroundColor: Colors.bg3,
    borderBottomLeftRadius: Radius.sm,
  },
  bubbleMine: {
    backgroundColor: Colors.accent,
    borderBottomRightRadius: Radius.sm,
  },
  bubbleText: {
    fontSize:   FontSizes.sm,
    color:      Colors.text,
    lineHeight: 20,
  },

  image: {
    width:        200,
    height:       200,
    borderRadius: Radius.md,
    marginTop:    2,
  },
});
