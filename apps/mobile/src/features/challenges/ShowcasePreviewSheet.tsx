import { thumbUrl } from '@/lib/imageThumb';
import {
  Modal, View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Pressable,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { countryToFlag } from '@/lib/countryFlag';
import { ThumbImage } from '@/components/ThumbImage';
import type { ShowcaseItem } from '@/api/challenges';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

const TYPE_ICON: Record<string, string> = { food: '🍜', place: '📍', culture: '🎭', help: '🤪' };

function PersonRow({ label, name, avatar, country, userId, onAvatar }: {
  label: string;
  name: string | null;
  avatar: string | null;
  country: string | null;
  userId: string | null;
  onAvatar?: (userId: string) => void;
}) {
  const flag = countryToFlag(country);
  const initial = (name ?? '?').charAt(0).toUpperCase();
  const tap = userId && onAvatar ? () => onAvatar(userId) : undefined;
  return (
    <TouchableOpacity style={styles.person} onPress={tap} disabled={!tap} activeOpacity={0.75}>
      {avatar
        ? <Image source={{ uri: thumbUrl(avatar) }} style={styles.personAvatar} />
        : <View style={[styles.personAvatar, styles.personAvatarFallback]}><Text style={styles.personInitial}>{initial}</Text></View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.personLabel}>{label}</Text>
        <Text style={styles.personName} numberOfLines={1}>{name ?? '—'}{flag ? ` ${flag}` : ''}</Text>
      </View>
    </TouchableOpacity>
  );
}

/**
 * Tapping a showcase card opens this preview (NOT the challenge): a bigger
 * photo, who the challenger + taker were, the appreciation note, and a
 * "Try this challenge" CTA that seeds a fresh challenge from the same idea.
 */
export function ShowcasePreviewSheet({ item, onClose, onTry, onAvatar }: {
  item: ShowcaseItem | null;
  onClose: () => void;
  onTry: (item: ShowcaseItem) => void;
  onAvatar?: (userId: string) => void;
}) {
  const { t } = useTranslation('challenge');
  if (!item) return null;

  const intl     = item.mode === 'international';
  const icon     = TYPE_ICON[item.challenge_type] ?? '🔥';
  const fromFlag = countryToFlag(item.country);
  const toFlag   = countryToFlag(item.target_country);
  const hasProof = item.proof_media_url && item.proof_media_type === 'image';
  const cityLabel = intl
    ? [item.city_name, item.target_city_name].filter(Boolean).join(' → ')
    : item.city_name;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {hasProof ? <ThumbImage uri={item.proof_media_url!} style={styles.proof} /> : null}

          <View style={styles.badges}>
            <View style={[styles.modePill, intl ? styles.modeIntl : styles.modeLocal]}>
              <Text style={styles.modeText}>
                {intl ? `${fromFlag || '🌐'} → ${toFlag || '🌍'}` : `${fromFlag || '📍'} ${t('showcase.localTag')}`}
              </Text>
            </View>
            {(item.rating_count ?? 0) > 0 && item.avg_stars != null ? <Text style={styles.stars}>★ {item.avg_stars.toFixed(1)}</Text> : null}
          </View>

          <Text style={styles.title}>{icon} {item.title}</Text>
          {cityLabel ? <Text style={styles.city}>📍 {cityLabel}</Text> : null}

          <View style={styles.people}>
            <PersonRow
              label={t('challengerTag')}
              name={item.creator_display_name}
              avatar={item.creator_thumb_avatar_url}
              country={item.country}
              userId={item.created_by}
              onAvatar={onAvatar}
            />
            {item.acceptor_display_name ? (
              <PersonRow
                label={t('card.takerLabel')}
                name={item.acceptor_display_name}
                avatar={item.acceptor_thumb_avatar_url}
                country={item.acceptor_country}
                userId={item.acceptor_user_id}
                onAvatar={onAvatar}
              />
            ) : null}
          </View>

          {(item.creator_comment || item.acceptor_comment || item.comment) ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteLabel}>{t('showcase.note')}</Text>
              {item.creator_comment ? (
                <View style={styles.noteQuote}>
                  <Text style={styles.noteWho}>{item.creator_display_name ?? t('challengerTag')}</Text>
                  <Text style={styles.noteText}>“{item.creator_comment}”</Text>
                </View>
              ) : null}
              {item.acceptor_comment ? (
                <View style={[styles.noteQuote, item.creator_comment ? styles.noteQuoteDivider : null]}>
                  <Text style={styles.noteWho}>{item.acceptor_display_name ?? t('card.takerLabel')}</Text>
                  <Text style={styles.noteText}>“{item.acceptor_comment}”</Text>
                </View>
              ) : null}
              {!item.creator_comment && !item.acceptor_comment && item.comment ? (
                <Text style={styles.noteText}>“{item.comment}”</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <TouchableOpacity style={styles.tryBtn} onPress={() => onTry(item)} activeOpacity={0.9}>
          <Text style={styles.tryText}>🔥 {t('showcase.tryCta')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '88%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderColor: Colors.border,
    paddingBottom: Spacing.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginTop: 10, marginBottom: 6 },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },

  proof: { width: '100%', height: 220, borderRadius: 14, marginBottom: 14, backgroundColor: '#000' },

  badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  modeIntl: { backgroundColor: 'rgba(96,165,250,0.14)' },
  modeLocal: { backgroundColor: 'rgba(255,255,255,0.06)' },
  modeText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  stars: { fontSize: 14, fontWeight: '800', color: '#FFC93C' },

  title: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, marginBottom: 14, lineHeight: 24 },
  city:  { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.muted, marginTop: -8, marginBottom: 14 },

  people: { gap: 8, marginBottom: 14 },
  person: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  personAvatar: { width: 36, height: 36, borderRadius: 18 },
  personAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  personInitial: { fontSize: 14, fontWeight: '700', color: Colors.text },
  personLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, color: Colors.muted },
  personName: { fontSize: 14, fontWeight: '600', color: Colors.text },

  noteBox: {
    padding: 12, borderRadius: 12, marginBottom: 8,
    backgroundColor: 'rgba(255,201,60,0.07)', borderWidth: 1, borderColor: 'rgba(255,201,60,0.18)',
  },
  noteLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, color: '#FFC93C', marginBottom: 6 },
  noteQuote: { gap: 1 },
  noteQuoteDivider: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  noteWho: { fontSize: 12, fontWeight: '700', color: Colors.text },
  noteText: { fontSize: 14, lineHeight: 20, color: Colors.text, fontStyle: 'italic' },

  tryBtn: {
    marginHorizontal: Spacing.lg, marginTop: Spacing.sm,
    paddingVertical: 15, borderRadius: 14, alignItems: 'center',
    backgroundColor: Colors.accent,
  },
  tryText: { fontSize: FontSizes.md, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
});
