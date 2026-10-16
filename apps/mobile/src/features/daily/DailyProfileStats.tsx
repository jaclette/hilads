import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { fetchUserDaily } from '@/api/daily';
import { DailyProofViewer } from './DailyProofViewer';
import { MEDALS } from './DailyProofTile';
import { localizeCityName } from '@/i18n/cityName';
import type { DailyProof, DailyUserStats } from '@/types';

/**
 * Daily Challenge stats on a profile (Challenges tab): current streak, best
 * streak, challenges completed, best proofs, Local Passes earned (and, on
 * mine, my progress toward the next ones). Hidden on someone else's profile
 * until they completed one; on mine it nudges to start.
 */
export function DailyProfileStats({ userId, isMe }: { userId: string; isMe: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const router = useRouter();
  const [stats, setStats] = useState<DailyUserStats | null>(null);
  const [viewing, setViewing] = useState<DailyProof | null>(null);

  useEffect(() => {
    let alive = true;
    fetchUserDaily(userId)
      .then(s => { if (alive) setStats(s); })
      .catch(err => console.warn('[daily] profile stats failed:', String(err)));
    return () => { alive = false; };
  }, [userId]);

  if (!stats || (stats.completed === 0 && !isMe)) return null;
  const inProgress = (stats.localPassProgress ?? []).filter(p => !p.earned).slice(0, 3);

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>🔥 {t('kicker')}</Text>
      {stats.completed === 0 ? (
        <>
          <Text style={styles.empty}>{t('profile.emptyMine')}</Text>
          <TouchableOpacity style={styles.cta} onPress={() => router.push('/daily/today' as never)} accessibilityRole="button">
            <Text style={styles.ctaText}>{t('cta')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.statsRow}>
            <Stat value={stats.currentStreak} label={t('profile.streak', { count: stats.currentStreak })} />
            <Stat value={stats.bestStreak} label={t('profile.bestStreak')} />
            <Stat value={stats.completed} label={t('profile.completed', { count: stats.completed })} />
          </View>
          {((stats.localPasses?.length ?? 0) > 0 || (isMe && inProgress.length > 0)) && (
            <>
              <Text style={styles.subTitle}>🎫 {t('localPass.profileTitle')}</Text>
              <View style={styles.passes}>
                {stats.localPasses?.map(p => (
                  <View key={`p${p.city.id}`} style={[styles.pass, styles.passEarned]}>
                    <Text style={styles.passText}>🎫 {localizeCityName(p.city.name ?? '')} · ✓ {t('localPass.earned')}</Text>
                  </View>
                ))}
                {isMe && inProgress.map(p => (
                  <View key={`g${p.city.id}`} style={styles.pass}>
                    <Text style={styles.passText}>{localizeCityName(p.city.name ?? '')} · {t('localPass.progress', { done: p.done, total: p.total })}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {stats.bestProofs.length > 0 && (
            <>
              <Text style={styles.subTitle}>{t('profile.bestProofs')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
                {stats.bestProofs.map(p => (
                  <TouchableOpacity key={p.id} onPress={() => setViewing(p)} accessibilityRole="button" accessibilityLabel={p.caption ?? t('kicker')}>
                    <Image source={{ uri: p.thumbUrl ?? p.photoUrl }} style={styles.thumb} contentFit="cover" />
                    {p.worldRank !== null && p.worldRank <= 3 && <Text style={styles.medal}>{MEDALS[p.worldRank - 1]}</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
        </>
      )}
      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:      { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,122,60,0.45)', padding: 14, gap: 10, marginBottom: 12 },
  kicker:    { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.accentText },
  empty:     { fontSize: FontSizes.sm, color: c.muted },
  cta:       { alignSelf: 'flex-start', backgroundColor: c.accent, borderRadius: Radius.full, paddingHorizontal: 16, paddingVertical: 10 },
  ctaText:   { color: c.white, fontSize: FontSizes.sm, fontWeight: '800' },
  statsRow:  { flexDirection: 'row', gap: 8 },
  stat:      { flex: 1, backgroundColor: c.bg3, borderRadius: Radius.md, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 2 },
  statValue: { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  statLabel: { fontSize: 11, fontWeight: '600', color: c.muted, textAlign: 'center' },
  subTitle:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
  thumbs:    { gap: 8 },
  thumb:     { width: 72, height: 72, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  medal:     { position: 'absolute', top: 2, left: 4, fontSize: 16 },
  passes:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pass:      { borderRadius: Radius.full, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg3, paddingHorizontal: 10, paddingVertical: 5 },
  passEarned:{ borderColor: c.accent, backgroundColor: c.accentDim },
  passText:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
});
