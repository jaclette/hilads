import { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Space, Radius, Type } from '@/constants';
import { LS } from './HalongArt';
import type { ContestSeason } from './contest';

/**
 * The Launch Season's countdowns: before the start (take-off), then to the final week, then to
 * the end. Targets are the real daily drops from GET /contest (startsAt / finalAt / endsAt).
 */
export type CountdownTarget = { at: number; label: 'cdStarts' | 'cdFinal' | 'cdEnds' };

export function countdownTarget(s: ContestSeason): CountdownTarget | null {
  const at = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
  const pick = s.phase === 'upcoming' ? { at: at(s.startsAt), label: 'cdStarts' as const }
    : s.phase === 'season' ? { at: at(s.finalAt), label: 'cdFinal' as const }
    : s.phase === 'final' ? { at: at(s.endsAt), label: 'cdEnds' as const } : null;
  return pick && Number.isFinite(pick.at) ? pick : null;
}

/** "now", refreshed every `ms` while mounted. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The time left in two units: "2d 14h", "5h 20m", "12m" (localized). */
export function shortLeft(msLeft: number, t: TFunction): string {
  const m = Math.max(0, Math.floor(msLeft / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return t('contest.dur.dh', { d, h });
  if (h > 0) return t('contest.dur.hm', { h, m: mm });
  return t('contest.dur.m', { m: Math.max(1, mm) });
}

/** The departure-board countdown: "Takes off in" then days · hours · min · sec tiles. */
export function CountdownBoard({ target }: { target: CountdownTarget }) {
  const { t } = useTranslation('me');
  const now = useNow(1000);
  const left = Math.max(0, Math.floor((target.at - now) / 1000));
  const parts = [
    [Math.floor(left / 86400), t('contest.cdDays')],
    [Math.floor((left % 86400) / 3600), t('contest.cdHours')],
    [Math.floor((left % 3600) / 60), t('contest.cdMin')],
    [left % 60, t('contest.cdSec')],
  ] as const;
  return (
    <View style={styles.board} accessible accessibilityRole="timer"
          accessibilityLabel={`${t(`contest.${target.label}`)} ${shortLeft(target.at - now, t)}`}>
      <Text style={styles.label}>{t(`contest.${target.label}`)}</Text>
      <View style={styles.tiles}>
        {parts.map(([v, unit], i) => (
          <View key={i} style={styles.tile}>
            <Text style={styles.value}>{String(v).padStart(2, '0')}</Text>
            <Text style={styles.unit} numberOfLines={1}>{unit}</Text>
            <View style={styles.split} />
          </View>
        ))}
      </View>
    </View>
  );
}

// Fixed board colors (like the score board), same in every theme.
const styles = StyleSheet.create({
  board: { backgroundColor: LS.board, borderRadius: Radius.card, padding: Space.sm, gap: Space.xs, marginTop: Space.sm },
  label: { ...Type.caption, fontWeight: '800', color: LS.boardMuted, paddingHorizontal: 4 },
  tiles: { flexDirection: 'row', gap: 6 },
  tile:  { flex: 1, backgroundColor: LS.boardTile, borderRadius: 10, paddingVertical: 6, alignItems: 'center', overflow: 'hidden' },
  value: { fontSize: 26, lineHeight: 30, fontWeight: '800', color: LS.mango, fontVariant: ['tabular-nums'] },
  unit:  { ...Type.caption, fontSize: 11, lineHeight: 14, color: LS.boardMuted },
  split: { position: 'absolute', left: 0, right: 0, top: '45%', height: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
});
