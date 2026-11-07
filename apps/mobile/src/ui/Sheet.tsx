import { createContext, forwardRef, useContext, useEffect, useId, useMemo, useRef, type ReactNode, type Ref } from 'react';
import {
  Animated, FlatList, Modal, Pressable, ScrollView, View, StyleSheet,
  type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import { Gesture, GestureDetector, GestureHandlerRootView, type NativeGesture } from 'react-native-gesture-handler';
import { holdScreen } from '@/lib/celebrationQueue';

// A drag down from this close to the sheet's top (grabber, header) always moves it, even over buttons.
const HEADER_ZONE = 110;
// Past this (or a quick flick), letting go closes the sheet; short of it, the sheet springs back.
const CLOSE_DISTANCE = 100;
const CLOSE_VELOCITY = 1200;   // px/s

type SheetScrollApi = { setAtTop: (atTop: boolean) => void; close: () => void; scroll: NativeGesture | null };
const SheetScroll = createContext<SheetScrollApi | null>(null);

/**
 * Props for a vertical list inside a Sheet (spread them on its FlatList / ScrollView): at
 * the list's top, a drag down on it moves the sheet; scrolled down, the list scrolls back.
 * A list inside a sheet without them would lose that scroll back up to the sheet.
 */
export function useSheetScroll() {
  const api = useContext(SheetScroll);
  return useMemo(() => ({
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => api?.setAtTop(e.nativeEvent.contentOffset.y <= 1),
    onScrollEndDrag: () => {},
    // At its top the list doesn't bounce down: the drag moves the sheet instead (both platforms).
    bounces: false,
    overScrollMode: 'never' as const,
  }), [api]);
}

/** A list inside a Sheet runs with the sheet's drag (the list scrolls; at its top the sheet follows the finger). */
function WithSheetScroll({ children }: { children: React.ReactElement }) {
  const api = useContext(SheetScroll);
  return api?.scroll ? <GestureDetector gesture={api.scroll}>{children}</GestureDetector> : children;
}

type ScrollHandlers = Pick<ScrollViewProps, 'onScroll' | 'onScrollEndDrag'>;
/** The list's own handlers, then the sheet's. */
function useMergedScroll(own: ScrollHandlers) {
  const sheet = useSheetScroll();
  return {
    scrollEventThrottle: sheet.scrollEventThrottle,
    bounces: sheet.bounces,
    overScrollMode: sheet.overScrollMode,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { own.onScroll?.(e); sheet.onScroll(e); },
    onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => { own.onScrollEndDrag?.(e); },
  };
}

/** A vertical ScrollView inside a Sheet (see useSheetScroll). */
export const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(props, ref) {
  return <WithSheetScroll><ScrollView ref={ref} {...props} {...useMergedScroll(props)} /></WithSheetScroll>;
});

/** A FlatList inside a Sheet (see useSheetScroll); `listRef` for its ref. */
export function SheetFlatList<T>({ listRef, ...props }: FlatListProps<T> & { listRef?: Ref<FlatList<T>> }) {
  return <WithSheetScroll><FlatList ref={listRef} {...props} {...useMergedScroll(props)} /></WithSheetScroll>;
}

/**
 * Bottom sheet: slides up over a scrim, with a grabber and the bottom safe area.
 * Every way out runs `onClose`: the scrim, a swipe down, Android back. The sheet
 * follows the finger down from its header (grabber, title) always, and from a list
 * inside it (SheetFlatList / SheetScrollView) once that list is at its top: a
 * gesture-handler pan that runs alongside the list's own scroll, the same on iOS
 * and Android (the old touch responder lost to the list, and on Android a sheet
 * with a list closed from its header only).
 */
export function Sheet({ visible, onClose, closeLabel, style, children }: {
  visible: boolean;
  onClose: () => void;
  closeLabel: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // With the keyboard open, the field sits right on it (the bottom safe area is under the keyboard).
  const keyboardOpen = useKeyboardState(s => s.isVisible);
  const close = useRef(onClose);
  close.current = onClose;

  const drag = useRef(new Animated.Value(0)).current;
  const atTop = useRef(true);
  const sheet = useRef<View>(null);
  const sheetTop = useRef(0);
  // The current drag: started on the header, and the finger's travel when the sheet started following it.
  const fromHeader = useRef(false);
  const base = useRef<number | null>(null);
  useEffect(() => { if (visible) { drag.setValue(0); atTop.current = true; } }, [visible, drag]);
  // An open sheet holds the screen: no celebration pops over it (lib/celebrationQueue).
  const holdId = useId();
  useEffect(() => (visible ? holdScreen(`sheet${holdId}`) : undefined), [visible, holdId]);

  const scroll = useMemo(() => Gesture.Native(), []);
  const api = useMemo<SheetScrollApi>(() => ({
    setAtTop: v => { atTop.current = v; },
    close: () => close.current(),
    scroll,
  }), [scroll]);

  const pan = useMemo(() => {
    const back = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    return Gesture.Pan()
      .runOnJS(true)
      .activeOffsetY(10)
      .failOffsetX([-24, 24])
      .simultaneousWithExternalGesture(scroll)
      .onStart(e => {
        fromHeader.current = e.absoluteY - e.translationY - sheetTop.current < HEADER_ZONE;
        base.current = fromHeader.current || atTop.current ? 0 : null;
      })
      .onUpdate(e => {
        // A list scrolled down: it scrolls back first; once at its top, the sheet follows from there.
        if (base.current === null && atTop.current) base.current = e.translationY;
        if (base.current !== null) drag.setValue(Math.max(0, e.translationY - base.current));
      })
      .onEnd(e => {
        const moved = base.current === null ? 0 : e.translationY - base.current;
        if (base.current !== null && (moved > CLOSE_DISTANCE || (moved > 20 && e.velocityY > CLOSE_VELOCITY))) close.current();
        else back();
        base.current = null;
      })
      .onFinalize(() => { if (base.current !== null) { base.current = null; back(); } });
  }, [drag, scroll]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* A Modal is its own native window: gestures need their root inside it (Android). */}
      <GestureHandlerRootView style={styles.flex}>
        {/* The sheet rises above the keyboard (a search or a note field inside it). */}
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
          <GestureDetector gesture={pan}>
            <Animated.View
              ref={sheet}
              style={[styles.sheet, { paddingBottom: keyboardOpen ? Spacing.sm : insets.bottom + Spacing.md }, style, { transform: [{ translateY: drag }] }]}
              onLayout={() => sheet.current?.measure((_x, _y, _w, _h, _px, py) => { sheetTop.current = py; })}
            >
              <View style={styles.grabber} />
              <SheetScroll.Provider value={api}>{children}</SheetScroll.Provider>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:    { flex: 1 },
  scrim:   { flex: 1, backgroundColor: c.scrim },
  sheet:   { backgroundColor: c.bg2, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingHorizontal: Spacing.md, paddingTop: 8, gap: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: Radius.full, backgroundColor: c.line, marginBottom: 6 },
});
