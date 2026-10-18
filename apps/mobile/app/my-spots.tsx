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
import { fetchMySpots } from '@/api/passport';
import { themeName } from '@/features/daily/themes';
import type { Spot } from '@/api/spots';
import { Card, CityName, EmptyState, ScreenHeader } from '@/ui';

/** My spots (V3-10, from Passport): the spots where I have an approved proof. */
export default function MySpotsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const { account } = useApp();
  const [spots, setSpots] = useState<Spot[] | null>(null);

  useEffect(() => {
    if (!account) { router.replace('/auth-gate?reason=view_profile&returnTo=%2Fmy-spots' as never); return; }
    fetchMySpots().then(setSpots).catch(() => setSpots([]));
  }, [account, router]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('passport.mySpots')} />
      {spots === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={spots}
          keyExtractor={s => s.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="location-outline" body={t('passport.noSpots')} />}
          renderItem={({ item: s }) => (
            <TouchableOpacity onPress={() => router.push(`/spot/${s.id}` as never)} accessibilityRole="button">
              <Card style={styles.row}>
              {s.cover.thumbUrl ? <Image source={{ uri: s.cover.thumbUrl }} style={styles.photo} contentFit="cover" /> : <View style={styles.photo} />}
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                <View style={styles.metaRow}>
                  {!!s.city?.name && <CityName name={s.city.name} country={s.city.country} short style={styles.meta} />}
                  <Text style={[styles.meta, styles.metaThemes]} numberOfLines={1}>
                    {[s.city?.name ? '·' : null, s.themes.map(k => themeName(k)).join(', ')].filter(Boolean).join(' ')}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Card>
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
  list:      { padding: Spacing.md, gap: 10, paddingBottom: Spacing.xl },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  photo:     { width: 56, height: 56, borderRadius: 12, backgroundColor: c.primaryTint },
  info:      { flex: 1, gap: 2 },
  name:      { fontSize: 15, fontWeight: '700', color: c.text },
  meta:      { fontSize: FontSizes.xs, color: c.muted },
  metaRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 0 },
  metaThemes: { flexShrink: 1 },
});
