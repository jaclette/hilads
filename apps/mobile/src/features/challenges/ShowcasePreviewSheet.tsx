import { thumbUrl } from '@/lib/imageThumb';
import { useEffect, useState } from 'react';
import {
  Modal, View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Pressable,
  type NativeSyntheticEvent, type NativeScrollEvent, type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { countryToFlag } from '@/lib/countryFlag';
import { ThumbImage } from '@/components/ThumbImage';
import { fetchGroupSubmissions, type ShowcaseItem, type GroupSubmission } from '@/api/challenges';
import { ImagePreviewModal } from '@/features/chat/ImagePreviewModal';
import { Border, FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const TYPE_ICON: Record<string, IconName> = { food: 'restaurant-outline', place: 'location-outline', culture: 'color-palette-outline', help: 'hand-left-outline' };

function PersonRow({ label, name, avatar, country, userId, onAvatar }: {
  label: string;
  name: string | null;
  avatar: string | null;
  country: string | null;
  userId: string | null;
  onAvatar?: (userId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
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
 * photo, who the challenger + taker were, and the appreciation note.
 */
export function ShowcasePreviewSheet({ item, onClose, onAvatar }: {
  item: ShowcaseItem | null;
  onClose: () => void;
  onAvatar?: (userId: string) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('challenge');

  // Full-size proof viewer - the photo IS the story, a thumbnail-sized crop
  // isn't enough. Same modal the chat feed opens (zoom + save).
  const [fullUri, setFullUri]   = useState<string | null>(null);
  // Group photo-proof contests have many takers → many photos. Pull them all so
  // we can show a carousel (winner first, with a Winner pill). 1-1 challenges
  // return 0/1 and fall back to the single winning proof below.
  const [subs, setSubs]         = useState<GroupSubmission[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [carouselW, setCarouselW] = useState(0);
  const [page, setPage]         = useState(0);
  const itemId = item?.id ?? null;

  useEffect(() => {
    setSubs([]); setWinnerId(null); setPage(0);
    if (!itemId) return;
    let alive = true;
    fetchGroupSubmissions(itemId)
      .then(r => { if (alive) { setSubs(r.submissions ?? []); setWinnerId(r.winnerUserId ?? null); } })
      .catch(() => { /* not a group contest / no submissions → single-proof fallback */ });
    return () => { alive = false; };
  }, [itemId]);

  if (!item) return null;

  // Winner first, then the rest, so tile 0 is always the crowned photo.
  const ordered: GroupSubmission[] = winnerId
    ? [...subs.filter(s => s.user_id === winnerId), ...subs.filter(s => s.user_id !== winnerId)]
    : subs;
  const isCarousel = ordered.length > 1;
  const onCarouselScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (carouselW > 0) setPage(Math.round(e.nativeEvent.contentOffset.x / carouselW));
  };
  const onCarouselLayout = (e: LayoutChangeEvent) => setCarouselW(e.nativeEvent.layout.width);

  const intl     = item.mode === 'international';
  const icon     = TYPE_ICON[item.challenge_type] ?? 'flame-outline';
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
          {isCarousel ? (
            <View style={styles.carouselWrap} onLayout={onCarouselLayout}>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onCarouselScroll}
              >
                {ordered.map((s, i) => (
                  <View key={s.id} style={{ width: carouselW }}>
                    <Pressable onPress={() => setFullUri(s.media_url)}>
                      <ThumbImage uri={s.media_url} style={styles.carouselImg} />
                    </Pressable>
                    {winnerId && s.user_id === winnerId ? (
                      <View style={styles.winnerPill}>
                        <Ionicons name="trophy-outline" size={12} color={colors.onGold} />
                        <Text style={styles.winnerPillText}>{t('group.winnerTag')}</Text>
                      </View>
                    ) : null}
                    {s.display_name ? (
                      <View style={styles.nameChip}><Text style={styles.nameChipText} numberOfLines={1}>{s.display_name}</Text></View>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
              <View style={styles.counter}><Text style={styles.counterText}>{page + 1}/{ordered.length}</Text></View>
            </View>
          ) : hasProof ? (
            <Pressable onPress={() => setFullUri(item.proof_media_url!)}>
              <ThumbImage uri={item.proof_media_url!} style={styles.proof} />
            </Pressable>
          ) : null}

          <View style={styles.badges}>
            <View style={[styles.modePill, intl ? styles.modeIntl : styles.modeLocal]}>
              {intl ? (
                <>
                  {fromFlag ? <Text style={styles.modeText}>{fromFlag}</Text> : <Ionicons name="globe-outline" size={12} color={colors.travelerText} />}
                  <Text style={styles.modeText}>→</Text>
                  {toFlag ? <Text style={styles.modeText}>{toFlag}</Text> : <Ionicons name="globe-outline" size={12} color={colors.travelerText} />}
                </>
              ) : (
                <>
                  {fromFlag ? <Text style={styles.modeText}>{fromFlag}</Text> : <Ionicons name="location-outline" size={12} color={colors.text} />}
                  <Text style={styles.modeText}>{t('showcase.localTag')}</Text>
                </>
              )}
            </View>
            {(item.rating_count ?? 0) > 0 && item.avg_stars != null ? (
              <View style={styles.starsRow}>
                <Ionicons name="star" size={14} color={colors.gold} />
                <Text style={styles.stars}>{item.avg_stars.toFixed(1)}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.titleRow}>
            <Ionicons name={icon} size={20} color={colors.primaryText} style={styles.titleIcon} />
            <Text style={styles.title}>{item.title}</Text>
          </View>
          {cityLabel ? (
            <View style={styles.cityRow}>
              <Ionicons name="location-outline" size={14} color={colors.muted} />
              <Text style={styles.city}>{cityLabel}</Text>
            </View>
          ) : null}

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
                  <Text style={styles.noteWho}>{item.creator_display_name ?? t('challengerTag')} <Text style={styles.noteRole}>· {t('challengerTag')}</Text></Text>
                  <Text style={styles.noteText}>“{item.creator_comment}”</Text>
                </View>
              ) : null}
              {item.acceptor_comment ? (
                <View style={[styles.noteQuote, item.creator_comment ? styles.noteQuoteDivider : null]}>
                  <Text style={styles.noteWho}>{item.acceptor_display_name ?? t('card.takerLabel')} <Text style={styles.noteRole}>· {t('card.takerLabel')}</Text></Text>
                  <Text style={styles.noteText}>“{item.acceptor_comment}”</Text>
                </View>
              ) : null}
              {/* Legacy single comment: attribute to the challenger (host note). */}
              {!item.creator_comment && !item.acceptor_comment && item.comment ? (
                <View style={styles.noteQuote}>
                  <Text style={styles.noteWho}>{item.creator_display_name ?? t('challengerTag')} <Text style={styles.noteRole}>· {t('challengerTag')}</Text></Text>
                  <Text style={styles.noteText}>“{item.comment}”</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </View>

      {/* Nested inside this Modal so it layers ABOVE the sheet - a sibling
          Modal would fight it for the top of the stack on iOS. */}
      <ImagePreviewModal uri={fullUri} onClose={() => setFullUri(null)} />
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: c.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '88%',
    backgroundColor: c.bg2,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: Border, borderColor: c.line,
    paddingBottom: Spacing.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line, marginTop: 10, marginBottom: 6 },
  scroll: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },

  proof: { width: '100%', height: 220, borderRadius: 14, marginBottom: 14, backgroundColor: c.photoScrim },

  // Multi-taker photo carousel: winner tile first with a gold pill.
  carouselWrap: { position: 'relative', marginBottom: 14 },
  carouselImg:  { width: '100%', height: 220, borderRadius: 14, backgroundColor: c.photoScrim },
  winnerPill: {
    position: 'absolute', top: 10, left: 10,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.gold, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full,
  },
  winnerPillText: { fontSize: 12, fontWeight: '800', color: c.onGold, letterSpacing: 0.2 },
  nameChip: {
    position: 'absolute', bottom: 12, left: 10, maxWidth: '68%',
    backgroundColor: c.scrim, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full,
  },
  nameChipText: { fontSize: 12, fontWeight: '700', color: c.white },
  counter: {
    position: 'absolute', bottom: 12, right: 10,
    backgroundColor: c.scrim, paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.full,
  },
  counterText: { fontSize: 11, fontWeight: '700', color: c.white },

  badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  modeIntl: { backgroundColor: c.travelerBg },
  modeLocal: { backgroundColor: c.bg3 },
  modeText: { fontSize: 12, fontWeight: '700', color: c.text },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stars: { fontSize: 14, fontWeight: '800', color: c.gold },

  titleRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 14 },
  titleIcon: { marginTop: 2 },
  title: { flex: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text, lineHeight: 24 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -8, marginBottom: 14 },
  city:  { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted },

  people: { gap: 8, marginBottom: 14 },
  person: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12,
    backgroundColor: c.bg3, borderWidth: Border, borderColor: c.line,
  },
  personAvatar: { width: 36, height: 36, borderRadius: 18 },
  personAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.line },
  personInitial: { fontSize: 14, fontWeight: '700', color: c.text },
  personLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, color: c.muted },
  personName: { fontSize: 14, fontWeight: '600', color: c.text },

  noteBox: {
    padding: 12, borderRadius: 12, marginBottom: 8,
    backgroundColor: c.goldTint, borderWidth: Border, borderColor: c.gold,
  },
  noteLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, color: c.gold, marginBottom: 6 },
  noteQuote: { gap: 1 },
  noteQuoteDivider: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  noteWho: { fontSize: 12, fontWeight: '700', color: c.text },
  noteRole: { fontSize: 10, fontWeight: '600', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  noteText: { fontSize: 14, lineHeight: 20, color: c.text, fontStyle: 'italic' },
});
