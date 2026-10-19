import { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { votePick } from '@/api/daily';
import { track } from '@/services/analytics';
import type { DailyPick } from '@/types';

/**
 * The heart on a Hilads pick of today's challenge: one vote per pick, its own
 * count (never a player answer's: no ranking, tour, Index or points). Guests
 * go to the sign-up gate.
 */
export function PickVoteButton({ pick }: { pick: DailyPick }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const [state, setState] = useState({ on: !!pick.myVote, n: pick.voteCount ?? 0 });
  const [busy, setBusy] = useState(false);

  const press = async () => {
    if (!account) { router.push('/auth-gate?reason=daily_vote' as never); return; }
    if (busy) return;
    const on = !state.on;
    setBusy(true);
    setState(s => ({ on, n: Math.max(0, s.n + (on ? 1 : -1)) }));   // instant, then the server's count
    try {
      const r = await votePick(pick.place.id, on);
      setState({ on: r.voted, n: r.voteCount });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      track('pick_vote_cast', { action: on ? 'vote' : 'unvote', city: pick.city?.name ?? null });
    } catch {
      setState(s => ({ on: !on, n: Math.max(0, s.n + (on ? -1 : 1)) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity style={[styles.btn, state.on && styles.btnOn]} onPress={press} hitSlop={8} activeOpacity={0.7}
                      accessibilityRole="button" accessibilityState={{ selected: state.on }}
                      accessibilityLabel={state.on ? t('vote.withdraw') : t('vote.vote')}>
      <Ionicons name={state.on ? 'heart' : 'heart-outline'} size={16} color={state.on ? colors.primaryText : colors.muted} />
      <Text style={styles.count}>{state.n}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  btn:   { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 10, borderRadius: Radius.full,
           borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2, alignSelf: 'flex-start' },
  btnOn: { borderColor: c.primary, backgroundColor: c.primaryTint },
  count: { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
});
