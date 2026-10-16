import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { formatCountdown } from '@/hooks/useDaily';
import { MEDALS } from './DailyProofTile';
import { dailyTrackProps } from './track';
import { useDailyLeaderboard } from './leaderboard';
import { LocalPassBadge } from './LocalPassBadge';
import type { DailyLeaderboardEntry, DailyProof, DailySheet } from '@/types';

interface Props {
  sheet:       DailySheet;
  secondsLeft: number | null;
  source:      string;                       // daily_leaderboard_viewed source
  onOpenProof: (proofId: string) => void;
}

/**
 * The sheet's "Top 10" tab. While the challenge is active: the provisional
 * leaderboard (my rank, World top 10, top 3 of each live city), live. Once
 * closed: the official podium (World top 3, best of each live city).
 */
export function DailyLeaderboardPanel({ sheet, secondsLeft, source, onOpenProof }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const active = !!sheet.challenge?.isActive;
  const lb = useDailyLeaderboard(active, account?.id ?? (guestId ? `g:${guestId}` : null), guestId);
  const board = lb && lb.date === sheet.challenge?.date ? lb : null;

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || (active && !board)) return;
    tracked.current = true;
    track('daily_leaderboard_viewed', {
      source, ...dailyTrackProps(sheet, account?.mode),
      provisional: active, ranked: active ? !!board?.ranked : !!sheet.results, my_rank: board?.me?.rank ?? null,
    });
  }, [active, board, sheet, source, account?.mode]);

  if (!active) {
    const results = sheet.results;
    return (
      <View style={styles.section}>
        <Text style={styles.title}>🏆 {t('leaderboard.official')}</Text>
        {!results || (results.world.length === 0 && results.cities.length === 0) ? (
          <Text style={styles.muted}>{t('results.none')}</Text>
        ) : (
          <>
            {results.world.map((p, i) => (
              <ResultRow key={p.id} proof={p} label={MEDALS[i]} onPress={() => onOpenProof(p.id)} />
            ))}
            {results.cities.length > 0 && <Text style={[styles.title, styles.sub]}>{t('results.bestInCities')}</Text>}
            {results.cities.map(p => (
              <ResultRow key={`c${p.id}`} proof={p} label="📍" city onPress={() => onOpenProof(p.id)} />
            ))}
          </>
        )}
      </View>
    );
  }

  const myProof = sheet.myProof;
  return (
    <View style={styles.section}>
      <Text style={styles.title}>🏆 {t('leaderboard.tab')}</Text>
      <Text style={styles.muted}>
        {t('leaderboard.provisional')}
        {secondsLeft !== null ? ` · ${t('leaderboard.finalIn', { time: formatCountdown(secondsLeft) })}` : ''}
      </Text>

      {board?.me ? (
        <View style={styles.me}>
          <Text style={styles.meText}>{t('leaderboard.me', { rank: board.me.rank, votes: board.me.voteCount })}</Text>
          {board.me.cityRank !== null && myProof?.city && (
            <Text style={styles.meSub}>{t('leaderboard.meCity', { rank: board.me.cityRank, city: localizeCityName(myProof.city.name) })}</Text>
          )}
        </View>
      ) : (
        <Text style={styles.hint}>{myProof?.status === 'pending' ? t('leaderboard.pending') : !myProof ? t('leaderboard.noProof') : ''}</Text>
      )}

      {!board ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : !board.ranked ? (
        <Text style={styles.empty}>🔥 {t('leaderboard.minProofs', { min: board.minProofs, n: board.approvedCount })}</Text>
      ) : board.world.length === 0 ? (
        <Text style={styles.empty}>♥ {t('leaderboard.noVotes')}</Text>
      ) : (
        <>
          {board.world.map(e => (
            <EntryRow key={e.proofId} entry={e} mine={e.proofId === board.me?.proofId} onPress={() => onOpenProof(e.proofId)} />
          ))}
          {board.cities.map(c => (
            <View key={c.city.id} style={styles.city}>
              <Text style={[styles.title, styles.sub]}>📍 {t('leaderboard.cityTop', { city: localizeCityName(c.city.name) })}</Text>
              {c.entries.map(e => (
                <EntryRow key={`${c.city.id}:${e.proofId}`} entry={e} mine={e.proofId === board.me?.proofId} hideCity onPress={() => onOpenProof(e.proofId)} />
              ))}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** One leaderboard line: medal or #rank, photo, name · city, votes. */
function EntryRow({ entry, mine, hideCity = false, onPress }: {
  entry: DailyLeaderboardEntry; mine: boolean; hideCity?: boolean; onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = entry.user.displayName || entry.user.username || '';
  return (
    <TouchableOpacity style={[styles.row, mine && styles.rowMine]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`#${entry.rank} ${name}`}>
      <Text style={styles.rank}>{entry.rank <= 3 ? MEDALS[entry.rank - 1] : `#${entry.rank}`}</Text>
      {entry.thumbUrl
        ? <Image source={{ uri: entry.thumbUrl }} style={styles.thumb} contentFit="cover" />
        : <View style={styles.thumb} />}
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {entry.user.localPass && <LocalPassBadge />}
        </View>
        <Text style={styles.rowSub} numberOfLines={1}>
          {entry.isLocal ? `🌍 ${t('local')}` : `🧭 ${t('traveler')}`}
          {!hideCity && entry.city ? ` · ${localizeCityName(entry.city.name)}` : ''}
        </Text>
      </View>
      <Text style={styles.votes}>♥ {entry.voteCount}</Text>
    </TouchableOpacity>
  );
}

/** One official results line: medal (or pin), photo, author · city (or "Best in <city>"), votes. */
function ResultRow({ proof, label, city = false, onPress }: { proof: DailyProof; label: string; city?: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  const cityName = proof.city ? localizeCityName(proof.city.name) : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${name}`}>
      <Text style={styles.rank}>{label}</Text>
      <Image source={{ uri: proof.thumbUrl ?? proof.photoUrl }} style={styles.thumb} contentFit="cover" />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{city ? t('results.bestIn', { city: cityName }) : name}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {city ? name : cityName}
          {proof.validatedByLocal ? ` · ✓ ${t('validatedByLocal')}` : ''}
        </Text>
      </View>
      <Text style={styles.votes}>♥ {proof.voteCount}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  section: { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 14, gap: 6 },
  title:   { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  sub:     { marginTop: 8 },
  muted:   { fontSize: 12, color: c.muted },
  hint:    { fontSize: 12, color: c.muted },
  me:      { backgroundColor: c.bg3, borderRadius: Radius.md, borderWidth: 1, borderColor: c.accent, paddingVertical: 8, paddingHorizontal: 10, gap: 2, marginVertical: 4 },
  meText:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  meSub:   { fontSize: 12, fontWeight: '600', color: c.accentText },
  loader:  { marginVertical: 20 },
  empty:   { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', paddingVertical: 18 },
  city:    { gap: 6 },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 4, borderRadius: Radius.md, borderWidth: 1, borderColor: 'transparent' },
  rowMine: { borderColor: c.accent, backgroundColor: c.bg3 },
  rank:    { fontSize: FontSizes.md, fontWeight: '800', color: c.text, width: 34, textAlign: 'center' },
  thumb:   { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: c.bg3 },
  body:    { flex: 1, gap: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:    { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  rowSub:  { fontSize: 12, color: c.muted },
  votes:   { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
});
