import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, Gutter, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Crown, EmptyState, Photo, Screen, ScreenHeader } from '@/ui';
import { themeColor } from '@/ui/joy';
import { themeName } from '@/features/daily/themes';
import { openPhotoFeed } from '@/features/daily/openFeed';
import { fetchUserDuels, type Duel, type Duels } from '@/api/profile';

/** You vs a player (the face-off): every challenge you both played, newest first, the better photo crowned. */
export default function DuelsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('publicProfile');
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<Duels | null>(null);
  const [busy, setBusy] = useState(false);

  const more = useCallback(() => {
    if (!id || busy || (data && data.nextOffset === null)) return;
    setBusy(true);
    fetchUserDuels(id, data?.nextOffset ?? 0)
      .then(d => setData(prev => prev ? { ...d, duels: [...prev.duels, ...d.duels] } : d))
      .catch(() => setData(prev => prev ?? { me: 0, them: 0, total: 0, duels: [], nextOffset: null }))
      .finally(() => setBusy(false));
  }, [id, busy, data]);
  useEffect(() => { more(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const name = data?.duels[0]?.theirs.user.username ? `@${data.duels[0].theirs.user.username}` : '';
  return (
    <Screen edges={['top']}>
      <ScreenHeader title={t('p2.vsTitle', { name })} />
      {data === null ? <ActivityIndicator style={styles.loading} color={colors.primary} /> : (
        <FlatList data={data.duels} keyExtractor={d => d.date} contentContainerStyle={styles.list} onEndReached={more} onEndReachedThreshold={0.5}
                  ListHeaderComponent={data.total > 0 ? (
                    <View style={styles.score} accessible accessibilityLabel={t('p2.scoreA11y', { me: data.me, them: data.them, name })}>
                      <Text style={styles.scoreNum}>{data.me}</Text><Text style={styles.who}>{t('p2.you')}</Text>
                      <Text style={styles.vs}>VS</Text>
                      <Text style={styles.who}>{name}</Text><Text style={styles.scoreNum}>{data.them}</Text>
                    </View>
                  ) : undefined}
                  ListEmptyComponent={<EmptyState icon="earth-outline" body={t('p2.noDuels')} />}
                  renderItem={({ item }) => <Row duel={item} lang={i18n.language} />} />
      )}
    </Screen>
  );
}

function Row({ duel, lang }: { duel: Duel; lang: string }) {
  const styles = useThemedStyles(makeStyles);
  const tc = themeColor(duel.theme);
  const date = new Date(`${duel.date}T12:00:00Z`).toLocaleDateString(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <Pressable style={styles.row} onPress={() => openPhotoFeed([duel.mine, duel.theirs], duel.mine.id, 'duels')} accessibilityRole="button"
               accessibilityLabel={`${themeName(duel.theme)}, ${date}`}>
      <View style={styles.photo}>
        <Photo thumb={duel.mine.thumbUrl} full={duel.mine.photoUrl} hash={duel.mine.thumbHash ?? null} style={styles.img} />
        {duel.winner === 'me' && <View style={styles.crown}><Crown size={22} /></View>}
      </View>
      <View style={styles.mid}>
        <Text style={[styles.theme, { color: tc.textLight }]} numberOfLines={1}>{themeName(duel.theme)}</Text>
        <Text style={styles.meta}>{date}</Text>
        <Text style={styles.meta}>❤️ {duel.mine.voteCount} – {duel.theirs.voteCount}</Text>
      </View>
      <View style={styles.photo}>
        <Photo thumb={duel.theirs.thumbUrl} full={duel.theirs.photoUrl} hash={duel.theirs.thumbHash ?? null} style={styles.img} />
        {duel.winner === 'them' && <View style={styles.crown}><Crown size={22} /></View>}
      </View>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  loading:  { marginTop: Space.xl },
  list:     { paddingHorizontal: Gutter, paddingBottom: Space.xl, gap: Space.md },
  score:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingVertical: Space.md },
  scoreNum: { fontSize: 28, lineHeight: 34, fontWeight: '900', color: c.text },
  who:      { ...Type.caption, color: c.muted },
  vs:       { ...Type.caption, fontWeight: '900', color: c.onGold, backgroundColor: c.gold, borderRadius: 18, overflow: 'hidden', paddingHorizontal: Space.sm, paddingVertical: Space.xxs },
  row:      { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  photo:    { flex: 1, aspectRatio: 4 / 3 },
  img:      { width: '100%', height: '100%', borderRadius: Radius.inner, backgroundColor: c.bg3 },
  crown:    { position: 'absolute', top: -8, right: -4 },
  mid:      { width: 72, alignItems: 'center', gap: Space.xxs },
  theme:    { ...Type.caption, fontWeight: '800' },
  meta:     { ...Type.caption, color: c.muted },
});
