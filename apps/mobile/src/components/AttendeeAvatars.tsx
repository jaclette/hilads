import { thumbUrl } from '@/lib/imageThumb';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import type { ParticipantPreview } from '@/types';
import { type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { avatarColor } from '@/lib/avatarColors';

// Horizontal row of overlapping circular attendee avatars for event cards.
// Cached photo via expo-image when available, else a deterministic initial on a
// warm color. Renders nothing when nobody has joined. Tapping is left to the
// parent card (the row sits inside the card's touchable → opens the detail/list).

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
  const dim      = { width: size, height: size, borderRadius: size / 2 };

  const Container: any = onPress ? TouchableOpacity : View;
  const containerProps = onPress ? { onPress, activeOpacity: 0.7 } : {};

  return (
    <Container style={styles.row} {...containerProps}>
      {shown.map((p, i) => (
        <View
          key={p.id}
          style={[styles.avatar, dim, { marginLeft: i > 0 ? -OVERLAP : 0, borderColor: bc, backgroundColor: avatarColor(p.id) }]}
        >
          {p.thumbAvatarUrl ? (
            <Image
              source={{ uri: thumbUrl(p.thumbAvatarUrl) }}
              style={StyleSheet.absoluteFill}
              cachePolicy="memory-disk"
              contentFit="cover"
              transition={120}
            />
          ) : (
            <Text style={[styles.letter, { fontSize: Math.round(size * 0.42) }]}>
              {(p.displayName[0] ?? '?').toUpperCase()}
            </Text>
          )}
        </View>
      ))}
      {overflow > 0 && (
        <View style={[styles.avatar, styles.extra, dim, { marginLeft: -OVERLAP, borderColor: bc }]}>
          <Text style={[styles.extraText, { fontSize: Math.round(size * 0.34) }]}>+{overflow}</Text>
        </View>
      )}
    </Container>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  avatar: {
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    2,
    overflow:       'hidden',
  },
  letter:    { color: '#fff', fontWeight: '700' },
  extra:     { backgroundColor: c.overlayStrong },
  extraText: { color: c.text, fontWeight: '700' },
});
