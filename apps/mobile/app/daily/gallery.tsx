import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Spacing } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, EmptyState, Screen, ScreenHeader } from '@/ui';
import { useApp } from '@/context/AppContext';
import { fetchDailyProofsByIds } from '@/api/daily';
import { DailyProofTile } from '@/features/daily/DailyProofTile';
import { DailyProofViewer } from '@/features/daily/DailyProofViewer';
import type { DailyProof } from '@/types';

/**
 * Gallery of a daily_proof_group card (V2-08): exactly those proofs, with live
 * votes (the shared vote store refreshes the counts of proofs on screen).
 * /daily/gallery?ids=a,b,c&date=YYYY-MM-DD
 */
export default function DailyGalleryScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { ids, date } = useLocalSearchParams<{ ids?: string; date?: string }>();
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const [proofs, setProofs]   = useState<DailyProof[] | null>(null);
  const [failed, setFailed]   = useState(false);
  const [viewing, setViewing] = useState<DailyProof | null>(null);

  useEffect(() => {
    const list = (ids ?? '').split(',').filter(id => /^[a-f0-9]{16}$/.test(id)).slice(0, 50);
    if (list.length === 0) { setFailed(true); return; }
    let alive = true;
    fetchDailyProofsByIds(list, guestId)
      .then(p => { if (alive) setProofs(p); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [ids, guestId]);

  return (
    <Screen>
      <ScreenHeader
        title={t('group.galleryTitle')}
        compact
        right={date ? <Button variant="link" icon="flame-outline" label={t('kicker')} onPress={() => router.push(`/daily/${date}` as never)} /> : undefined}
      />

      {failed ? (
        <View style={styles.center}><EmptyState icon="images-outline" body={t('loadFailed')} /></View>
      ) : !proofs ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={proofs}
          keyExtractor={p => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <DailyProofTile proof={item} onPress={() => setViewing(item)} />}
          ListEmptyComponent={<EmptyState icon="images-outline" body={t('notFound')} />}
        />
      )}
      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </Screen>
  );
}

const makeStyles = () => StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: Spacing.md },
  list:   { padding: Spacing.md, paddingTop: Spacing.sm, gap: 10, paddingBottom: 40 },
  row:    { gap: 10 },
});
