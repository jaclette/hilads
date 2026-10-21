import { forwardRef, useEffect, useState, type ReactNode, type RefObject } from 'react';
import { View, StyleSheet, type StyleProp, type TextInput, type TextInputProps, type ViewStyle } from 'react-native';
import { FocusedInputEvents, KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardController, KeyboardStickyView, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The keyboard rule, the same on every screen (Android edge-to-edge and iOS):
// the focused field scrolls into view GAP above the keyboard, the screen's
// main button rides on top of the keyboard, "Next" goes to the next field and
// "Done" (the last one) closes the keyboard, a tap outside a field closes it.

/** Space kept between the focused field and the keyboard (or the button above it). */
const GAP = 24;

/**
 * A form's body: a scroll view that keeps the focused field in sight, and its
 * `footer` (the main button) just above the keyboard. The bottom safe area
 * sits under the footer while the keyboard is closed and is dropped while it
 * is open: `padBottom` when the screen does not pad its bottom (Screen's
 * default edges), else the screen's container already does.
 */
export const KeyboardForm = forwardRef<KeyboardAwareScrollViewRef, {
  children: ReactNode;
  footer?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  footerStyle?: StyleProp<ViewStyle>;
  padBottom?: boolean;
  /** Space kept under the focused field; more than GAP when the main button follows the last field in the form. */
  bottomOffset?: number;
  testID?: string;
}>(function KeyboardForm({ children, footer, contentContainerStyle, footerStyle, padBottom = false, bottomOffset = GAP, testID }, ref) {
  const insets = useSafeAreaInsets();
  const [footerH, setFooterH] = useState(0);
  return (
    <View style={styles.flex}>
      <KeyboardAwareScrollView ref={ref} style={styles.flex} contentContainerStyle={contentContainerStyle}
                               bottomOffset={footerH + bottomOffset} extraKeyboardSpace={footerH}
                               keyboardShouldPersistTaps="handled" testID={testID}>
        {children}
      </KeyboardAwareScrollView>
      {footer != null && (
        <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
          <View style={[footerStyle, padBottom && { paddingBottom: insets.bottom }]} onLayout={e => setFooterH(e.nativeEvent.layout.height)}>{footer}</View>
        </KeyboardStickyView>
      )}
    </View>
  );
});

/**
 * The rest of a screen under a search field or above a chat bar: it ends at the
 * keyboard's top, so a list's last rows and a bottom bar stay reachable.
 */
export function KeyboardArea({ children, style, offset = 0 }: { children: ReactNode; style?: StyleProp<ViewStyle>; offset?: number }) {
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, style]} keyboardVerticalOffset={offset}>
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * "Next" / "Done" for a one-line field: Next moves to the next field on the
 * screen, Done (the last field) closes the keyboard. TextField uses it by
 * default; a raw TextInput spreads it with its ref.
 */
export function useNextField(inputRef: RefObject<TextInput | null>): Pick<TextInputProps, 'returnKeyType' | 'submitBehavior' | 'onSubmitEditing'> {
  const [last, setLast] = useState(false);
  useEffect(() => {
    const sub = FocusedInputEvents.addListener('focusDidSet', e => {
      if (inputRef.current?.isFocused()) setLast(e.current >= e.count - 1);
    });
    return () => sub.remove();
  }, [inputRef]);
  return {
    returnKeyType: last ? 'done' : 'next',
    submitBehavior: last ? 'blurAndSubmit' : 'submit',
    onSubmitEditing: () => {
      if (last) KeyboardController.dismiss();
      else KeyboardController.setFocusTo('next');
    },
  };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
