import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, TouchableOpacity, View, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchMyDailyPhotos } from '@/api/daily';
import { EmptyState, DualPhoto, Photo, ScreenHeader } from '@/ui';
import { selfieOf } from '@/features/daily/selfie';
import type { DailyProof } from '@/types';

const COLUMNS = 3;
const GAP = 4;

/** My photos (V3 polish 6, from Passport): every Daily Challenge photo of mine, newest first; a tap opens it. */
export default function MyPhotosScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { account } = useApp();
  const [photos, setPhotos] = useState<DailyProof[] | null>(null);

  useEffect(() => {
    if (!account) { router.replace('/auth-gate?reason=view_profile&returnTo=%2Fmy-photos' as never); return; }
    fetchMyDailyPhotos().then(setPhotos).catch(() => setPhotos([]));
  }, [account, router]);

  const size = (width - Spacing.md * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('passport.myPhotos')} />
      {photos === null ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={p => p.id}
          numColumns={COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="camera-outline" body={t('passport.noPhotos')} />}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => router.push(`/daily/${item.date}?proof=${item.id}` as never)} accessibilityRole="button"
                              accessibilityLabel={[item.city?.name, item.caption].filter(Boolean).join(', ')}>
              {item.selfieUrl
                ? <DualPhoto main={{ uri: item.thumbUrl ?? item.photoUrl }} selfie={selfieOf(item)} style={[styles.photo, { width: size, height: size }]} inset="small" interactive={false} />
                : <Photo thumb={item.thumbUrl} full={item.photoUrl} style={[styles.photo, { width: size, height: size }]} contentFit="cover" />}
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
  list:      { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl, gap: GAP },
  row:       { gap: GAP },
  photo:     { borderRadius: 10, backgroundColor: c.bg3 },
});
