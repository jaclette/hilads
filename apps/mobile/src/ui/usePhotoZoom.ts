import { useCallback, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

/** Up to 4×. */
export const MAX_ZOOM = 4;
const SPRING = { damping: 18, stiffness: 220, mass: 0.6 };

/**
 * Pinch-to-zoom on a full-screen photo, Instagram style: two fingers zoom (up to 4×) around the point between
 * them, moving them pans, and letting go springs back to 1×. All on the UI thread (gesture-handler +
 * Reanimated). `zooming` is true from the pinch's start until the spring back is done: the viewer pauses its
 * story, turns its taps and swipes off and hides its overlays meanwhile, and DualPhoto loads the large size.
 * One-finger taps never start it, so a double tap (a like) and the selfie inset keep working.
 *
 * Put `gesture` on a GestureDetector around the viewer (the photo's frame), `onLayout` on that frame, and
 * `style` on the zoomed image (DualPhoto's zoomStyle).
 */
export function usePhotoZoom(enabled = true) {
  const [zooming, setZooming] = useState(false);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ s: 1, tx: 0, ty: 0, fx: 0, fy: 0 });
  const center = useSharedValue({ x: 0, y: 0 });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    center.value = { x: width / 2, y: height / 2 };
  }, [center]);

  const gesture = useMemo(() => Gesture.Pinch()
    .enabled(enabled)
    .onStart(e => {
      start.value = { s: scale.value, tx: tx.value, ty: ty.value, fx: e.focalX - center.value.x, fy: e.focalY - center.value.y };
      runOnJS(setZooming)(true);
    })
    .onUpdate(e => {
      const st = start.value;
      const s = Math.min(MAX_ZOOM, Math.max(1, st.s * e.scale));
      // The point under the fingers stays under them (their move pans the photo).
      const fx = e.focalX - center.value.x;
      const fy = e.focalY - center.value.y;
      scale.value = s;
      tx.value = fx - (st.fx - st.tx) * (s / st.s);
      ty.value = fy - (st.fy - st.ty) * (s / st.s);
    })
    .onFinalize(() => {
      tx.value = withSpring(0, SPRING);
      ty.value = withSpring(0, SPRING);
      scale.value = withSpring(1, SPRING, done => { if (done) runOnJS(setZooming)(false); });
    }), [enabled, center, scale, start, tx, ty]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return { gesture, style, zooming, onLayout };
}
