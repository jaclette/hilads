import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, Radius, Gradients, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

/**
 * Shared "lead with action" empty state for a city with ZERO challenges.
 * Single source of truth used by BOTH the home/city-channel screen and the
 * challenge tab - they must stay identical. Leads with the action (be the
 * first local + a gradient-orange launch CTA), never with "no challenges
 * yet". The reward chip surfaces the instant +2 for creating.
 *
 * Reuses the inspiration.* keys (no duplicate strings). {city} interpolates -
 * never hardcode a city name.
 */
export function EmptyCityChallenges({ city, onCreate }: { city: string; onCreate: () => void }) {
  const styles = useThemedStyles(makeStyles);

  const { t } = useTranslation('challenge');
  return (
    <View style={styles.wrap}>
      <Text style={styles.title} numberOfLines={2}>{t('inspiration.firstLocal', { city })}</Text>
      <Text style={styles.sub} numberOfLines={2}>{t('inspiration.firstLocalSub')}</Text>

      <View style={styles.rewardChip}>
        <Text style={styles.rewardText}>{t('inspiration.reward')}</Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onCreate}
        accessibilityRole="button"
        style={styles.ctaWrap}
      >
        <LinearGradient
          colors={Gradients.logo.colors}
          start={Gradients.logo.start}
          end={Gradients.logo.end}
          style={styles.cta}
        >
          <Text style={styles.ctaText}>{t('inspiration.launchFirst')}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    backgroundColor:   c.bg2,
    borderRadius:      Radius.lg,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.35)',
    paddingVertical:   Spacing.lg,
    paddingHorizontal: Spacing.md,
    alignItems:        'center',
    gap:               8,
    shadowColor:   c.accent,
    shadowOpacity: 0.22,
    shadowRadius:  14,
    shadowOffset:  { width: 0, height: 0 },
  },
  title: {
    fontSize:      FontSizes.lg,
    fontWeight:    '800',
    color:         c.text,
    textAlign:     'center',
    letterSpacing: -0.2,
  },
  sub: {
    fontSize:   FontSizes.sm,
    fontWeight: '500',
    color:      c.muted,
    textAlign:  'center',
    lineHeight: 19,
  },
  rewardChip: {
    backgroundColor:   'rgba(255,201,60,0.14)',
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       'rgba(255,201,60,0.35)',
    paddingHorizontal: 10,
    paddingVertical:   3,
    marginTop:         2,
  },
  rewardText: { fontSize: 12, fontWeight: '800', color: '#FFC93C', letterSpacing: 0.2 },

  ctaWrap: { alignSelf: 'stretch', marginTop: 6 },
  cta: {
    paddingVertical: 14,
    borderRadius:    14,
    alignItems:      'center',
    justifyContent:  'center',
  },
  ctaText: { color: '#fff', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
});
