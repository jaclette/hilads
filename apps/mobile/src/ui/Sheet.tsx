import type { ReactNode } from 'react';
import { Modal, Pressable, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useSwipeDown } from './useSwipeDown';

/**
 * Bottom sheet: slides up over a scrim, with a grabber and the bottom safe area.
 * Every way out runs `onClose`: the scrim, a swipe down, Android back.
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
  const swipe = useSwipeDown(onClose);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }, style]} {...swipe}>
        <View style={styles.grabber} />
        {children}
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scrim:   { flex: 1, backgroundColor: c.scrim },
  sheet:   { backgroundColor: c.bg2, borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingHorizontal: Spacing.md, paddingTop: 8, gap: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: Radius.full, backgroundColor: c.line, marginBottom: 6 },
});
