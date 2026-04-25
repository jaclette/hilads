/**
 * MessageImage — shared photo-bubble body for DMs, city, event, and topic chats.
 *
 * Before this component existed each surface (DmRow, ChatMessage) inlined its
 * own <Image> plus overlays; the DM path silently rendered an empty colored
 * bubble whenever the URL failed to load, hiding real bugs. MessageImage is
 * the single source of truth for:
 *
 *   • empty / missing URI guard (with payload log)
 *   • onError → persistent visible failure state + diagnostic log
 *   • optimistic-send spinner overlay (isSending)
 *   • upload-failed overlay (isFailed)
 *   • press / long-press affordances (preview + action sheet)
 *
 * Callers own the outer container: DM wraps this in a bubble View with its
 * orange/gray tint + tail shape; city chat lets the image itself be the
 * bubble via asymmetric corner radii on `imageStyle`.
 */

import { useState } from 'react';
import {
  View, Image, TouchableOpacity, ActivityIndicator, Text, StyleSheet,
  type ImageStyle, type StyleProp,
} from 'react-native';

interface Props {
  uri: string | undefined | null;
  isSending?:     boolean;
  isFailed?:      boolean;
  onPress?:       () => void;
  onLongPress?:   () => void;
  /** Size + corner radii for the Image — caller provides, e.g. DM bubble vs chat image. */
  imageStyle:     StyleProp<ImageStyle>;
  /** Debug tag surfaced in console warnings (e.g. 'dm', 'city'). */
  surface?:       string;
}

export function MessageImage({ uri, isSending, isFailed, onPress, onLongPress, imageStyle, surface = 'msg' }: Props) {
  const [loadFailed, setLoadFailed] = useState(false);

  if (!uri) {
    console.warn(`[${surface}-image] missing uri — image message cannot render`);
    return null;
  }

  const disabled = isSending || isFailed || loadFailed;
  const showFailed = isFailed || loadFailed;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={!disabled ? onPress : undefined}
      onLongPress={onLongPress}
      delayLongPress={350}
      disabled={disabled && !onLongPress}
    >
      <Image
        source={{ uri }}
        style={imageStyle}
        resizeMode="cover"
        onError={(e) => {
          const reason = e?.nativeEvent?.error ?? 'unknown';
          console.warn(`[${surface}-image] load error — uri=${uri} reason=${reason}`);
          setLoadFailed(true);
        }}
      />
      {isSending && !loadFailed && (
        <View style={styles.overlay}>
          <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
        </View>
      )}
      {showFailed && (
        <View style={styles.overlay}>
          <Text style={styles.failedIcon}>!</Text>
          <Text style={styles.failedLabel}>
            {isFailed ? 'Tap to retry' : 'Image unavailable'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    bottom:          0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             4,
  },
  failedIcon: {
    color:      '#fff',
    fontSize:   22,
    fontWeight: '800',
  },
  failedLabel: {
    color:         'rgba(255,255,255,0.85)',
    fontSize:      11,
    fontWeight:    '600',
    letterSpacing: 0.3,
  },
});
