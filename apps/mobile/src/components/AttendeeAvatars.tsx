import { thumbUrl } from '@/lib/imageThumb';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { ParticipantPreview } from '@/types';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar } from '@/ui';

// Horizontal row of overlapping circular attendee avatars for event cards.
// The photo when available, else the initial on the person's own color.
// Renders nothing when nobody has joined. Tapping is left to the parent card
// (the row sits inside the card's touchable → opens the detail/list).

const DEFAULT_SIZE = 32;
const OVERLAP      = 10;
const MAX_SHOWN    = 5;

type Props = {
  preview:      ParticipantPreview[];
  total:        number;
  size?:        number;
  /** Cutout border color - set to the surface behind the row (card = bg2, screen = bg). */
  borderColor?: string;
  /** When set, the row becomes tappable (opens the members list) and stops the
   *  tap from bubbling to the parent card. */
  onPress?:     () => void;
};

export function AttendeeAvatars({ preview, total, size = DEFAULT_SIZE, borderColor, onPress }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const bc = borderColor ?? colors.bg2;

  const shown = preview.slice(0, MAX_SHOWN);
  if (total <= 0 || shown.length === 0) return null;

  const overflow = total - shown.length;
  const dim      = { width: size + 4, height: size + 4 };

  const Container: any = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Container style={styles.row} {...containerProps}>
      {shown.map((p, i) => (
        <View key={p.id} style={[styles.ring, { borderRadius: size, borderColor: bc, marginLeft: i > 0 ? -OVERLAP : 0 }]}>
          <Avatar uri={p.thumbAvatarUrl ? thumbUrl(p.thumbAvatarUrl) : null} name={p.displayName || '?'} size={size} fallback="color" />
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles.ring, styles.extra, dim, { borderRadius: size, marginLeft: -OVERLAP, borderColor: bc }]}>
          <Text style={[styles.extraText, { fontSize: Math.round(size * 0.34) }]}>+{overflow}</Text>
        </View>
      )}
    </Container>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  ring:      { borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  extra:     { backgroundColor: c.bg3 },
  extraText: { color: c.text, fontWeight: '800' },
});
