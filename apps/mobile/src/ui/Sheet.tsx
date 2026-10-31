import { createContext, forwardRef, useContext, useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import {
  Animated, FlatList, Modal, PanResponder, Pressable, ScrollView, View, StyleSheet,
  type FlatListProps, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

// A drag down from this close to the sheet's top (grabber, header) always moves it, even over buttons.
const HEADER_ZONE = 110;
// Past this (or a quick flick), letting go closes the sheet; short of it, the sheet springs back.
const CLOSE_DISTANCE = 100;
const CLOSE_VELOCITY = 1.2;
// iOS: a list pulled this far past its top (its bounce) closes the sheet too.
const PULL_CLOSE = 70;

type SheetScrollApi = { setAtTop: (atTop: boolean) => void; close: () => void };
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
    onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (e.nativeEvent.contentOffset.y < -PULL_CLOSE) api?.close();
    },
  }), [api]);
}

type ScrollHandlers = Pick<ScrollViewProps, 'onScroll' | 'onScrollEndDrag'>;
/** The list's own handlers, then the sheet's. */
function useMergedScroll(own: ScrollHandlers) {
  const sheet = useSheetScroll();
  return {
    scrollEventThrottle: sheet.scrollEventThrottle,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { own.onScroll?.(e); sheet.onScroll(e); },
    onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => { own.onScrollEndDrag?.(e); sheet.onScrollEndDrag(e); },
  };
}

/** A vertical ScrollView inside a Sheet (see useSheetScroll). */
export const SheetScrollView = forwardRef<ScrollView, ScrollViewProps>(function SheetScrollView(props, ref) {
  return <ScrollView ref={ref} {...props} {...useMergedScroll(props)} />;
});

/** A FlatList inside a Sheet (see useSheetScroll); `listRef` for its ref. */
export function SheetFlatList<T>({ listRef, ...props }: FlatListProps<T> & { listRef?: Ref<FlatList<T>> }) {
  return <FlatList ref={listRef} {...props} {...useMergedScroll(props)} />;
}

/**
 * Bottom sheet: slides up over a scrim, with a grabber and the bottom safe area.
 * Every way out runs `onClose`: the scrim, a swipe down, Android back. The sheet
 * follows the finger down from anywhere on it (lists at their top, see useSheetScroll)
 * and from its header always.
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
  const close = useRef(onClose);
  close.current = onClose;

  const drag = useRef(new Animated.Value(0)).current;
  const atTop = useRef(true);
  const sheet = useRef<View>(null);
  const sheetTop = useRef(0);
  useEffect(() => { if (visible) { drag.setValue(0); atTop.current = true; } }, [visible, drag]);

  const api = useMemo<SheetScrollApi>(() => ({
    setAtTop: v => { atTop.current = v; },
    close: () => close.current(),
  }), []);

  const pan = useMemo(() => {
    const back = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    const downward = (g: { dy: number; dx: number }) => g.dy > 10 && g.dy > Math.abs(g.dx) * 1.5;
    return PanResponder.create({
      // Capture: the drag wins over the buttons and the list (at its top) it starts on.
      onMoveShouldSetPanResponderCapture: (_, g) => downward(g) && (atTop.current || g.y0 - sheetTop.current < HEADER_ZONE),
      onMoveShouldSetPanResponder: (_, g) => downward(g),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) close.current();
        else back();
      },
      onPanResponderTerminate: back,
    }).panHandlers;
  }, [drag]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* The sheet rises above the keyboard (a search or a note field inside it). */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
        <Animated.View
          ref={sheet}
          style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }, style, { transform: [{ translateY: drag }] }]}
          onLayout={() => sheet.current?.measure((_x, _y, _w, _h, _px, py) => { sheetTop.current = py; })}
          {...pan}
        >
          <View style={styles.grabber} />
          <SheetScroll.Provider value={api}>{children}</SheetScroll.Provider>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:    { flex: 1 },
  scrim:   { flex: 1, backgroundColor: c.scrim },
  sheet:   { backgroundColor: c.bg2, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingHorizontal: Spacing.md, paddingTop: 8, gap: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: Radius.full, backgroundColor: c.line, marginBottom: 6 },
});
