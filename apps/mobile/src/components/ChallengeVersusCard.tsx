import { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Easing } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Challenge, ChallengeType, ChallengeAudience } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { countryToFlag } from '@/lib/countryFlag';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { AvatarWithFlag } from '@/components/AvatarWithFlag';
import { OpenChallengeSlot } from '@/components/OpenChallengeSlot';
import { RankBadge } from '@/components/RankBadge';
import { MarqueeText } from '@/components/MarqueeText';

/**
 * Versus-layout challenge card. Replaces the previous flat ChallengeCard
 * across NOW, past archive, and the "all challenges" list. The hero of
 * the card is now the duel - challenger avatar ← arrow → taker avatar
 * (or an open slot inviting the next taker) - with optional country
 * flag overlays on each avatar for international challenges.
 *
 * Four visual states (computed inside, mapped from Challenge):
 *   1. Available           - no taker yet → OpenChallengeSlot with pulse
 *   2. In Progress         - active taker → real avatar (with their
 *                            CURRENT-city flag for international)
 *   3. Pseudo-Available    - participants joined as spectators but no
 *                            active acceptor → visually identical to 1
 *   4. Validated           - challenge completed → both avatars stay
 *                            visible; arrow becomes 🏆 (decorative)
 *
 * The arrow / trophy is decorative - non-tappable. Avatars and the
 * open slot have their own tap handlers; the card itself is also
 * tappable (opens the challenge channel).
 *
 * The right-side avatar fade+scale entry animates a fresh acceptance
 * landing live via WebSocket. The pulse on the open slot pauses when
 * `animated` is false (caller drives this from FlatList viewability so
 * off-screen cards don't redraw).
 */

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤝',
};

const AVATAR_SIZE = 72;

export interface ChallengeVersusCardProps {
  challenge: Challenge;
  /** Card tap - opens the challenge channel. */
  onPress: () => void;
  /** Participant row tap - opens the participants modal. */
  onAvatarsPress?: () => void;
  /** Open-slot tap - shortcut to the accept-challenge flow. When
   *  omitted the slot falls through to the card's onPress (channel). */
  onAcceptPress?: () => void;
  /** Avatar tap - opens that user's profile. Called with the userId of
   *  the tapped party (challenger or taker). When omitted the avatar
   *  is decorative. */
  onAvatarPress?: (userId: string) => void;
  /** Drives the open-slot pulse loop. Set false when the card is off-
   *  screen - the loop stops on the current frame and no redraw runs. */
  animated?: boolean;
}

export function ChallengeVersusCard({
  challenge,
  onPress,
  onAvatarsPress,
  onAcceptPress,
  onAvatarPress,
  animated = true,
}: ChallengeVersusCardProps) {
  const { t } = useTranslation('challenge');
  const typeIcon         = TYPE_ICONS[challenge.challenge_type] ?? '🔥';
  // closed = completed (one-shot) OR manually validated/archived; both show the
  // done badge instead of "available".
  const isValidated      = challenge.status === 'validated' || challenge.closed === true;
  const isInProgress     = !isValidated && challenge.is_in_progress === true;
  const isInternational  = (challenge.mode ?? 'local') === 'international';
  const isGroup          = (challenge.challenge_format ?? 'legacy') === 'group';
  const hasTaker         = !!challenge.acceptor_user_id;
  const showOpenSlot     = !hasTaker; // states 1 + 3
  // Group meet summary for the card (date + place).
  const meetSummary = isGroup && challenge.meet_at
    ? new Date(challenge.meet_at * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  // ── Group card derivations (group rows only; legacy keeps the duel) ─────────
  // Resolution type: MEET (in-person, has a date+place) vs PHOTO-PROOF (a
  // contest; meet_at doubles as the submission deadline). International is
  // inherently photo-proof.
  const isGroupPhoto   = isGroup && ((challenge.validation_method ?? 'meet') === 'photo_proof' || isInternational);
  const participantCount = challenge.participant_count ?? 0;
  const submissionCount  = challenge.submission_count ?? 0;
  const zeroParticipants = participantCount === 0;
  // Photo-proof deadline countdown (whole days left from meet_at). Null when no
  // deadline is set yet - we never fabricate one.
  const deadlineDaysLeft = (isGroupPhoto && challenge.meet_at)
    ? Math.ceil((challenge.meet_at * 1000 - Date.now()) / 86_400_000)
    : null;
  // Subtitle: "by {challenger} · {location} · {date}" (date for meet only).
  const groupLocation = challenge.venue || challenge.target_city_name || null;
  const groupSubtitle = [
    challenge.creator_display_name ? t('byCreator', { name: challenge.creator_display_name }) : null,
    groupLocation,
    !isGroupPhoto && meetSummary ? meetSummary : null,
  ].filter(Boolean).join('  ·  ');

  const audienceLabel: Record<ChallengeAudience, string> = {
    locals:    t('forLocals'),
    explorers: t('forExplorers'),
  };

  // ── GROUP CARD ──────────────────────────────────────────────────────────────
  // One challenger → a group. No "vs" duel. Resolution badge + challenger-alone
  // header + a group bottom row (avatar stack + count, then a join CTA for meet
  // or a deadline countdown for photo-proof). Zero-participant rows accent the
  // border and lead with a "be the first" action instead of an empty stack.
  if (isGroup) {
    return (
      <TouchableOpacity
        style={[styles.card, zeroParticipants && !isValidated && styles.cardAccent]}
        activeOpacity={0.75}
        onPress={onPress}
      >
        {/* Top row - resolution badge, category, then status (pushed right). */}
        <View style={styles.kindRow}>
          <View style={isGroupPhoto ? styles.resPhotoBadge : styles.resMeetBadge}>
            <Text style={isGroupPhoto ? styles.resPhotoBadgeText : styles.resMeetBadgeText}>
              {isGroupPhoto
                ? `📸 ${t('card.photoBadge', { defaultValue: 'Photo proof' })}`
                : `📍 ${t('card.meetBadge', { defaultValue: 'Meet' })}`}
            </Text>
          </View>
          <View style={styles.kindBadge}>
            <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }} />
          {/* Photo-proof deadline lives up here with the status so the bottom
              row can carry the Join CTA. */}
          {!isValidated && isGroupPhoto && deadlineDaysLeft != null ? (
            <View style={styles.deadlinePill}>
              <Text style={styles.deadlinePillText}>
                ⏳ {deadlineDaysLeft >= 2
                  ? t('card.daysLeft', { count: deadlineDaysLeft, defaultValue: '{{count}}d left' })
                  : t('card.lastDay', { defaultValue: 'Expires soon' })}
              </Text>
            </View>
          ) : null}
          {isValidated ? (
            <View style={styles.validatedBadge}>
              <Text style={styles.validatedBadgeText}>✓ {t('validatedBadge')}</Text>
            </View>
          ) : (
            <View style={styles.availablePill}>
              <Text style={styles.availablePillText}>🟢 {t('card.available')}</Text>
            </View>
          )}
        </View>

        {/* Challenger alone + title + subtitle. No facing avatar. */}
        <View style={styles.groupHeader}>
          <ChallengerAvatar
            challenge={challenge}
            isInternational={isInternational}
            onAvatarPress={onAvatarPress}
            size={52}
          />
          <View style={styles.groupHeaderText}>
            <View style={styles.titleRow}>
              <Text style={styles.titleEmoji}>{typeIcon}</Text>
              <MarqueeText
                text={challenge.title}
                textStyle={styles.title}
                style={styles.titleMarquee}
                fadeColor={Colors.bg2}
                active={animated}
              />
            </View>
            {groupSubtitle ? (
              <Text style={styles.groupSubtitle} numberOfLines={1}>{groupSubtitle}</Text>
            ) : null}
          </View>
        </View>

        {/* Bottom = the GROUP dimension. Lead with action; the left side only
            carries a count once there's something real to count - never
            "0 photos" / "no one joined" (those read as dead). */}
        <View style={styles.groupBottomRow}>
          {zeroParticipants ? (
            // Nobody's in yet → just the action, no empty-state text.
            <>
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.beFirstPill} activeOpacity={0.85} onPress={onAcceptPress}>
                <Text style={styles.beFirstPillText}>
                  {t('card.beFirst', { defaultValue: '⚡ Be the first · +2' })}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.groupStackWrap}>
                <AttendeeAvatars
                  preview={(challenge.participants_preview ?? []).slice(0, 4)}
                  total={participantCount}
                  size={34}
                  borderColor={Colors.bg2}
                  onPress={onAvatarsPress}
                />
                {/* Photo: only show the count once ≥1 photo is in (never
                    "0 photos"). Meet: always the joined count. */}
                {(!isGroupPhoto || submissionCount >= 1) ? (
                  <Text style={styles.groupCountText} numberOfLines={1}>
                    {isGroupPhoto
                      ? `📸 ${t('card.photosCount', { count: submissionCount, defaultValue: '{{count}} photos' })}`
                      : t('card.joinedCount', { count: participantCount, defaultValue: '{{count}} joined' })}
                  </Text>
                ) : null}
              </View>
              {/* Join CTA - group challenges stay open, so always invite more
                  people in (meet AND photo). Tapping opens the challenge. */}
              <TouchableOpacity style={styles.joinPill} activeOpacity={0.85} onPress={onAcceptPress}>
                <Text style={styles.joinPillText}>{t('card.joinGroup', { defaultValue: 'Join the challenge' })} ⚡</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  // ── LEGACY CARD (1-to-1 duel) - unchanged; drains as legacy challenges end ──
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={onPress}>
      {/* Top row - kind badge + audience/intl pill + status badge. Unchanged
          from the previous flat card; only the section below the row is new. */}
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
        </View>
        {isInternational ? (() => {
          const fromFlag = countryToFlag(challenge.country ?? null);
          const toFlag   = countryToFlag(challenge.target_country ?? null) || '🌍';
          const cityTail = challenge.target_city_name ? `  ·  ${challenge.target_city_name}` : '';
          const label    = fromFlag
            ? `${fromFlag} → ${toFlag}${cityTail}`
            : `🌐 ${t('mode.international')}${cityTail}`;
          return (
            <View style={styles.intlPill}>
              <Text style={styles.intlPillText} numberOfLines={1}>{label}</Text>
            </View>
          );
        })() : null /* Local = for everyone in the city; no audience pill. */}
        {/* Photo proof on a local challenge - surface a 📸 badge so
            scrollers can spot the lower-friction-but-no-Meet-bonus
            variant at a glance. Meet is the default and stays
            unbadged on purpose (less visual noise). International
            rows are inherently photo-proof and use the flag pill above
            instead, so we skip this badge for them too. */}
        {!isInternational && challenge.validation_method === 'photo_proof' && (
          <View style={styles.photoBadge}>
            <Text style={styles.photoBadgeText}>📸 {t('card.photoBadge', { defaultValue: 'Photo' })}</Text>
          </View>
        )}
        {isValidated ? (
          <View style={styles.validatedBadge}>
            <Text style={styles.validatedBadgeText}>✓ {t('validatedBadge')}</Text>
          </View>
        ) : isInProgress ? (
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>⏳ {t('card.inProgress')}</Text>
          </View>
        ) : (
          <View style={styles.availablePill}>
            <Text style={styles.availablePillText}>🟢 {t('card.available')}</Text>
          </View>
        )}
      </View>

      {/* Versus - the hero of the card. Fixed-height row so the layout
          doesn't jump between states. Center is the directional arrow
          (→) or a trophy (🏆) once the duel is closed - purely decorative,
          not tappable. */}
      <View style={styles.versusRow}>
        <ChallengerAvatar
          challenge={challenge}
          isInternational={isInternational}
          onAvatarPress={onAvatarPress}
        />

        <View style={styles.versusCenter} pointerEvents="none">
          <Text style={styles.versusGlyph}>{isValidated ? '🏆' : '⚡'}</Text>
        </View>

        {showOpenSlot ? (
          <OpenChallengeSlot
            size={AVATAR_SIZE}
            animated={animated}
            onPress={onAcceptPress}
            accessibilityLabel={t('card.takeIt', { defaultValue: 'Take it on' })}
          />
        ) : (
          <TakerAvatar
            challenge={challenge}
            isInternational={isInternational}
            onAvatarPress={onAvatarPress}
          />
        )}
      </View>

      {/* Title row - type emoji + title. Long titles auto-scroll left
          (same MarqueeText primitive the weather pill uses); short
          titles render static. `animated` is the FlatList viewport
          flag - when the card is off-screen the marquee pauses so we
          don't burn CPU on rows the user can't see. */}
      <View style={styles.titleRow}>
        <Text style={styles.titleEmoji}>{typeIcon}</Text>
        <MarqueeText
          text={challenge.title}
          textStyle={styles.title}
          style={styles.titleMarquee}
          fadeColor={Colors.bg2}
          active={animated}
        />
      </View>

      {/* "by {name}" line - null for pure-guest challenges. The avatar tap
          targets are now the big versus avatars above; this row is just
          the textual attribution. */}
      {challenge.creator_display_name ? (
        <Text style={styles.byCreator} numberOfLines={1}>
          {t('byCreator', { name: challenge.creator_display_name })}
        </Text>
      ) : null}

      {/* Participants - unchanged. */}
      <AttendeeAvatars
        preview={challenge.participants_preview ?? []}
        total={challenge.participant_count ?? 0}
        onPress={onAvatarsPress}
      />
    </TouchableOpacity>
  );
}

// ── Avatar sub-renders ──────────────────────────────────────────────────────
// Split so the entry animation on the taker (state 1 → 2 transition via
// WebSocket) can be scoped per-avatar without restating the prop plumbing
// in the main render block.

function ChallengerAvatar({
  challenge, isInternational, onAvatarPress, size = AVATAR_SIZE,
}: {
  challenge:       Challenge;
  isInternational: boolean;
  onAvatarPress?:  (userId: string) => void;
  /** Override the avatar diameter (group cards use a smaller challenger). */
  size?:           number;
}) {
  const country = isInternational ? (challenge.country ?? null) : null;
  const userId  = challenge.created_by ?? null;
  // Badge scope follows the duel: local → city rank, international →
  // world rank. Backend already applies the staleness guard so this
  // value is null whenever the user's score_month_ref has rolled over.
  const rank    = pickRank(challenge, 'creator', isInternational);
  const inner = (
    <AvatarBadgeStack rank={rank}>
      <AvatarWithFlag
        userId={userId}
        displayName={challenge.creator_display_name ?? '?'}
        photoUrl={challenge.creator_thumb_avatar_url ?? null}
        countryCode={country}
        size={size}
      />
    </AvatarBadgeStack>
  );
  if (onAvatarPress && userId) {
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={() => onAvatarPress(userId)}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

function TakerAvatar({
  challenge, isInternational, onAvatarPress,
}: {
  challenge:       Challenge;
  isInternational: boolean;
  onAvatarPress?:  (userId: string) => void;
}) {
  const country = isInternational ? (challenge.acceptor_country ?? null) : null;
  const userId  = challenge.acceptor_user_id ?? null;
  const rank    = pickRank(challenge, 'acceptor', isInternational);

  // Soft fade + scale entry - every time the taker identity changes
  // (null → user via a fresh acceptance landing over WS, or one taker
  // replacing a prior rejected one), the avatar fades in. Keyed on
  // userId so React unmounts + remounts cleanly between identities.
  return (
    <FadeInAvatarSlot key={userId ?? 'taker'}>
      <AvatarBadgeStack rank={rank}>
        {onAvatarPress && userId ? (
          <TouchableOpacity activeOpacity={0.75} onPress={() => onAvatarPress(userId)}>
            <AvatarWithFlag
              userId={userId}
              displayName={challenge.acceptor_display_name ?? '?'}
              photoUrl={challenge.acceptor_thumb_avatar_url ?? null}
              countryCode={country}
              size={AVATAR_SIZE}
            />
          </TouchableOpacity>
        ) : (
          <AvatarWithFlag
            userId={userId}
            displayName={challenge.acceptor_display_name ?? '?'}
            photoUrl={challenge.acceptor_thumb_avatar_url ?? null}
            countryCode={country}
            size={AVATAR_SIZE}
          />
        )}
      </AvatarBadgeStack>
    </FadeInAvatarSlot>
  );
}

/**
 * Select the rank to render based on challenge mode + which party.
 * Local challenges → in_city; international → worldwide. Returns null
 * for the "no badge" path so the caller doesn't have to branch.
 */
function pickRank(
  challenge: Challenge,
  party: 'creator' | 'acceptor',
  isInternational: boolean,
): number | null {
  if (party === 'creator') {
    return (isInternational
      ? challenge.creator_monthly_rank_worldwide
      : challenge.creator_monthly_rank_in_city) ?? null;
  }
  return (isInternational
    ? challenge.acceptor_monthly_rank_worldwide
    : challenge.acceptor_monthly_rank_in_city) ?? null;
}

/**
 * Wraps an avatar with the rank badge floating astride the top edge.
 * Badge tilts -10° (per spec) for a pinned-medal effect; the flag
 * lives at bottom-right of the avatar so the two overlays never
 * overlap. Rank null = the wrapper is a transparent passthrough so
 * we don't pay layout cost for non-ranked users.
 */
function AvatarBadgeStack({
  rank, children,
}: { rank: number | null; children: React.ReactNode }) {
  if (rank == null) return <>{children}</>;
  return (
    <View style={styles.badgeStack}>
      {children}
      <View style={styles.badgeAnchor} pointerEvents="none">
        <RankBadge rank={rank} />
      </View>
    </View>
  );
}

// One-shot entry animation: opacity 0 → 1, scale 0.85 → 1, ~300ms. Used
// only on the taker side because the challenger has been there since
// the card was created (no transition to celebrate).
function FadeInAvatarSlot({ children }: { children: React.ReactNode }) {
  const drive = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(drive, {
      toValue:  1,
      duration: 300,
      easing:   Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [drive]);
  const opacity = drive;
  const scale   = drive.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
// Same warm orange tint as the previous flat card - keeps the brand
// continuity. New section: the fixed-height versus row.

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(255,122,60,0.18)',
    padding:         Spacing.md,
    gap:             10,
  },
  // Zero-participant group card - accent the border to lead with action
  // (mirrors the dead-city empty-state philosophy: a cold card invites, it
  // doesn't sit empty).
  cardAccent: {
    borderColor:     'rgba(255,170,60,0.55)',
    backgroundColor: 'rgba(255,150,40,0.05)',
  },

  // ── Group card ──
  // Resolution badges (top row). Meet = warm pin; Photo proof = cool camera.
  resMeetBadge: {
    backgroundColor:   'rgba(255,122,60,0.14)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.32)',
  },
  resMeetBadgeText:  { fontSize: 10, fontWeight: '800', color: '#FF7A3C', letterSpacing: 0.3 },
  resPhotoBadge: {
    backgroundColor:   'rgba(96,165,250,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.32)',
  },
  resPhotoBadgeText: { fontSize: 10, fontWeight: '800', color: '#60a5fa', letterSpacing: 0.3 },

  // Challenger-alone header (avatar + title + subtitle).
  // minWidth:0 lets the text column shrink below its content so the title's
  // MarqueeText measures the BOUNDED width and scrolls (without it the flex
  // child expands to the title's natural width → marquee thinks it fits →
  // static ellipsis "..." that never reveals the end).
  groupHeader:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  groupHeaderText: { flex: 1, minWidth: 0, gap: 3, justifyContent: 'center' },
  groupSubtitle:   { fontSize: 12, fontWeight: '600', color: Colors.muted },

  // Bottom group row: stack + count on the left, CTA / countdown on the right.
  groupBottomRow: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    gap:              Spacing.sm,
    marginTop:        2,
  },
  groupStackWrap:  { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  groupCountText:  { fontSize: 13, fontWeight: '700', color: Colors.text },
  groupEmptyText:  { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.muted },

  // Join CTA (meet, or photo with no deadline) - filled orange.
  joinPill: {
    backgroundColor:   '#FF7A3C',
    borderRadius:      Radius.full,
    paddingHorizontal: 16,
    paddingVertical:   8,
  },
  joinPillText:    { fontSize: 13, fontWeight: '800', color: Colors.white },

  // "Be the first · +2" - amber-filled, the cold-start hook.
  beFirstPill: {
    backgroundColor:   '#FFAA3C',
    borderRadius:      Radius.full,
    paddingHorizontal: 14,
    paddingVertical:   8,
  },
  beFirstPillText: { fontSize: 13, fontWeight: '800', color: '#1a1206' },

  // Photo-proof deadline countdown - amber outline (reads as time, not action).
  deadlinePill: {
    backgroundColor:   'rgba(251,191,36,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 12,
    paddingVertical:   7,
    borderWidth:       1,
    borderColor:       'rgba(251,191,36,0.45)',
  },
  deadlinePillText: { fontSize: 12, fontWeight: '800', color: '#fbbf24', letterSpacing: 0.2 },

  kindRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },

  kindBadge: {
    backgroundColor:   'rgba(255,122,60,0.14)',
    borderRadius:      Radius.full,
    paddingHorizontal: 7,
    paddingVertical:   1,
    borderWidth:       1,
    borderColor:       'rgba(255,122,60,0.30)',
  },
  kindBadgeText: { fontSize: 9, fontWeight: '800', color: '#FF7A3C', letterSpacing: 0.5 },

  audiencePill: {
    backgroundColor:   'rgba(139,92,246,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.32)',
  },
  audiencePillText: { fontSize: 10, fontWeight: '700', color: '#A78BFA', letterSpacing: 0.3 },

  intlPill: {
    backgroundColor:   'rgba(56,189,248,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(56,189,248,0.36)',
  },
  intlPillText: { fontSize: 10, fontWeight: '700', color: '#38bdf8', letterSpacing: 0.3 },

  validatedBadge: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(34,197,94,0.20)',
  },
  validatedBadgeText: { fontSize: 10, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  // "⏳ In progress" - amber so it reads as "actively in motion"
  // without competing with the validated-green or available-green
  // pills. Grey was indistinguishable from a disabled state and
  // washed out next to the ⏳ emoji.
  statusPill: {
    backgroundColor:   'rgba(251,191,36,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(251,191,36,0.30)',
  },
  statusPillText: { fontSize: 10, fontWeight: '700', color: '#fbbf24', letterSpacing: 0.3 },

  // "📸 Photo" badge - local + photo_proof variant. Cool blue tint so
  // it reads as the calm/alternative path (warm orange + amber + green
  // are already in use for the type/status badges). Meet stays
  // unbadged on purpose since it's the default.
  photoBadge: {
    backgroundColor:   'rgba(96,165,250,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(96,165,250,0.30)',
  },
  photoBadgeText: { fontSize: 10, fontWeight: '700', color: '#60a5fa', letterSpacing: 0.3 },

  availablePill: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(34,197,94,0.25)',
  },
  availablePillText: { fontSize: 10, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  // Versus row - fixed height = avatar diameter + ~10px breathing room so
  // the card height doesn't jump when the right side flips between the
  // open slot and a real avatar.
  versusRow: {
    flexDirection:    'row',
    alignItems:       'center',
    justifyContent:   'space-between',
    height:           AVATAR_SIZE + 12,
    paddingHorizontal: 4,
    marginVertical:    2,
  },
  versusCenter: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
  },
  versusGlyph: {
    fontSize:   28,
    lineHeight: 32,
    color:      Colors.muted,
  },

  titleRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleEmoji:   { fontSize: 22, lineHeight: 24 },
  // MarqueeText clip window - takes the remaining row width and clips
  // overflow so the scroll happens inside this box, not over the type
  // emoji or the card padding.
  titleMarquee: { flex: 1, height: 22 },
  title:        { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 22 },


  byCreator: {
    fontSize:   12,
    fontWeight: '600',
    color:      Colors.muted,
  },

  // Badge anchor sits relative to the avatar so the medal/pill floats
  // astride its top edge. Slightly inset from the absolute corner so
  // it reads as "pinned" rather than "stuck in the corner".
  badgeStack: {
    position: 'relative',
  },
  badgeAnchor: {
    position: 'absolute',
    top:    -8,
    left:   -6,
  },
});
