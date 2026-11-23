import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Gutter, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { EmptyState, Photo, Screen, ScreenHeader } from '@/ui';
import { RankMedal } from '@/features/daily/RankMedal';
import { openPhotoFeed } from '@/features/daily/openFeed';
import { fetchUserPhotos, type ProfilePhoto } from '@/api/profile';

/** A player's photos, all of them, best first ("See all" on the profile); a tap opens the photo viewer. */
export default function UserPhotosScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('publicProfile');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<ProfilePhoto[] | null>(null);
  const [next, setNext] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const tile = (width - Gutter * 2 - Space.sm * 2) / 3;

  const more = useCallback(() => {
    if (!id || next === null || busy) return;
    setBusy(true);
    fetchUserPhotos(id, next).then(p => { setItems(prev => [...(prev ?? []), ...p.items]); setNext(p.nextOffset); })
      .catch(() => setItems(prev => prev ?? [])).finally(() => setBusy(false));
  }, [id, next, busy]);
  useEffect(() => { more(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen edges={['top']}>
      <ScreenHeader title={t('p2.photosTitle')} />
      {items === null ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : (
        <FlatList data={items} numColumns={3} keyExtractor={p => p.proof.id} contentContainerStyle={styles.list} columnWrapperStyle={styles.row}
                  onEndReached={more} onEndReachedThreshold={0.5}
                  ListEmptyComponent={<EmptyState icon="images-outline" body={t('p2.noPhotosText')} />}
                  renderItem={({ item }) => (
                    <Pressable style={{ width: tile, height: tile }} accessibilityRole="imagebutton"
                               accessibilityLabel={[item.podium ? t('p2.podiumA11y', { rank: item.podium }) : null, t('a11y.likes', { ns: 'daily', count: item.proof.voteCount })].filter(Boolean).join(', ')}
                               onPress={() => openPhotoFeed(items.map(p => p.proof), item.proof.id, 'profile_all')}>
                      <Photo thumb={item.proof.thumbUrl} full={item.proof.photoUrl} hash={item.proof.thumbHash ?? null} style={styles.tile} />
                      {!!item.podium && item.podium <= 3 && <View style={styles.medal}><RankMedal rank={item.podium} podium size={22} /></View>}
                      <View style={styles.likes}><Text style={styles.likesText}>❤️ {item.proof.voteCount}</Text></View>
                    </Pressable>
                  )} />
      )}
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  loading:   { marginTop: Space.xl },
  list:      { paddingHorizontal: Gutter, paddingBottom: Space.xl, gap: Space.sm },
  row:       { gap: Space.sm },
  tile:      { width: '100%', height: '100%', borderRadius: Radius.inner, backgroundColor: c.bg3 },
  medal:     { position: 'absolute', top: 4, left: 4 },
  likes:     { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 5 },
  likesText: { fontSize: 11, lineHeight: 16, fontWeight: '900', color: '#fff' },
});
