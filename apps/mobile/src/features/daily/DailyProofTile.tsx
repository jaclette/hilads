import { useEffect, useState } from 'react';
import { Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, CityName, DualPhoto, Photo } from '@/ui';
import { selfieOf } from '@/features/daily/selfie';
import { prefetchProof } from '@/lib/prefetch';
import { DailyVoteButton } from './DailyVoteButton';
import { LocalPassBadge } from './LocalPassBadge';
import { EarlyBadge } from './EarlyBadge';
import { RankMedal } from './RankMedal';
import { Chip, ModeLabel } from '@/ui';
import { AnswerChip } from '@/features/compare/AnswerChip';
import { captionRepeatsAnswer, proofTitle, TITLE_FIT } from '@/features/compare/format';
import type { DailyProof } from '@/types';
import { PickBadge } from '@/features/map/PickBadge';

/**
 * One proof in the sheet grid: photo (rank seal if World top 3), author with
 * Local/Traveler, city, caption, vote. `compact` (a city's section, "Same
 * challenge. Different worlds."), laid out like Today's mosaic cards: photo,
 * its own title (answer, else caption) in big type, the caption when it says
 * more, the author row (avatar, handle, a check when validated by a local (a
 * tap explains it), small labels wrapping), then comments and likes at the
 * foot. `top`: the city's most liked photo ("👑 Top photo").
 */
export function DailyProofTile({ proof, onPress, compact = false, top = false }: {
  proof: DailyProof; onPress: () => void; compact?: boolean; top?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  if (compact) return <CompactTile proof={proof} onPress={onPress} top={top} />;
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} onPressIn={() => prefetchProof(proof)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={`${name} ${proof.caption ?? ''}`}>
      {proof.selfieUrl
        ? <DualPhoto main={{ uri: proof.thumbUrl ?? proof.photoUrl, hash: proof.thumbHash }} selfie={selfieOf(proof)} style={styles.photo} inset="small" interactive={false} />
        : <Photo thumb={proof.thumbUrl} full={proof.photoUrl} hash={proof.thumbHash} style={styles.photo} contentFit="cover" transition={150} />}
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
function CompactTile({ proof, onPress, top }: { proof: DailyProof; onPress: () => void; top: boolean }) {
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
  const handle = proof.user.username ? `@${proof.user.username}` : name;
  const answer = proof.answer && !proof.backHome ? proof.answer : null;
  const title = proofTitle(proof, i18n.language);
  // The caption under the title when the title is the answer and the caption says more.
  const caption = answer && proof.caption && !captionRepeatsAnswer(proof.caption, answer, i18n.language) ? proof.caption : null;
  const comments = proof.commentCount ?? 0;
  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} onPressIn={() => prefetchProof(proof)} activeOpacity={0.85} accessibilityRole="button"
                      accessibilityLabel={[top ? t('countries.topPhoto') : null, title, caption, handle].filter(Boolean).join(', ')}>
      <View>
        {proof.selfieUrl
          ? <DualPhoto main={{ uri: proof.thumbUrl ?? proof.photoUrl, hash: proof.thumbHash }} selfie={selfieOf(proof)} style={styles.photo} inset="small" interactive={false} />
          : <Photo thumb={proof.thumbUrl} full={proof.photoUrl} hash={proof.thumbHash} style={styles.photo} contentFit="cover" transition={150} />}
        {proof.worldRank !== null && proof.worldRank <= 3 && <RankMedal rank={proof.worldRank} style={styles.medal} />}
        {top && (
          <View style={styles.top}>
            <Text style={styles.topText} numberOfLines={1}>{`👑 ${t('countries.topPhoto')}`}</Text>
          </View>
        )}
      </View>
      <View style={styles.cbody}>
        {!!title && <Text style={styles.title} {...TITLE_FIT}>{title}</Text>}
        {!!caption && <Text style={styles.caption} numberOfLines={2} ellipsizeMode="tail" textBreakStrategy="simple">{caption}</Text>}
        <View style={styles.compactRow}>
          <Avatar uri={proof.user.photoUrl ?? null} name={name} size={20} />
          <Text style={styles.handle} numberOfLines={1}>{handle}</Text>
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
        {/* Likes and comments at the card's foot: the cards of a row end level. */}
        <View style={styles.cfoot}>
          {comments > 0 && (
            <View style={styles.comments}>
              <Ionicons name="chatbubble-outline" size={14} color={colors.muted} />
              <Text style={styles.commentsText}>{comments}</Text>
            </View>
          )}
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
  compactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 3, marginTop: 2 },
  cbody:   { flex: 1, padding: 10, gap: 4 },
  title:   { fontSize: FontSizes.lg, lineHeight: 22, fontWeight: '800', color: c.text, minHeight: 44 },
  handle:  { flexShrink: 1, fontSize: 13, fontWeight: '700', color: c.text },
  cfoot:   { marginTop: 'auto', paddingTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 },
  comments: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  commentsText: { fontSize: 13, fontWeight: '700', color: c.muted },
  top:     { position: 'absolute', left: 8, bottom: 8, maxWidth: '90%', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: c.photoPill },
  topText: { fontSize: 11, fontWeight: '800', color: c.white },
  hint:    { padding: 8, borderRadius: 10, backgroundColor: c.text },
  hintText: { fontSize: 12, lineHeight: 16, fontWeight: '600', color: c.bg },
});
