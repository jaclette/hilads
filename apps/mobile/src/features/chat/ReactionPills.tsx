/**
 * ReactionPills - renders emoji reaction summary below a message bubble.
 *
 * Each pill shows the emoji + count. Viewer's own reactions are highlighted.
 * Tapping a pill toggles the reaction (same endpoint as long-press picker).
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Reaction } from '@/types';
import { Border, Radius, type ThemeColors } from '@/constants';
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
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
          accessibilityRole="button"
          accessibilityLabel={`${r.emoji} ${r.count}`}
          accessibilityState={{ selected: r.self }}
        >
          <Text style={styles.emoji}>{r.emoji}</Text>
          {r.count > 1 && <Text style={[styles.count, r.self && styles.countActive]}>{r.count}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:         { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4, paddingLeft: 4 },
  rowRight:    { justifyContent: 'flex-end', paddingLeft: 0, paddingRight: 4 },
  // 32 high; hitSlop brings the touch area to 44.
  pill:        { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 10, borderRadius: Radius.full,
                 borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  pillActive:  { backgroundColor: c.primaryTint, borderColor: c.primary },
  emoji:       { fontSize: 14 },
  count:       { fontSize: 12, fontWeight: '700', color: c.muted },
  countActive: { color: c.primaryOnTint },
});
