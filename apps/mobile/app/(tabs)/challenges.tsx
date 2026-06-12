import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { AppHeader } from '@/features/shell/AppHeader';
import { ChallengesList } from '@/features/challenges/ChallengesList';
import { localizeCityName } from '@/i18n/cityName';
import { Colors, FontSizes, Spacing } from '@/constants';

/**
 * CHALLENGES bottom tab. Same browser as the pushed /challenge/all route, but
 * the city comes from context (no route param) and it wears the persistent
 * AppHeader + a tab title instead of a back button.
 */
export default function ChallengesTab() {
  const { t } = useTranslation('challenge');
  const { city } = useApp();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appHeaderWrap}>
        <AppHeader />
      </View>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('allTitle')}</Text>
          {city && <Text style={styles.headerSub}>{localizeCityName(city.name)}</Text>}
        </View>
      </View>
      <ChallengesList channelId={city?.channelId ?? null} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.bg },
  appHeaderWrap: { paddingHorizontal: Spacing.md },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle:  { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  headerSub:    { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },
});
