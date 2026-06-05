/**
 * ChallengeProofBlock — proof flow surface for International challenges.
 *
 * Renders three faces depending on who's viewing + the latest proof state:
 *
 *   ACCEPTOR (phase='accepted', no proofs yet)
 *      → "Submit your proof" CTA. Tap opens the picker + GPS capture.
 *
 *   ACCEPTOR (phase='proof_submitted', latest proof pending)
 *      → "Waiting for verdict" + media preview.
 *
 *   ACCEPTOR (latest proof rejected, attempts remaining)
 *      → "Try again" CTA + the creator's rejection reason inline.
 *
 *   CREATOR (latest proof pending)
 *      → Media preview + Approve / Reject buttons. Reject opens a reason
 *        prompt (mandatory, 1–200 chars).
 *
 *   CREATOR / ACCEPTOR (terminal)
 *      → A short status line ("Accomplished" or "Closed"). The pipeline above
 *        already carries the canonical state; this block stays compact.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, TextInput, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchProofs, submitProof, approveProof, rejectProof,
  type ChallengeProof,
} from '@/api/challenges';
import { uploadFile } from '@/api/uploads';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

type Props = {
  acceptanceId: string;
  iAmCreator:   boolean;
  iAmAcceptor:  boolean;
  proofRequirements: string | null;
};

export function ChallengeProofBlock({
  acceptanceId, iAmCreator, iAmAcceptor, proofRequirements,
}: Props) {
  const { t } = useTranslation('challenge');
  const [proofs,      setProofs]      = useState<ChallengeProof[]>([]);
  const [attempts,    setAttempts]    = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [loading,     setLoading]     = useState(true);
  const [busy,        setBusy]        = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchProofs(acceptanceId);
      setProofs(data.proofs);
      setAttempts(data.attempts);
      setMaxAttempts(data.maxAttempts);
    } catch {
      // soft-fail — the block renders the "no proofs yet" branch
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, [acceptanceId]);

  useEffect(() => { load(); }, [load]);

  const latest = proofs[0] ?? null;
  const attemptsLeft = Math.max(0, maxAttempts - attempts);
  const isFinal = latest?.status === 'rejected' && attemptsLeft === 0;

  // ── Acceptor: submit a proof ──────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (busy) return;

    // 1. Permission + photo pick
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (lib.status !== 'granted') {
      Alert.alert(t('intl.proof.permPhotoTitle'), t('intl.proof.permPhotoBody'));
      return;
    }
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.85,
    });
    if (pick.canceled || !pick.assets?.[0]) return;
    const asset = pick.assets[0];

    // 2. GPS capture — mandatory per spec
    const loc = await Location.requestForegroundPermissionsAsync();
    if (loc.status !== 'granted') {
      Alert.alert(t('intl.proof.permGpsTitle'), t('intl.proof.permGpsBody'));
      return;
    }
    let pos: Location.LocationObject;
    try {
      pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch {
      Alert.alert(t('intl.proof.gpsFailTitle'), t('intl.proof.gpsFailBody'));
      return;
    }

    // 3. Upload media → 4. Submit
    setBusy('submit');
    try {
      const { url } = await uploadFile(asset.uri, asset.mimeType ?? null);
      await submitProof(acceptanceId, {
        mediaUrl:  url,
        mediaType: 'image',
        lat:       pos.coords.latitude,
        lng:       pos.coords.longitude,
      });
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.submitFailTitle'), e instanceof Error ? e.message : t('intl.proof.submitFailBody'));
    } finally {
      setBusy(null);
    }
  }, [busy, acceptanceId, load, t]);

  // ── Creator: approve / reject ─────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!latest || busy) return;
    setBusy('approve');
    try {
      await approveProof(latest.id);
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.reviewFailTitle'), e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  }, [latest, busy, load, t]);

  const handleReject = useCallback(async () => {
    if (!latest || busy) return;
    const reason = rejectReason.trim();
    if (reason.length === 0 || reason.length > 200) {
      Alert.alert(t('intl.proof.reasonRequiredTitle'), t('intl.proof.reasonRequiredBody'));
      return;
    }
    setBusy('reject');
    try {
      await rejectProof(latest.id, reason);
      setRejectOpen(false);
      setRejectReason('');
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.reviewFailTitle'), e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  }, [latest, busy, rejectReason, load, t]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.card, { alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.muted} />
      </View>
    );
  }

  // Terminal — short status line; the pipeline above carries the icon.
  if (latest?.status === 'approved') {
    return (
      <View style={styles.card}>
        <Text style={styles.terminalLine}>🎉 {t('intl.proof.approvedLine')}</Text>
      </View>
    );
  }
  if (latest?.status === 'rejected' && isFinal) {
    return (
      <View style={styles.card}>
        <Text style={styles.terminalLine}>{t('intl.proof.closedLine')}</Text>
        {latest.rejection_reason ? (
          <Text style={styles.reasonLine} numberOfLines={3}>
            {t('intl.proof.lastReason', { reason: latest.rejection_reason })}
          </Text>
        ) : null}
      </View>
    );
  }

  // Pending — creator reviews; acceptor waits.
  if (latest?.status === 'pending') {
    return (
      <View style={styles.card}>
        <Image source={{ uri: latest.media_url }} style={styles.media} contentFit="cover" />
        <View style={styles.geotagRow}>
          <Ionicons
            name={latest.geotag_verified ? 'location' : 'warning-outline'}
            size={13}
            color={latest.geotag_verified ? '#4ade80' : '#fbbf24'}
          />
          <Text style={[styles.geotagText, latest.geotag_verified ? styles.geotagOk : styles.geotagWarn]}>
            {latest.geotag_verified ? t('intl.proof.geotagOk') : t('intl.proof.geotagWarn')}
          </Text>
        </View>
        {iAmCreator ? (
          <View style={styles.verdictRow}>
            <TouchableOpacity
              style={[styles.verdictBtn, styles.verdictApprove, busy && { opacity: 0.5 }]}
              onPress={handleApprove}
              disabled={!!busy}
              activeOpacity={0.85}
            >
              {busy === 'approve'
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.verdictApproveText}>✓ {t('intl.proof.approveCta')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.verdictBtn, styles.verdictReject, busy && { opacity: 0.5 }]}
              onPress={() => setRejectOpen(true)}
              disabled={!!busy}
              activeOpacity={0.85}
            >
              <Text style={styles.verdictRejectText}>✕ {t('intl.proof.rejectCta')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.terminalLine}>{t('intl.proof.waitingVerdict')}</Text>
        )}

        {/* Reject reason modal — mandatory, 1–200 chars. */}
        <Modal visible={rejectOpen} animationType="slide" transparent onRequestClose={() => setRejectOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRejectOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('intl.proof.rejectModalTitle')}</Text>
            <Text style={styles.modalHint}>{t('intl.proof.rejectModalHint', { count: attemptsLeft })}</Text>
            <TextInput
              style={styles.reasonInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder={t('intl.proof.reasonPlaceholder')}
              placeholderTextColor={Colors.muted2}
              maxLength={200}
              multiline
              autoFocus
            />
            <Text style={styles.charCount}>{rejectReason.length} / 200</Text>
            <TouchableOpacity
              style={[styles.modalSubmit, (!rejectReason.trim() || busy === 'reject') && { opacity: 0.5 }]}
              onPress={handleReject}
              disabled={!rejectReason.trim() || busy === 'reject'}
              activeOpacity={0.85}
            >
              {busy === 'reject'
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.modalSubmitText}>{t('intl.proof.rejectConfirm')}</Text>}
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // No pending proof yet — either fresh acceptance or after a non-terminal
  // rejection. The acceptor sees the submit CTA; the creator sees a waiting
  // line with the last rejection reason if any.
  const lastRejected = latest?.status === 'rejected' ? latest : null;
  return (
    <View style={styles.card}>
      {proofRequirements ? (
        <View style={styles.reqsBlock}>
          <Text style={styles.reqsLabel}>{t('intl.proof.requirementsLabel')}</Text>
          <Text style={styles.reqsText}>{proofRequirements}</Text>
        </View>
      ) : null}

      {lastRejected ? (
        <Text style={styles.reasonLine} numberOfLines={3}>
          {t('intl.proof.lastReason', { reason: lastRejected.rejection_reason ?? '' })}
        </Text>
      ) : null}

      {iAmAcceptor ? (
        <TouchableOpacity
          style={[styles.submitBtn, busy && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={!!busy}
          activeOpacity={0.85}
        >
          {busy === 'submit'
            ? <ActivityIndicator color={Colors.white} />
            : (
              <Text style={styles.submitBtnText}>
                {lastRejected
                  ? t('intl.proof.tryAgainCta', { count: attemptsLeft })
                  : t('intl.proof.submitCta')}
              </Text>
            )}
        </TouchableOpacity>
      ) : (
        <Text style={styles.terminalLine}>{t('intl.proof.waitingProof')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin:           Spacing.md,
    padding:          Spacing.md,
    borderRadius:     Radius.lg,
    backgroundColor:  Colors.bg2,
    borderWidth:      1,
    borderColor:      'rgba(255,255,255,0.06)',
    gap:              Spacing.sm,
  },
  reqsBlock: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,122,60,0.5)',
    paddingLeft:     Spacing.sm,
    gap:             2,
  },
  reqsLabel: { fontSize: FontSizes.xs, fontWeight: '700', color: '#FF7A3C', letterSpacing: 0.6, textTransform: 'uppercase' },
  reqsText:  { fontSize: FontSizes.sm, color: Colors.text, lineHeight: 18 },

  media: { width: '100%', aspectRatio: 4/3, borderRadius: Radius.md, backgroundColor: '#000' },

  geotagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  geotagText: { fontSize: 11, fontWeight: '600' },
  geotagOk:   { color: '#4ade80' },
  geotagWarn: { color: '#fbbf24' },

  verdictRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  verdictBtn: { flex: 1, paddingVertical: Spacing.sm + 2, borderRadius: Radius.full, alignItems: 'center' },
  verdictApprove: { backgroundColor: '#22c55e' },
  verdictReject:  { borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.08)' },
  verdictApproveText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.sm },
  verdictRejectText:  { color: '#ef4444', fontWeight: '800', fontSize: FontSizes.sm },

  submitBtn: {
    backgroundColor: '#FF7A3C',
    paddingVertical: Spacing.md,
    borderRadius:    Radius.full,
    alignItems:      'center',
    marginTop:       Spacing.xs,
  },
  submitBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md },

  terminalLine: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text, textAlign: 'center', paddingVertical: 4 },
  reasonLine:   { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 18 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.sm,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  modalHint:  { fontSize: FontSizes.sm, color: Colors.muted },
  reasonInput: {
    minHeight:         96,
    textAlignVertical: 'top',
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    fontSize:          FontSizes.md,
    color:             Colors.text,
  },
  charCount: { fontSize: 11, color: Colors.muted2, textAlign: 'right' },
  modalSubmit: {
    backgroundColor: '#ef4444',
    paddingVertical: Spacing.md,
    borderRadius:    Radius.full,
    alignItems:      'center',
    marginTop:       Spacing.xs,
  },
  modalSubmitText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md },
});
