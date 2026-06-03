import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Challenge, ChallengeType, ChallengeAudience } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { AttendeeAvatars } from '@/components/AttendeeAvatars';

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

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={onPress}>
      {/* Top row — type-specific badge (DÉFI BOUFFE / FOOD CHALLENGE / etc.)
          + audience pill + (when validated) badge. Type-specific instead of
          generic so the scanner reads what kind of challenge it is without
          opening the card. */}
      <View style={styles.kindRow}>
        <View style={styles.kindBadge}>
          <Text style={styles.kindBadgeText}>{t(`typeBadge.${challenge.challenge_type}`).toUpperCase()}</Text>
        </View>
        <View style={styles.audiencePill}>
          <Text style={styles.audiencePillText}>{audienceLabel[challenge.audience]}</Text>
        </View>
        {isValidated && (
          <View style={styles.validatedBadge}>
            <Text style={styles.validatedBadgeText}>✓ {t('validatedBadge')}</Text>
          </View>
        )}
      </View>

      {/* Title row — type emoji + title */}
      <View style={styles.titleRow}>
        <Text style={styles.titleEmoji}>{typeIcon}</Text>
        <Text style={styles.title} numberOfLines={2}>{challenge.title}</Text>
      </View>

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

  validatedBadge: {
    backgroundColor:   'rgba(34,197,94,0.10)',
    borderRadius:      Radius.full,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderWidth:       1,
    borderColor:       'rgba(34,197,94,0.20)',
  },
  validatedBadgeText: { fontSize: 10, fontWeight: '700', color: '#4ade80', letterSpacing: 0.3 },

  titleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleEmoji: { fontSize: 22, lineHeight: 24 },
  title:      { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: Colors.text, lineHeight: 20 },
});
