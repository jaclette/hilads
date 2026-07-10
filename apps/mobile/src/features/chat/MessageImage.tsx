/**
 * MessageImage - shared photo-bubble body for DMs, city, event, and topic chats.
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

import { useEffect, useState } from 'react';
import {
  View, Image, TouchableOpacity, ActivityIndicator, Text, StyleSheet,
  type ImageStyle, type StyleProp,
} from 'react-native';
import { thumbUrl } from '@/lib/imageThumb';

interface Props {
  uri: string | undefined | null;
  isSending?:     boolean;
  isFailed?:      boolean;
  onPress?:       () => void;
  onLongPress?:   () => void;
  /** Size + corner radii for the Image - caller provides, e.g. DM bubble vs chat image. */
  imageStyle:     StyleProp<ImageStyle>;
  /** Debug tag surfaced in console warnings (e.g. 'dm', 'city'). */
  surface?:       string;
}

// Bounding box for a chat photo. The image is fit to its natural aspect ratio
// inside these bounds so the WHOLE picture shows (no cover-crop / zoom-in),
// while extreme panoramas/strips stay reasonable.
const MAX_W = 280;
const MAX_H = 360;
function fitBox(ratio: number) {
  // ratio = width / height
  let w = MAX_W;
  let h = MAX_W / ratio;
  if (h > MAX_H) { h = MAX_H; w = MAX_H * ratio; }
  return { width: Math.round(w), height: Math.round(h) };
}

export function MessageImage({ uri, isSending, isFailed, onPress, onLongPress, imageStyle, surface = 'msg' }: Props) {
  const [loadFailed, setLoadFailed] = useState(false);
  // Natural aspect ratio (w/h), learned from onLoad. null → fall back to the
  // caller's box until known; 'contain' still shows the full image meanwhile.
  const [ratio, setRatio] = useState<number | null>(null);
  // Display the lightweight thumbnail; the caller's onPress still opens the full
  // image. Fall back to the full URL if the thumb is missing (pre-deterministic
  // uploads), and only then show the unavailable state.
  const [src, setSrc] = useState<string>(() => thumbUrl(uri) ?? uri ?? '');
  useEffect(() => { setSrc(thumbUrl(uri) ?? uri ?? ''); setLoadFailed(false); }, [uri]);

  if (!uri) {
    console.warn(`[${surface}-image] missing uri - image message cannot render`);
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
        source={{ uri: src }}
        // Caller style (corner radii, margins) first; our aspect-fit box overrides
        // the caller's fixed width/height once the natural ratio is known.
        style={[imageStyle, ratio ? fitBox(ratio) : null]}
        // 'contain' guarantees the whole photo is visible even before the box is
        // sized (and if onLoad never reports dimensions) - no cover-crop / zoom-in.
        resizeMode="contain"
        onLoad={(e) => {
          const s = e?.nativeEvent?.source;
          if (s?.width && s?.height) setRatio(s.width / s.height);
        }}
        onError={(e) => {
          const reason = e?.nativeEvent?.error ?? 'unknown';
          // Thumb missing (legacy upload) → retry with the full image once.
          if (src !== uri) { setSrc(uri); return; }
          console.warn(`[${surface}-image] load error - uri=${uri} reason=${reason}`);
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
