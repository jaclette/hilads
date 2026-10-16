import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
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
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>📸 {t('group.galleryTitle')}</Text>
        {!!date && (
          <TouchableOpacity onPress={() => router.push(`/daily/${date}` as never)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>🔥 {t('kicker')} ›</Text>
          </TouchableOpacity>
        )}
      </View>

      {failed ? (
        <View style={styles.center}><Text style={styles.muted}>{t('loadFailed')}</Text></View>
      ) : !proofs ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          data={proofs}
          keyExtractor={p => p.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <DailyProofTile proof={item} onPress={() => setViewing(item)} />}
          ListEmptyComponent={<Text style={styles.muted}>{t('notFound')}</Text>}
        />
      )}
      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
  nav:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:      { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:  { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  link:      { fontSize: FontSizes.xs, fontWeight: '800', color: c.accentText },
  muted:     { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
  list:      { padding: Spacing.md, gap: 10, paddingBottom: 40 },
  row:       { gap: 10 },
});
