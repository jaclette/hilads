import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Image, type ImageContentFit } from 'expo-image';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'react-native-reanimated';
import type { ThemeColors } from '@/constants';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';

/**
 * A Daily photo with its selfie (dual photo, docs/dual-photo-audit.md): the
 * photo fills the frame, the selfie sits in a rounded inset (top-left, ~28 %
 * of the width, 3:4). Tapping the inset swaps them (250 ms, a light haptic),
 * again to swap back; the state is this view's own. Without a selfie: the
 * photo alone, exactly as before.
 *
 * - `inset="small"`: a smaller inset (~24 %), e.g. the mosaic's cards;
 * - `interactive={false}`: the inset is decoration (the card's own tap wins);
 * - `draggable`: the inset can be dragged to another corner (story viewer);
 * - the big layer lets touches through, so a parent's tap zones keep working.
 */

export interface PhotoSource { uri: string; thumb?: string | null }

const SWAP_MS = 250;
const MARGIN = 10;

// The one-time tip "Tap the small photo to swap" on the first dual photo seen:
// one view in the whole app gets it, then never again (AsyncStorage).
const TIP_KEY = 'hilads_dual_swap_tip_v1';
const TIP_MS = 4000;
let tipSeen: Promise<boolean> | null = null;
let tipClaimed = false;
function claimTip(): Promise<boolean> {
  tipSeen ??= AsyncStorage.getItem(TIP_KEY).then(v => v === '1').catch(() => true);
  return tipSeen.then(seen => {
    if (seen || tipClaimed) return false;
    tipClaimed = true;
    AsyncStorage.setItem(TIP_KEY, '1').catch(() => {});
    return true;
  });
}

type Rect = { x: number; y: number; w: number; h: number; r: number };

export function DualPhoto({
  main, selfie, style, contentFit = 'cover', inset = 'normal', interactive = true, draggable = false,
  insetTop = 0, transition = 150, onSwap, onLoadMain, children,
}: {
  main: PhotoSource;
  selfie?: PhotoSource | null;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  inset?: 'normal' | 'small';
  interactive?: boolean;
  draggable?: boolean;
  /** Extra space above the inset (a viewer's top bar). */
  insetTop?: number;
  transition?: number;
  onSwap?: (selfieBig: boolean) => void;
  onLoadMain?: (size: { width: number; height: number }) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation('daily');
  const { colors, theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [corner, setCorner] = useState(0);            // 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
  const [selfieBig, setSelfieBig] = useState(false);
  const [tip, setTip] = useState(false);

  const ratio = inset === 'small' ? 0.24 : 0.28;
  const m = inset === 'small' ? 6 : MARGIN;
  // Measured only for the drag's landing corner and the tip: the layers themselves are laid out
  // with plain styles (full frame / % width + 3:4), never with measured or animated sizes. Animated
  // width/height on Android (old architecture) could leave a freshly mounted layer at 0×0: an empty
  // card, a black viewer with a white dot in the corner.
  const insetRect = useMemo((): Rect => {
    const w = Math.round(size.w * ratio);
    const h = Math.round(w * 4 / 3);
    return { x: corner % 2 === 0 ? m : size.w - w - m, y: corner < 2 ? m + insetTop : size.h - h - m, w, h, r: 0 };
  }, [size, ratio, corner, m, insetTop]);
  const insetPos: ViewStyle = {
    width: `${ratio * 100}%`, aspectRatio: 3 / 4, borderRadius: inset === 'small' ? 8 : 12,
    ...(corner < 2 ? { top: m + insetTop } : { bottom: m }),
    ...(corner % 2 === 0 ? { left: m } : { right: m }),
  };

  // The swap: the new inset pops in. The drag: the inset follows the finger. Both JS-driven (one transform).
  const pop = useRef(new Animated.Value(1)).current;
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  // Back to the photo when the pictures change (a recycled cell, the next story).
  useEffect(() => { setSelfieBig(false); setCorner(0); drag.setValue({ x: 0, y: 0 }); pop.setValue(1); }, [main.uri, selfie?.uri, drag, pop]);

  // The one-time swap tip, on the first interactive dual photo shown.
  useEffect(() => {
    if (!selfie || !interactive) return;
    let live = true;
    let hide: ReturnType<typeof setTimeout> | undefined;
    claimTip().then(mine => {
      if (!live || !mine) return;
      setTip(true);
      hide = setTimeout(() => setTip(false), TIP_MS);
    });
    return () => { live = false; if (hide) clearTimeout(hide); };
  }, [selfie, interactive]);

  const swap = () => {
    if (!selfie) return;
    setTip(false);
    const next = !selfieBig;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelfieBig(next);
    if (!reduced) {
      pop.setValue(0);
      Animated.timing(pop, { toValue: 1, duration: SWAP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }
    onSwap?.(next);
  };
  const swapRef = useRef(swap);
  swapRef.current = swap;

  // Drag (story viewer) and tap on the inset; the corner nearest to where it's let go wins.
  const sizeRef = useRef({ size, insetRect });
  sizeRef.current = { size, insetRect };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => draggable && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => { if (draggable) drag.setValue({ x: g.dx, y: g.dy }); },
    onPanResponderRelease: (_, g) => {
      if (Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6) { drag.setValue({ x: 0, y: 0 }); swapRef.current(); return; }
      if (!draggable) return;
      const { size: s, insetRect: r } = sizeRef.current;
      const cx = r.x + r.w / 2 + g.dx;
      const cy = r.y + r.h / 2 + g.dy;
      const next = (cy > s.h / 2 ? 2 : 0) + (cx > s.w / 2 ? 1 : 0);
      // Land where the finger left it, then glide into the new corner.
      const nx = next % 2 === 0 ? m : s.w - r.w - m;
      const ny = next < 2 ? m + insetTop : s.h - r.h - m;
      drag.setValue({ x: r.x + g.dx - nx, y: r.y + g.dy - ny });
      setCorner(next);
      Animated.timing(drag, { toValue: { x: 0, y: 0 }, duration: reduced ? 0 : 200, useNativeDriver: false }).start();
      Haptics.selectionAsync().catch(() => {});
    },
    onPanResponderTerminate: () => { Animated.timing(drag, { toValue: { x: 0, y: 0 }, duration: 150, useNativeDriver: false }).start(); },
  }), [draggable, drag, m, insetTop, reduced]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  const border = theme === 'dark' ? colors.bg2 : colors.white;
  const ready = !!selfie;

  const layer = (which: 'main' | 'selfie') => {
    const src = which === 'main' ? main : selfie!;
    const isInset = which === 'main' ? selfieBig : !selfieBig;
    const big = !isInset;
    return (
      <Animated.View
        key={which}
        style={[styles.layer, big ? StyleSheet.absoluteFill : [insetPos, styles.insetFrame, { borderColor: border }],
                { zIndex: isInset ? 2 : 1 },
                isInset && { opacity: pop, transform: [{ translateX: drag.x }, { translateY: drag.y },
                                                      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}
        pointerEvents={big || !interactive ? 'none' : 'auto'}
        accessible={isInset && interactive}
        accessibilityRole={isInset && interactive ? 'button' : undefined}
        accessibilityLabel={isInset && interactive ? t('dual.swapA11y') : undefined}
        {...(isInset && interactive ? pan.panHandlers : {})}
      >
        <Image source={{ uri: src.uri }} placeholder={src.thumb ? { uri: src.thumb } : undefined} style={StyleSheet.absoluteFill}
               contentFit={big ? contentFit : 'cover'} transition={transition}
               onLoad={which === 'main' && onLoadMain ? e => onLoadMain({ width: e.source.width, height: e.source.height }) : undefined} />
      </Animated.View>
    );
  };

  return (
    <View style={[styles.frame, style]} onLayout={onLayout} pointerEvents="box-none">
      {!selfie ? (
        <Image source={{ uri: main.uri }} placeholder={main.thumb ? { uri: main.thumb } : undefined} style={StyleSheet.absoluteFill}
               contentFit={contentFit} transition={transition} pointerEvents="none"
               onLoad={onLoadMain ? e => onLoadMain({ width: e.source.width, height: e.source.height }) : undefined} />
      ) : ready ? (
        <>
          {layer('main')}
          {layer('selfie')}
        </>
      ) : null}
      {tip && ready && size.w > 0 && (
        <View pointerEvents="none" style={[styles.tip, { top: insetRect.y + 6, ...(corner % 2 === 0 ? { left: insetRect.x + insetRect.w + 8 } : { right: size.w - insetRect.x + 8 }) }]}>
          <Text style={styles.tipText}>{t('dual.swapHint')}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  frame:      { overflow: 'hidden' },
  layer:      { position: 'absolute', overflow: 'hidden', backgroundColor: c.bg3 },
  tip:        { position: 'absolute', zIndex: 3, maxWidth: 200, backgroundColor: c.photoButton, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  tipText:    { color: c.white, fontSize: 13, fontWeight: '700' },
  insetFrame: { borderWidth: 2, shadowColor: c.photoScrim, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
