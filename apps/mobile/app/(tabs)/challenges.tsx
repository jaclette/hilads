import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { AppHeader } from '@/features/shell/AppHeader';
import { ChallengesList } from '@/features/challenges/ChallengesList';
import { MostLocalCard } from '@/features/challenges/MostLocalCard';
import { ChallengeIntroCarousel } from '@/features/onboarding/ChallengeIntroCarousel';
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
  const router = useRouter();
  const [showChallengeIntro, setShowChallengeIntro] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appHeaderWrap}>
        <AppHeader />
      </View>
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>🔥 {t('noun')}</Text>
          {city && <Text style={styles.headerSub}>{localizeCityName(city.name)}</Text>}
        </View>
      </View>

      {/* Context line + How it works → reuses the challenge-intro carousel. */}
      <View style={styles.intro}>
        <Text style={styles.introText}>{t('tabIntro')}</Text>
        <TouchableOpacity
          onPress={() => setShowChallengeIntro(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.introLink}>{t('howItWorks')} →</Text>
        </TouchableOpacity>
      </View>

      {/* Most Local + filters scroll with the feed (headerExtra) - only the
          app header + title + intro line above stay sticky. */}
      <ChallengesList
        channelId={city?.channelId ?? null}
        headerExtra={
          <MostLocalCard
            channelId={city?.channelId ?? null}
            onSeeAll={() => router.push('/leaderboard?scope=city' as never)}
          />
        }
      />

      <ChallengeIntroCarousel
        visible={showChallengeIntro}
        onClose={() => setShowChallengeIntro(false)}
        onCreateChallenge={() => { setShowChallengeIntro(false); router.push('/challenge/create' as never); }}
      />
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

  intro: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    justifyContent:    'space-between',
    gap:               12,
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.md,
  },
  introText: { flex: 1, fontSize: 13, lineHeight: 18, color: Colors.muted },
  introLink: { fontSize: 13, fontWeight: '600', color: '#60a5fa' },
});
