import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { shortCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { themeName } from '@/features/daily/themes';
import { THEME_ICON } from './format';
import type { DailyLocalPassProgress, DailyThemeKey } from '@/types';
import { Button } from '@/ui';

const KEY = (userId: string, cityId: number) => `hilads_stamps_v1_${userId}_${cityId}`;

/**
 * The stamp animation (SPEC 9.7): when a newly approved proof adds a theme
 * stamp to the city's page, a round ink stamp lands on Today. The themes last
 * seen are kept per user and city on the phone; the first time, they are only
 * recorded. The one decorative motion in the app; with Reduce Motion the stamp
 * just appears.
 */
export function StampCelebration({ progress, userId }: { progress: DailyLocalPassProgress | null | undefined; userId: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const reduceMotion = useReducedMotion();
  const [stamp, setStamp] = useState<{ theme: DailyThemeKey; city: string } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  const themes = progress?.themes.join(',') ?? null;
  useEffect(() => {
    if (!progress || !userId) return;
    const key = KEY(userId, progress.city.id);
    let alive = true;
    AsyncStorage.getItem(key).then(prev => {
      if (!alive) return;
      AsyncStorage.setItem(key, JSON.stringify(progress.themes)).catch(() => {});
      if (prev === null) return;   // first look on this phone: record only
      const seen = new Set<string>(JSON.parse(prev) as string[]);
      const fresh = progress.themes.find(th => !seen.has(th));
      if (!fresh) return;
      setStamp({ theme: fresh, city: shortCityName(progress.city.name ?? '') });
      track('stamp_earned', { theme: fresh, city: progress.city.name ?? null, stamps: progress.done });
    }).catch(() => {});
    return () => { alive = false; };
  }, [themes, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!stamp) return;
    anim.setValue(reduceMotion ? 1 : 0);
    if (!reduceMotion) {
      Animated.timing(anim, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
    }
  }, [stamp, reduceMotion, anim]);

  if (!stamp) return null;
  const scale  = anim.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] });
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['-24deg', '-8deg'] });
  const close = () => setStamp(null);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityRole="button" accessibilityLabel={t('stamp.close')}>
        <View style={styles.card} accessibilityRole="alert" accessibilityLabel={t('stamp.title', { theme: themeName(stamp.theme) })}>
          <Animated.View style={[styles.stamp, { opacity: anim, transform: [{ scale }, { rotate }] }]}>
            <View style={styles.inner}>
              <Ionicons name={THEME_ICON[stamp.theme]} size={36} color={colors.primary} />
              <Text style={styles.stampTheme} numberOfLines={1}>{themeName(stamp.theme)}</Text>
              <Text style={styles.stampCity} numberOfLines={1}>{stamp.city}</Text>
            </View>
          </Animated.View>
          <Text style={styles.title}>{t('stamp.title', { theme: themeName(stamp.theme) })}</Text>
          <Text style={styles.body}>{t('stamp.body', { city: stamp.city })}</Text>
          <Button label={t('stamp.ok')} onPress={close} style={styles.cta} />
        </View>
      </Pressable>
    </Modal>
  );
}

const SIZE = 168;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  scrim:      { flex: 1, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card:       { alignSelf: 'stretch', backgroundColor: c.bg2, borderRadius: 24, padding: Spacing.lg, alignItems: 'center', gap: 10 },
  stamp:      { width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 4, borderColor: c.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  inner:      { width: SIZE - 20, height: SIZE - 20, borderRadius: (SIZE - 20) / 2, borderWidth: 1.5, borderColor: c.primary,
                borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 10 },
  stampTheme: { fontSize: FontSizes.sm, fontWeight: '800', color: c.primary, textTransform: 'uppercase', letterSpacing: 1 },
  stampCity:  { fontSize: 12, fontWeight: '600', color: c.primary },
  title:      { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, textAlign: 'center' },
  body:       { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
  cta:        { alignSelf: 'stretch', marginTop: 6 },
});
