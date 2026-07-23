import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ChallengesList } from '@/features/challenges/ChallengesList';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * Pushed "/challenge/all?channelId=..." route. Thin wrapper around the shared
 * <ChallengesList /> (same UI as the CHALLENGES tab) with a back header.
 */
export default function AllChallengesScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('challenge');
  const params = useLocalSearchParams<{ channelId?: string }>();
  const channelId = typeof params.channelId === 'string' ? params.channelId : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('allTitle')}</Text>
        </View>
      </View>
      <ChallengesList channelId={channelId} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    minHeight:         56,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: c.overlay,
    borderWidth: 1, borderColor: c.overlayStrong,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  headerCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
});
