import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DebugPanel } from '@/features/debug/DebugPanel';
import { Space, FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { goBack } from '@/lib/nav';

export default function DebugScreen() {
  const styles = useThemedStyles(makeStyles);


  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Debug</Text>
      </View>
      <DebugPanel />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Space.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: c.line,
  },
  backBtn:  { padding: Space.xs },
  backIcon: { fontSize: 22, color: c.text },
  title:    { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
});
