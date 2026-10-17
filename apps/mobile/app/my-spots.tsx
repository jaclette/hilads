import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchMySpots } from '@/api/passport';
import { THEME_NAMES } from '@/features/daily/themes';
import type { Spot } from '@/api/spots';

/** My spots (V3-10, from Passport): the spots where I have an approved proof. */
export default function MySpotsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const { account } = useApp();
  const [spots, setSpots] = useState<Spot[] | null>(null);

  useEffect(() => {
    if (!account) { router.replace('/auth-gate?reason=view_profile' as never); return; }
    fetchMySpots().then(setSpots).catch(() => setSpots([]));
  }, [account, router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back', { ns: 'common' })}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('passport.mySpots')}</Text>
      </View>
      {spots === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={spots}
          keyExtractor={s => s.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="location-outline" size={30} color={colors.primaryText} />
              <Text style={styles.emptyText}>{t('passport.noSpots')}</Text>
            </View>
          }
          renderItem={({ item: s }) => (
            <TouchableOpacity style={styles.row} onPress={() => router.push(`/spot/${s.id}` as never)} accessibilityRole="button">
              {s.cover.thumbUrl ? <Image source={{ uri: s.cover.thumbUrl }} style={styles.photo} contentFit="cover" /> : <View style={styles.photo} />}
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[s.city?.name ? localizeCityName(s.city.name) : null, s.themes.map(k => THEME_NAMES[k]).join(', ')].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  nav:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  back:      { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  title:     { flex: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  list:      { padding: Spacing.md, gap: 10, paddingBottom: Spacing.xl },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  photo:     { width: 56, height: 56, borderRadius: 12, backgroundColor: c.primaryTint },
  info:      { flex: 1, gap: 2 },
  name:      { fontSize: 15, fontWeight: '700', color: c.text },
  meta:      { fontSize: FontSizes.xs, color: c.muted },
  empty:     { alignItems: 'center', gap: 10, paddingVertical: Spacing.xl },
  emptyText: { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
});
