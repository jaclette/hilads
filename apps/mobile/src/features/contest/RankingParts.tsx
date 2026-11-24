import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Space, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Crown } from '@/ui';
import type { ContestRow } from './contest';

/** The Launch Season ranking's parts (the home's preview, the full ranking screen). */

/** The top 3: #2 · #1 · #3 on medal blocks, crown on #1, "You" on mine. */
export function Podium({ rows, meId }: { rows: ContestRow[]; meId: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const medal = [colors.medalGold, colors.medalSilver, colors.medalBronze];
  const heights = [88, 64, 48];
  const order = [rows[1], rows[0], rows[2]];
  return (
    <View style={styles.podium}>
      {order.map((row, i) => {
        if (!row) return <View key={i} style={{ flex: 1 }} />;
        const place = row.rank - 1;
        const name = row.username ? '@' + row.username : row.displayName ?? '';
        const me = row.userId === meId;
        return (
          <Pressable key={row.userId} style={[styles.step, place === 0 && { flex: 1.15 }]} onPress={() => router.push({ pathname: '/user/[id]', params: { id: row.userId } })}
                     accessibilityRole="button" accessibilityLabel={`#${row.rank} ${name}, ${t('contest.pts', { count: row.points })}${me ? `, ${t('contest.youLabel')}` : ''}`}>
            {place === 0 && <View style={styles.crown}><Crown size={24} /></View>}
            <View style={[styles.ring, { borderColor: medal[place] ?? colors.line }]}>
              <Avatar uri={row.photoUrl} name={row.displayName ?? row.username ?? ''} size={place === 0 ? 58 : 48} />
            </View>
            <Text style={styles.stepName} numberOfLines={1}>{name}</Text>
            <Text style={styles.muted} numberOfLines={1}>{t('contest.pts', { count: row.points })}</Text>
            {me && <Text style={styles.you}>{t('contest.youLabel')}</Text>}
            <View style={[styles.block, { height: heights[place] ?? 40, backgroundColor: medal[place] ?? colors.line }]}>
              <Text style={styles.blockText}>{row.rank}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RankRow({ row, me }: { row: ContestRow; me: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('me');
  const router = useRouter();
  const name = row.username ? '@' + row.username : row.displayName ?? '';
  const detail = [row.votes > 0 ? `${t('contest.votes')} ${row.votes}` : null, row.referral > 0 ? `${t('contest.referral')} ${row.referral}` : null,
                  row.headstart > 0 ? `${t('contest.headstart')} ${row.headstart}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable style={[styles.rankRow, me && styles.rankRowMe]} onPress={() => router.push({ pathname: '/user/[id]', params: { id: row.userId } })}
               accessibilityRole="button" accessibilityLabel={`#${row.rank} ${name}, ${t('contest.pts', { count: row.points })}`}>
      <Text style={styles.rankNum}>{row.rank}</Text>
      <Avatar uri={row.photoUrl} name={row.displayName ?? row.username ?? ''} size={38} />
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.text, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{name}</Text>
          {me && <Text style={styles.you}>{t('contest.youLabel')}</Text>}
        </View>
        {!!detail && <Text style={styles.muted} numberOfLines={1}>{detail}</Text>}
      </View>
      <Text style={styles.rankPts}>{row.points}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  muted:      { ...Type.caption, color: c.muted },
  text:       { ...Type.body, color: c.text, flexShrink: 1 },
  podium:     { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, paddingTop: Space.md },
  step:       { flex: 1, alignItems: 'center', gap: 2 },
  crown:      { marginBottom: -2 },
  ring:       { borderWidth: 3, borderRadius: 999, padding: 2 },
  stepName:   { ...Type.caption, fontWeight: '800', color: c.text, maxWidth: '100%' },
  block:      { alignSelf: 'stretch', marginTop: Space.xs, borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
                alignItems: 'center', justifyContent: 'center' },
  blockText:  { ...Type.title, color: c.onMedal },
  you:        { ...Type.caption, fontSize: 11, lineHeight: 15, fontWeight: '800', color: c.onCta, backgroundColor: c.cta, borderRadius: Radius.control,
                paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
  rankRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm, minHeight: 56 },
  rankRowMe:  { backgroundColor: c.primaryTint, borderRadius: Radius.control, marginHorizontal: -Space.sm, paddingHorizontal: Space.sm },
  rankNum:    { ...Type.label, fontWeight: '800', color: c.muted, width: 28, textAlign: 'center' },
  nameRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  rankPts:    { ...Type.label, fontWeight: '800', color: c.text },
});
