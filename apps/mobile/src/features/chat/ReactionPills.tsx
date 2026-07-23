/**
 * ReactionPills - renders emoji reaction summary below a message bubble.
 *
 * Each pill shows the emoji + count. Viewer's own reactions are highlighted.
 * Tapping a pill toggles the reaction (same endpoint as long-press picker).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Reaction } from '@/types';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

interface Props {
  reactions: Reaction[];
  onReact:   (emoji: string) => void;
  isMine:    boolean;   // true = sender is current user → align right
}

export function ReactionPills({ reactions, onReact, isMine }: Props) {
  const styles = useThemedStyles(makeStyles);
  if (!reactions || reactions.length === 0) return null;

  return (
    <View style={[styles.row, isMine && styles.rowRight]}>
      {reactions.map(r => (
        <TouchableOpacity
          key={r.emoji}
          style={[styles.pill, r.self && styles.pillActive]}
          onPress={() => onReact(r.emoji)}
          activeOpacity={0.7}
        >
          <Text style={styles.emoji}>{r.emoji}</Text>
          {r.count > 1 && <Text style={[styles.count, r.self && styles.countActive]}>{r.count}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            4,
    marginTop:      4,
    paddingLeft:    8,
  },
  rowRight: {
    justifyContent: 'flex-end',
    paddingLeft:    0,
    paddingRight:   8,
  },
  pill: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             3,
    backgroundColor: c.overlay,
    borderRadius:    12,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderWidth:     1,
    borderColor:     'transparent',
  },
  pillActive: {
    backgroundColor: 'rgba(255,122,60,0.18)',
    borderColor:     c.accent,
  },
  emoji: {
    fontSize: 14,
  },
  count: {
    fontSize:  12,
    color:     c.muted2,
    fontWeight: '600',
  },
  countActive: {
    color: c.accentText,
  },
});
