import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import type { ParticipantPreview } from '@/types';
import { Colors } from '@/constants';
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

export function AttendeeAvatars({ preview, total, size = DEFAULT_SIZE, borderColor = Colors.bg2, onPress }: Props) {
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
          style={[styles.avatar, dim, { marginLeft: i > 0 ? -OVERLAP : 0, borderColor, backgroundColor: avatarColor(p.id) }]}
        >
          {p.thumbAvatarUrl ? (
            <Image
              source={{ uri: p.thumbAvatarUrl }}
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
        <View style={[styles.avatar, styles.extra, dim, { marginLeft: -OVERLAP, borderColor }]}>
          <Text style={[styles.extraText, { fontSize: Math.round(size * 0.34) }]}>+{overflow}</Text>
        </View>
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  avatar: {
    alignItems:     'center',
    justifyContent: 'center',
    borderWidth:    2,
    overflow:       'hidden',
  },
  letter:    { color: '#fff', fontWeight: '700' },
  extra:     { backgroundColor: 'rgba(255,255,255,0.12)' },
  extraText: { color: Colors.text, fontWeight: '700' },
});
