import { useEffect, useState } from 'react';
import { Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityName, Photo } from '@/ui';
import { DailyVoteButton } from './DailyVoteButton';
import { LocalPassBadge } from './LocalPassBadge';
import { EarlyBadge } from './EarlyBadge';
import { RankMedal } from './RankMedal';
import { Chip, ModeLabel } from '@/ui';
import { AnswerChip } from '@/features/compare/AnswerChip';
import { captionRepeatsAnswer, answerText } from '@/features/compare/format';
import type { DailyProof } from '@/types';
import { PickBadge } from '@/features/map/PickBadge';

/**
 * One proof in the sheet grid: photo (rank seal if World top 3), author with
 * Local/Traveler, city, caption, vote. `compact` (a country's section, "Same
 * challenge. Different worlds."): no city line (the section has it), small
 * labels on the name's line, "Validated by a local" as a check by the name
 * (a tap explains it), and the answer only when it differs from the
 * section's `mainAnswer`.
 */
export function DailyProofTile({ proof, onPress, compact = false, mainAnswer = null }: {
  proof: DailyProof; onPress: () => void; compact?: boolean; mainAnswer?: string | null;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  if (compact) return <CompactTile proof={proof} onPress={onPress} mainAnswer={mainAnswer} />;
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${name} ${proof.caption ?? ''}`}>
      <Photo thumb={proof.thumbUrl} full={proof.photoUrl} style={styles.photo} contentFit="cover" transition={150} />
      {proof.worldRank !== null && proof.worldRank <= 3 && <RankMedal rank={proof.worldRank} style={styles.medal} />}
      <View style={styles.meta}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {proof.user.localPass && <LocalPassBadge />}
        </View>
        <View style={styles.labels}>
          {proof.suggestion ? <PickBadge />
            : <ModeLabel mode={proof.isLocal ? 'local' : 'traveler'} label={proof.isLocal ? t('local') : t('traveler')} />}
          {proof.isEarly && <EarlyBadge />}
        </View>
        {proof.city && <CityName name={proof.city.name} country={proof.city.country} short style={styles.sub} />}
        {proof.validatedByLocal && <Chip tone="local" icon="checkmark" label={t('validatedByLocal')} style={styles.badge} />}
        {proof.answer && <AnswerChip answer={proof.answer} />}
        {!!proof.caption && <Text style={styles.caption} numberOfLines={2}>{proof.caption}</Text>}
        {/* A Hilads suggestion is never voted on. */}
        {!proof.suggestion && (
          <View style={styles.voteRow}>
            <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} cityId={proof.city?.id ?? null} source="sheet_tile" variant="tile" />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** The compact tile (see DailyProofTile). */
function CompactTile({ proof, onPress, mainAnswer }: { proof: DailyProof; onPress: () => void; mainAnswer: string | null }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 3000);
    return () => clearTimeout(id);
  }, [hint]);
  const name = proof.user.displayName || proof.user.username || '';
  const answer = proof.answer && !proof.backHome ? proof.answer : null;
  // The section's main answer is in its header: a photo repeats it only when it says something else.
  const ownAnswer = !!answer && !(mainAnswer && captionRepeatsAnswer(mainAnswer, answer, i18n.language));
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.85} accessibilityRole="button"
                      accessibilityLabel={[name, answer ? answerText(answer, i18n.language) : null, proof.caption].filter(Boolean).join(', ')}>
      <Photo thumb={proof.thumbUrl} full={proof.photoUrl} style={styles.photo} contentFit="cover" transition={150} />
      {proof.worldRank !== null && proof.worldRank <= 3 && <RankMedal rank={proof.worldRank} style={styles.medal} />}
      <View style={styles.meta}>
        <View style={styles.compactRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {proof.validatedByLocal && (
            <Pressable onPress={() => setHint(h => !h)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('vote.validatedHint')}>
              <Ionicons name="checkmark-circle" size={15} color={colors.localText} />
            </Pressable>
          )}
          {proof.user.localPass && <LocalPassBadge />}
          <ModeLabel small mode={proof.isLocal ? 'local' : 'traveler'} label={proof.isLocal ? t('local') : t('traveler')} />
          {proof.isEarly && <EarlyBadge small />}
        </View>
        {hint && (
          <View style={styles.hint} accessibilityLiveRegion="polite">
            <Text style={styles.hintText}>{t('vote.validatedHint')}</Text>
          </View>
        )}
        {ownAnswer && <AnswerChip answer={answer!} />}
        {!!proof.caption && !captionRepeatsAnswer(proof.caption, answer, i18n.language) && (
          <Text style={styles.caption} numberOfLines={2}>{proof.caption}</Text>
        )}
        <View style={styles.voteRow}>
          <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} cityId={proof.city?.id ?? null} source="countries_tile" variant="tile" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  tile:    { flex: 1, backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, overflow: 'hidden' },
  photo:   { width: '100%', aspectRatio: 1, backgroundColor: c.bg3 },
  meta:    { padding: 10, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:    { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  labels:  { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  sub:     { fontSize: 12, fontWeight: '500', color: c.muted },
  badge:   { alignSelf: 'flex-start' },
  caption: { fontSize: FontSizes.xs, fontWeight: '400', color: c.text, marginTop: 2 },
  medal:   { position: 'absolute', top: 8, left: 8 },
  voteRow: { marginTop: 4 },
  compactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 3 },
  hint:    { padding: 8, borderRadius: 10, backgroundColor: c.text },
  hintText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: c.bg },
});
