import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import type { Challenge, ChallengeType, ChallengeAudience } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { countryToFlag } from '@/lib/countryFlag';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';
import { avatarColor } from '@/lib/avatarColors';

// ── Shared challenge (défi) card ──────────────────────────────────────────────
// Used by the NOW feed and the See-all screen so a challenge looks identical
// everywhere. Mirrors TopicCard / EventCard structurally but with orange brand
// accents (challenges are the new primary CTA per spec).
//
// Card surface = bg2 (same as Topic/Event), orange border tint for instant
// recognition. The audience pill (For locals / For explorers) lives next to
// the type badge so the user knows immediately whether the challenge is meant
// for them — the core differentiator of the entity.

const TYPE_ICONS: Record<ChallengeType, string> = {
  food:    '🍜',
  place:   '📍',
  culture: '🎭',
  help:    '🤝',
};

export function ChallengeCard({
  challenge,
  onPress,
  onAvatarsPress,
}: {
  challenge: Challenge;
  onPress: () => void;
  /** Tapping the member row opens the participants modal. */
  onAvatarsPress?: () => void;
}) {
  const { t } = useTranslation('challenge');
  const typeIcon = TYPE_ICONS[challenge.challenge_type] ?? '🔥';
  const isValidated = challenge.status === 'validated';
  const audienceLabel: Record<ChallengeAudience, string> = {
    locals:    t('forLocals'),
    explorers: t('forExplorers'),
  };

  // Status pill (1:1 model):
  //   - Validated → ✓ green badge (existing)
  //   - In progress → ⏳ neutral pill ("someone's on this one")
  //   - Available → 🔓 neutral pill ("free to take on")
  // The validated branch wins if both are true (closed is final).
  const isInProgress = !isValidated && challenge.is_in_progress === true;
  const isInternational = (challenge.mode ?? 'local') === 'international';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={onPress}>
      {/* Top row — type-specific badge (DÉFI BOUFFE / FOOD CHALLENGE / etc.)
          + audience/mode pill + (when validated) badge. International rows
          swap the audience pill for a 🌐 International chip (the audience
          concept doesn't apply — no locals/travelers split). */}
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
        </View>
        {isInternational ? (() => {
          // 🇩🇪 → 🇻🇳 (or "🌍" target for anywhere). Falls back to the
          // legacy "🌐 International" if the origin country is unknown.
          const fromFlag = countryToFlag(challenge.country ?? null);
          const toFlag   = countryToFlag(challenge.target_country ?? null) || '🌍';
          const label    = fromFlag ? `${fromFlag} → ${toFlag}` : `🌐 ${t('mode.international')}`;
          return (
            <View style={styles.intlPill}>
              <Text style={styles.intlPillText}>{label}</Text>
            </View>
          );
        })() : (
          <View style={styles.audiencePill}>
            <Text style={styles.audiencePillText}>{audienceLabel[challenge.audience]}</Text>
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
          // "Available" — green dot + green text to clearly signal "go for it"
          // rather than the older padlock which read as locked/closed at a glance.
          <View style={styles.availablePill}>
            <Text style={styles.availablePillText}>🟢 {t('card.available')}</Text>
          </View>
        )}
      </View>

      {/* Title row — type emoji + title */}
      <View style={styles.titleRow}>
        <Text style={styles.titleEmoji}>{typeIcon}</Text>
        <Text style={styles.title} numberOfLines={2}>{challenge.title}</Text>
      </View>

      {/* Creator — tiny avatar + "by {name}". Mirrors the "Hosted by X" line
          on event cards so the scanner instantly knows who owns this. Hidden
          for pure-guest challenges (no display name on file). */}
      {challenge.creator_display_name ? (
        <View style={styles.creatorRow}>
          {challenge.creator_thumb_avatar_url ? (
            <Image
              source={{ uri: challenge.creator_thumb_avatar_url }}
              style={styles.creatorAvatarImg}
              cachePolicy="memory-disk"
              contentFit="cover"
            />
          ) : (
            <View style={[styles.creatorAvatarFallback, { backgroundColor: avatarColor(challenge.created_by ?? challenge.creator_display_name) }]}>
              <Text style={styles.creatorAvatarFallbackText}>
                {challenge.creator_display_name[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          )}
          <Text style={styles.creatorText} numberOfLines={1}>
            {t('byCreator', { name: challenge.creator_display_name })}
          </Text>
        </View>
      ) : null}

      {/* Participants — same component as Hangouts/Events */}
      <AttendeeAvatars
        preview={challenge.participants_preview ?? []}
        total={challenge.participant_count ?? 0}
        onPress={onAvatarsPress}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     'rgba(255,122,60,0.18)',
    padding:         Spacing.md,
    gap:             8,
  },

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

  // Violet tint so the audience target reads at a glance against the orange
  // (kind/brand) and green (validated) pills it shares the row with.
  audiencePill: {
    backgroundColor:   'rgba(139,92,246,0.12)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(139,92,246,0.32)',
  },
  audiencePillText: { fontSize: 10, fontWeight: '700', color: '#A78BFA', letterSpacing: 0.3 },

  // International badge — cyan tint, distinct from audience violet so Local
  // vs Intl reads at a glance.
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

  // In-progress pill — neutral, same skeleton as the kind/audience pills.
  // Emoji carries the semantic ("⏳").
  statusPill: {
    backgroundColor:   'rgba(255,255,255,0.06)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.12)',
  },
  statusPillText: { fontSize: 10, fontWeight: '700', color: Colors.muted, letterSpacing: 0.3 },

  // Available pill — green tint so it visibly invites action (mirrors the
  // validated badge's green-on-translucent palette but with a different hue
  // so the two states stay distinguishable at a glance).
  availablePill: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(34,197,94,0.25)',
  },
  availablePillText: { fontSize: 10, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleEmoji: { fontSize: 22, lineHeight: 24 },
  title:      { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 20 },

  creatorRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
    marginTop:     2,
  },
  creatorAvatarImg: {
    width:        16,
    height:       16,
    borderRadius: 8,
  },
  creatorAvatarFallback: {
    width:        16,
    height:       16,
    borderRadius: 8,
    alignItems:    'center',
    justifyContent:'center',
  },
  creatorAvatarFallbackText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  creatorText: { fontSize: 11, fontWeight: '600', color: Colors.muted, flexShrink: 1 },
});
