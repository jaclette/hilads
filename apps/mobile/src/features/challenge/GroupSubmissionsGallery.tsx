/**
 * GroupSubmissionsGallery - the in-channel photo wall for a GROUP photo-proof
 * contest. EVERYONE who can see the challenge sees every submitter's photo +
 * who they are. The challenger gets an inline "Pick" on each tile to crown the
 * winner (until a winner is set); the winning tile is then highlighted with a
 * crown for all viewers. Tapping any photo opens a fullscreen preview so the
 * challenger can compare before choosing.
 *
 * Backed by GET /challenges/{id}/submissions (latest photo per submitter).
 * Re-fetches when `refreshKey` changes (a new submission / winner landing over
 * WS bumps it from the parent).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Modal, Pressable, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { fetchGroupSubmissions, pickWinner, type GroupSubmission } from '@/api/challenges';
import { avatarColor } from '@/lib/avatarColors';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

export function GroupSubmissionsGallery({
  challengeId, isChallenger, isValidated, refreshKey, onChanged, onCount, openSignal,
}: {
  challengeId:  string;
  isChallenger: boolean;
  isValidated:  boolean;
  refreshKey?:  number;
  onChanged?:   () => void;
  /** Reports the current submission count (for the owner's hint copy). */
  onCount?:     (n: number) => void;
  /** Bump to open the gallery modal programmatically (e.g. proof-submitted push). */
  openSignal?:  number;
}) {
  const { t } = useTranslation('challenge');
  const [subs,     setSubs]     = useState<GroupSubmission[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [open,     setOpen]     = useState(false);
  const [picking,  setPicking]  = useState<string | null>(null);
  const [preview,  setPreview]  = useState<GroupSubmission | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchGroupSubmissions(challengeId);
      setSubs(r.submissions);
      setWinnerId(r.winnerUserId);
      onCount?.(r.submissions.length);
    } catch {
      // soft-fail - the gallery just stays empty/last-known
    } finally {
      setLoading(false);
    }
  }, [challengeId, onCount]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Open the modal on demand (e.g. the challenger tapped a "new photo" push).
  useEffect(() => { if (openSignal && openSignal > 0) setOpen(true); }, [openSignal]);

  const handlePick = useCallback((s: GroupSubmission) => {
    Alert.alert(
      t('group.winnerConfirmTitle', { defaultValue: 'Crown the winner?' }),
      t('group.winnerConfirmBody', { name: s.display_name, defaultValue: `${s.display_name} wins the big reward.` }),
      [
        { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('group.winnerConfirm', { defaultValue: 'Crown the winner' }),
          onPress: async () => {
            setPicking(s.user_id);
            try {
              await pickWinner(challengeId, s.user_id);
              await load();
              onChanged?.();
            } catch (e) {
              const code = (e as { code?: string })?.code;
              Alert.alert(code === 'no_submission'
                ? t('group.winnerNoSubmission', { defaultValue: "That person hasn't submitted a photo." })
                : t('group.winnerFailed', { defaultValue: 'Could not pick the winner - try again.' }));
            } finally {
              setPicking(null);
            }
          },
        },
      ],
    );
  }, [challengeId, load, onChanged, t]);

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={Colors.muted} /></View>;
  }
  if (subs.length === 0) return null;

  const canPick = isChallenger && !winnerId && !isValidated;

  return (
    <>
      {/* Single CTA - opens the gallery modal (keeps the channel compact). */}
      <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={() => setOpen(true)}>
        <View style={styles.ctaThumbs}>
          {subs.slice(0, 3).map((s, i) => (
            <Image key={s.id} source={{ uri: s.media_url }} style={[styles.ctaThumb, i > 0 && { marginLeft: -10 }]} contentFit="cover" cachePolicy="memory-disk" />
          ))}
        </View>
        <Text style={styles.ctaLabel} numberOfLines={1}>
          📸 {t('group.submissionsHeader', { count: subs.length, defaultValue: '{{count}} photos' })}
          {!winnerId && canPick ? `  ·  ${t('group.tapToPick', { defaultValue: 'pick the best one' })}` : ''}
        </Text>
        <Text style={styles.ctaChev}>›</Text>
      </TouchableOpacity>

      {/* Grid modal - every submission + who. */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>📸 {t('group.submissionsHeader', { count: subs.length, defaultValue: '{{count}} photos' })}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={10}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>
          {canPick ? <Text style={styles.modalHint}>{t('group.winnerSub', { defaultValue: 'Choose the best photo. The winner earns the big reward.' })}</Text> : null}
          <ScrollView contentContainerStyle={styles.grid}>
        {subs.map((s) => {
          const isWin = winnerId === s.user_id;
          return (
            <View key={s.id} style={[styles.tile, isWin && styles.tileWin]}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => setPreview(s)}>
                <Image source={{ uri: s.media_url }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
                {isWin ? (
                  <View style={styles.winBadge}>
                    <Text style={styles.winBadgeText}>👑 {t('group.winnerTag', { defaultValue: 'Winner' })}</Text>
                  </View>
                ) : null}
                {picking === s.user_id ? (
                  <View style={styles.pickingOverlay}><ActivityIndicator color="#fff" /></View>
                ) : null}
              </TouchableOpacity>

              <View style={styles.tileFooter}>
                <View style={[styles.avatar, { backgroundColor: avatarColor(s.user_id) }]}>
                  {s.avatar_url
                    ? <Image source={{ uri: s.avatar_url }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    : <Text style={styles.avatarLetter}>{(s.display_name[0] ?? '?').toUpperCase()}</Text>}
                </View>
                <Text style={styles.name} numberOfLines={1}>{s.display_name}</Text>
              </View>

              {canPick ? (
                <TouchableOpacity style={styles.pickBtn} activeOpacity={0.85} onPress={() => handlePick(s)} disabled={!!picking}>
                  <Text style={styles.pickBtnText}>👑 {t('group.pickThis', { defaultValue: 'Pick winner' })}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}
          </ScrollView>
        </View>
      </Modal>

      {/* Fullscreen preview - tap to compare, tap again to dismiss. */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          {preview ? (
            <>
              <Image source={{ uri: preview.media_url }} style={styles.previewImg} contentFit="contain" />
              <Text style={styles.previewName}>{preview.display_name}</Text>
              {canPick ? (
                <TouchableOpacity
                  style={styles.previewPick}
                  activeOpacity={0.85}
                  onPress={() => { const p = preview; setPreview(null); if (p) handlePick(p); }}
                >
                  <Text style={styles.previewPickText}>👑 {t('group.pickThis', { defaultValue: 'Pick winner' })}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { padding: Spacing.md, alignItems: 'center' },

  // CTA row (collapsed) - thumbs + "{n} photos" + chevron.
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.md, marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.md, backgroundColor: Colors.bg3,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  ctaThumbs: { flexDirection: 'row' },
  ctaThumb:  { width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: Colors.bg3 },
  ctaLabel:  { flex: 1, fontSize: FontSizes.sm, fontWeight: '800', color: Colors.text },
  ctaChev:   { fontSize: 20, color: Colors.muted },

  // Grid modal (bottom sheet).
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: Spacing.md, paddingTop: 12, paddingBottom: 28, maxHeight: '85%',
  },
  modalHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  modalClose: { fontSize: 18, color: Colors.muted, paddingHorizontal: 4 },
  modalHint:  { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 4, marginBottom: 8 },

  grid:    { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingTop: Spacing.sm },
  tile: {
    width: '47.5%',
    backgroundColor: Colors.bg3,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  tileWin: { borderColor: '#FFC93C', borderWidth: 2 },

  photo: { width: '100%', aspectRatio: 1, backgroundColor: '#000' },
  winBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: 'rgba(255,201,60,0.95)',
    borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2,
  },
  winBadgeText: { fontSize: 11, fontWeight: '800', color: '#1a1206' },
  pickingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },

  tileFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  avatar: { width: 22, height: 22, borderRadius: 11, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: '700', fontSize: 11 },
  name: { flex: 1, fontSize: FontSizes.xs + 1, fontWeight: '700', color: Colors.text },

  pickBtn: {
    // Solid fill (matches the fullscreen previewPick) so the challenger reads
    // it as "tap to crown", not a passive/already-picked label.
    margin: 8, marginTop: 0, paddingVertical: 9, borderRadius: Radius.full, alignItems: 'center',
    backgroundColor: '#FFC93C',
  },
  pickBtnText: { fontSize: FontSizes.xs + 1, fontWeight: '800', color: '#1a1206' },

  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  previewImg:  { width: '92%', height: '70%' },
  previewName: { fontSize: FontSizes.md, fontWeight: '800', color: '#fff' },
  previewPick: {
    paddingHorizontal: 22, paddingVertical: 12, borderRadius: Radius.full,
    backgroundColor: '#FFC93C',
  },
  previewPickText: { fontSize: FontSizes.md, fontWeight: '800', color: '#1a1206' },
});
