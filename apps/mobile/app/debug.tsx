import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DebugPanel } from '@/features/debug/DebugPanel';
import { Colors, FontSizes, Spacing } from '@/constants';

export default function DebugScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Debug</Text>
      </View>
      <DebugPanel />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn:  { padding: 4 },
  backIcon: { fontSize: 22, color: Colors.text },
  title:    { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
});
