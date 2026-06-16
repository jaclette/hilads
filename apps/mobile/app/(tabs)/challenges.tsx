import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { AppHeader } from '@/features/shell/AppHeader';
import { ChallengesList } from '@/features/challenges/ChallengesList';
import { MostLocalCard } from '@/features/challenges/MostLocalCard';
import { ShowcaseHeroCarousel } from '@/features/challenges/ShowcaseHeroCarousel';
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
  const { city, account } = useApp();
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

      {/* (The intro tagline + "How it works" link were folded into the hero
          carousel's trailing "How it works" slide to save vertical space.) */}

      {/* My challenges - prominent entry to the creator/taker list. Members
          only (guests can't be a creator or taker). */}
      {account && (
        <TouchableOpacity
          style={styles.myChallengesCta}
          onPress={() => router.push('/challenge/mine' as never)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('myChallenges.cta')}
        >
          <Text style={styles.myChallengesText}>🏆 {t('myChallenges.cta')}</Text>
          <Ionicons name="chevron-forward" size={18} color="#FF7A3C" />
        </TouchableOpacity>
      )}

      {/* (The standalone "Success challenges" CTA was removed - the hero
          carousel below already has a "See all ›" link to the showcase.) */}

      {/* Most Local + filters scroll with the feed (headerExtra) - only the
          app header + title + intro line above stay sticky. */}
      <ChallengesList
        channelId={city?.channelId ?? null}
        headerExtra={
          <>
            <ShowcaseHeroCarousel onHowItWorks={() => setShowChallengeIntro(true)} />
            <MostLocalCard
              channelId={city?.channelId ?? null}
              onSeeAll={() => router.push('/leaderboard?scope=city' as never)}
            />
          </>
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

  myChallengesCta: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               6,
    marginHorizontal:  Spacing.md,
    marginBottom:      Spacing.md,
    paddingVertical:   12,
    borderRadius:      14,
    backgroundColor:   'rgba(255,122,60,0.12)',
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.5)',
  },
  myChallengesText: { fontSize: FontSizes.md, fontWeight: '800', color: '#FF7A3C', letterSpacing: 0.2 },
});
