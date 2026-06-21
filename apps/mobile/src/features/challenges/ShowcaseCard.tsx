import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { countryToFlag } from '@/lib/countryFlag';
import { ThumbImage } from '@/components/ThumbImage';
import { avatarColor } from '@/lib/avatarColors';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { ShowcaseItem } from '@/api/challenges';

const TYPE_ICON: Record<string, string> = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' };

/**
 * One card in the public "Success challenges" showcase: title, by-whom +
 * country, local/international, average stars, photo proof (intl) and a
 * preview of the appreciation. Tap the card → the challenge; tap the avatar
 * → the creator's profile.
 */
export function ShowcaseCard({ item, onOpen, onAvatar }: {
  item:      ShowcaseItem;
  onOpen:    () => void;
  onAvatar?: (userId: string) => void;
}) {
  const { t } = useTranslation('challenge');
  const intl        = item.mode === 'international';
  const icon        = TYPE_ICON[item.challenge_type] ?? '🔥';
  const fromFlag    = countryToFlag(item.country);
  const toFlag      = countryToFlag(item.target_country);
  const creatorName = item.creator_display_name ?? '?';
  const hasProof    = !!item.proof_media_url && item.proof_media_type === 'image';
  const tapAvatar   = item.created_by && onAvatar ? () => onAvatar(item.created_by!) : undefined;
  const cityLabel   = intl
    ? [item.city_name, item.target_city_name].filter(Boolean).join(' → ')
    : item.city_name;

  return (
    <TouchableOpacity style={styles.card} onPress={onOpen} activeOpacity={0.85}>
      <View style={styles.badgeRow}>
        {intl ? (
          <View style={[styles.modeBadge, styles.modeBadgeIntl]}>
            <Text style={styles.modeBadgeTextIntl}>{(fromFlag || '🌐')} → {(toFlag || '🌍')}</Text>
          </View>
        ) : (
          <View style={[styles.modeBadge, styles.modeBadgeLocal]}>
            <Text style={styles.modeBadgeTextLocal}>{(fromFlag || '📍')} {t('showcase.localTag', { defaultValue: 'Local' })}</Text>
          </View>
        )}
        {(item.rating_count ?? 0) > 0 && item.avg_stars != null ? (
          <View style={styles.starsBadge}>
            <Ionicons name="star" size={12} color="#FFC93C" />
            <Text style={styles.starsText}>{item.avg_stars.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        {hasProof && (
          <ThumbImage uri={item.proof_media_url!} style={styles.proof} />
        )}
        <View style={styles.bodyText}>
          <Text style={styles.title} numberOfLines={2}>{icon} {item.title}</Text>
          {cityLabel ? <Text style={styles.city} numberOfLines={1}>📍 {cityLabel}</Text> : null}

          <TouchableOpacity
            style={styles.byRow}
            onPress={tapAvatar}
            disabled={!tapAvatar}
            activeOpacity={0.7}
          >
            {item.creator_thumb_avatar_url ? (
              <Image source={{ uri: item.creator_thumb_avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: avatarColor(item.created_by ?? creatorName) }]}>
                <Text style={styles.avatarLetter}>{creatorName[0]?.toUpperCase() ?? '?'}</Text>
              </View>
            )}
            <Text style={styles.byText} numberOfLines={1}>
              {t('showcase.by', { name: creatorName })}{fromFlag ? ` ${fromFlag}` : ''}
            </Text>
          </TouchableOpacity>

          {item.comment ? (
            <Text style={styles.comment} numberOfLines={2}>“{item.comment}”</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md,
    marginBottom:     Spacing.md,
    padding:          14,
    backgroundColor:  Colors.bg2,
    borderWidth:      StyleSheet.hairlineWidth,
    borderColor:      Colors.border,
    borderRadius:     14,
    gap:              10,
  },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, borderWidth: 1 },
  modeBadgeIntl:  { backgroundColor: 'rgba(56,189,248,0.10)', borderColor: 'rgba(56,189,248,0.35)' },
  modeBadgeLocal: { backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)' },
  modeBadgeTextIntl:  { fontSize: 12, fontWeight: '700', color: '#38bdf8' },
  modeBadgeTextLocal: { fontSize: 12, fontWeight: '700', color: Colors.muted },
  starsBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,201,60,0.12)', borderColor: 'rgba(255,201,60,0.4)', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full },
  starsText:  { fontSize: 12, fontWeight: '800', color: '#FFC93C' },

  body:     { flexDirection: 'row', gap: 12 },
  proof:    { width: 72, height: 72, borderRadius: 10, backgroundColor: Colors.bg },
  bodyText: { flex: 1, gap: 6 },
  title:    { fontSize: FontSizes.md, fontWeight: '800', color: Colors.text },
  city:     { fontSize: FontSizes.xs, fontWeight: '600', color: Colors.muted },

  byRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avatar:       { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 11 },
  byText:       { flex: 1, fontSize: FontSizes.sm, color: Colors.muted, fontWeight: '600' },

  comment: { fontSize: FontSizes.sm, color: Colors.muted2, fontStyle: 'italic', lineHeight: FontSizes.sm * 1.35 },
});
