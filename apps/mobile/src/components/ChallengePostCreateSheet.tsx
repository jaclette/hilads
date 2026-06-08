import { useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { fetchCityMembers } from '@/api/channels';
import { inviteToChallenge } from '@/api/challenges';
import type { Challenge, UserDTO } from '@/types';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { avatarColor } from '@/lib/avatarColors';

type Props = {
  visible:        boolean;
  challenge:      Challenge | null;
  cityChannelId:  string | null;    // for fetching members
  cityName:       string | null;
  currentUserId:  string | null;    // exclude self from picker
  onClose:        () => void;
  onShare:        () => void;       // hook into existing share flow
};

/**
 * Two-step floating flow shown immediately after publishing a challenge.
 *
 * Step 1 ("seed"): a sheet with two CTAs - "Send it to someone in {city}"
 * (opens the picker) and "Share outside Hilads" (native share).
 *
 * Step 2 ("picker"): multi-select list of city members filtered by the
 * challenge's audience (locals → mode='local', explorers → 'exploring').
 * Submit fires invitations; the backend creates in-app notifications + push
 * with Accept / Ignore action buttons in the notification tray.
 */
export function ChallengePostCreateSheet({
  visible, challenge, cityChannelId, cityName, currentUserId, onClose, onShare,
}: Props) {
  const { t } = useTranslation('challenge');
  const [step, setStep] = useState<'seed' | 'picker'>('seed');

  // Reset step every time the sheet opens so a re-show always starts at seed.
  useEffect(() => { if (visible) setStep('seed'); }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        {step === 'seed' ? (
          <SeedView
            challenge={challenge}
            cityName={cityName}
            onPickPeople={() => setStep('picker')}
            onShare={() => { onShare(); onClose(); }}
            onSkip={onClose}
            t={t}
          />
        ) : (
          <PickerView
            challenge={challenge}
            cityChannelId={cityChannelId}
            cityName={cityName}
            currentUserId={currentUserId}
            onDone={onClose}
            onBack={() => setStep('seed')}
            t={t}
          />
        )}
      </View>
    </Modal>
  );
}

// ── Seed view (2 CTAs) ───────────────────────────────────────────────────────

function SeedView({
  challenge, cityName, onPickPeople, onShare, onSkip, t,
}: {
  challenge: Challenge | null;
  cityName:  string | null;
  onPickPeople: () => void;
  onShare:      () => void;
  onSkip:       () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const audienceLabel = challenge?.audience === 'locals' ? t('aud.locals') : t('aud.explorers');
  const city = cityName ?? t('postCreate.thisCity');
  return (
    <View style={styles.body}>
      <Text style={styles.title}>{t('postCreate.title')} 🎯</Text>
      <Text style={styles.subtitle}>{t('postCreate.subtitle')}</Text>

      <TouchableOpacity style={styles.ctaPrimary} onPress={onPickPeople} activeOpacity={0.85}>
        <Ionicons name="people" size={20} color={Colors.white} />
        <View style={{ flex: 1 }}>
          <Text style={styles.ctaPrimaryText}>{t('postCreate.ctaInvite', { city })}</Text>
          <Text style={styles.ctaPrimarySub}>{t('postCreate.ctaInviteSub', { audience: audienceLabel })}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.ctaSecondary} onPress={onShare} activeOpacity={0.85}>
        <Ionicons name="share-social-outline" size={18} color="#FF7A3C" />
        <Text style={styles.ctaSecondaryText}>{t('postCreate.ctaShare')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.skipBtn} onPress={onSkip} activeOpacity={0.7}>
        <Text style={styles.skipText}>{t('postCreate.skip')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Picker view ──────────────────────────────────────────────────────────────

function PickerView({
  challenge, cityChannelId, cityName, currentUserId, onDone, onBack, t,
}: {
  challenge: Challenge | null;
  cityChannelId: string | null;
  cityName: string | null;
  currentUserId: string | null;
  onDone: () => void;
  onBack: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}) {
  const mode = challenge?.audience === 'locals' ? 'local' : 'exploring';
  const [members,  setMembers]  = useState<UserDTO[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending,  setSending]  = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  // Most users have mode IS NULL (joined before the local/traveler picker
  // existed) so the strict mode filter often returns 0 rows in low-traffic
  // cities. Fall back to the whole city roster when that happens so the
  // picker is never a dead-end. The accept path re-checks mode server-side
  // and surfaces a clear error if the invitee can't actually take it on.
  const [fellBack, setFellBack] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!cityChannelId) return;
      setLoading(true);
      setError(null);
      setFellBack(false);

      const filterUsable = (arr: UserDTO[] | undefined) => (arr ?? []).filter(m =>
        m.accountType === 'registered' && m.id !== currentUserId,
      );

      try {
        // 1. Strict mode filter first.
        const strict = await fetchCityMembers(cityChannelId, { limit: 50, mode });
        if (!active) return;
        let list = filterUsable(strict.members);
        // 2. Empty? Re-fetch without the filter so we still show the roster.
        if (list.length === 0) {
          const all = await fetchCityMembers(cityChannelId, { limit: 50 });
          if (!active) return;
          list = filterUsable(all.members);
          if (list.length > 0) setFellBack(true);
        }
        setMembers(list);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Failed to load members');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [cityChannelId, mode, currentUserId]);

  function toggle(uid: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function handleSend() {
    if (!challenge || selected.size === 0 || sending) return;
    setSending(true);
    try {
      const res = await inviteToChallenge(challenge.id, Array.from(selected));
      setSentCount(res.count);
      // Brief success state, then close.
      setTimeout(() => onDone(), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invitations');
      setSending(false);
    }
  }

  const audienceLabel = challenge?.audience === 'locals' ? t('aud.locals') : t('aud.explorers');
  const city = cityName ?? '';

  if (sentCount !== null) {
    return (
      <View style={[styles.body, { alignItems: 'center', paddingVertical: Spacing.xl }]}>
        <Text style={{ fontSize: 40 }}>🤝</Text>
        <Text style={styles.title}>{t('postCreate.sentTitle', { count: sentCount })}</Text>
        <Text style={styles.subtitle}>{t('postCreate.sentSubtitle')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <View style={styles.pickerHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={12} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={18} color={Colors.muted} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('postCreate.pickerTitle', { audience: audienceLabel, city })}</Text>
          <Text style={styles.subtitle}>
            {fellBack
              ? t('postCreate.pickerSubtitleAll', { city: city || t('postCreate.thisCity') })
              : t('postCreate.pickerSubtitle')}
          </Text>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={Colors.muted} style={{ marginVertical: Spacing.lg }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : members.length === 0 ? (
          <Text style={styles.empty}>{t('postCreate.pickerEmpty', { audience: audienceLabel.toLowerCase() })}</Text>
        ) : (
          members.map(m => {
            const isSelected = selected.has(m.id);
            const avatar = m.thumbAvatarUrl ?? m.avatarUrl ?? null;
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.memberRow, isSelected && styles.memberRowSelected]}
                onPress={() => toggle(m.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.avatar, { backgroundColor: avatarColor(m.id) }]}>
                  {avatar ? (
                    <Image source={{ uri: avatar }} style={StyleSheet.absoluteFill} cachePolicy="memory-disk" contentFit="cover" />
                  ) : (
                    <Text style={styles.avatarText}>{(m.displayName?.[0] ?? '?').toUpperCase()}</Text>
                  )}
                </View>
                <View style={styles.rowInfo}>
                  <Text style={styles.name} numberOfLines={1}>{m.displayName}</Text>
                  {m.username ? <Text style={styles.handleText} numberOfLines={1}>@{m.username}</Text> : null}
                </View>
                <View style={[styles.check, isSelected && styles.checkSelected]}>
                  {isSelected ? <Ionicons name="checkmark" size={16} color={Colors.white} /> : null}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <TouchableOpacity
        style={[styles.sendBtn, (selected.size === 0 || sending) && styles.sendBtnDisabled]}
        disabled={selected.size === 0 || sending}
        onPress={handleSend}
        activeOpacity={0.85}
      >
        {sending
          ? <ActivityIndicator color={Colors.white} size="small" />
          : (
            <Text style={styles.sendBtnText}>
              {selected.size === 0
                ? t('postCreate.sendCtaEmpty')
                : t('postCreate.sendCta', { count: selected.size })}
            </Text>
          )
        }
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '85%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4,
  },
  body: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },

  title:    { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  subtitle: { fontSize: FontSizes.sm, color: Colors.muted, marginBottom: Spacing.sm },

  // ── Seed view CTAs ─────────────────────────────────────────────────────────
  ctaPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FF7A3C',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    marginTop: Spacing.xs,
  },
  ctaPrimaryText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
  ctaPrimarySub:  { color: 'rgba(255,255,255,0.85)', fontSize: FontSizes.xs + 1, marginTop: 2 },

  ctaSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: Spacing.md - 2,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: 'rgba(255,122,60,0.4)',
    backgroundColor: 'rgba(255,122,60,0.08)',
  },
  ctaSecondaryText: { color: '#FF7A3C', fontSize: FontSizes.md, fontWeight: '700' },

  skipBtn: { paddingVertical: Spacing.sm, alignItems: 'center' },
  skipText: { color: Colors.muted, fontSize: FontSizes.sm, fontWeight: '600' },

  // ── Picker view ────────────────────────────────────────────────────────────
  pickerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingBottom: 4 },
  headerBack: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  list:        { maxHeight: 360 },
  listContent: { paddingBottom: Spacing.sm, gap: 4 },
  empty:       { color: Colors.muted, textAlign: 'center', marginVertical: Spacing.lg },
  errorText:   { color: Colors.red, textAlign: 'center', marginVertical: Spacing.md },

  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 10,
    borderRadius: Radius.md,
  },
  memberRowSelected: { backgroundColor: 'rgba(255,122,60,0.08)' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: FontSizes.md },
  rowInfo: { flex: 1 },
  name: { fontSize: FontSizes.md, fontWeight: '600', color: Colors.text },
  handleText: { fontSize: FontSizes.sm, color: Colors.muted },
  check: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  checkSelected: {
    backgroundColor: '#FF7A3C',
    borderColor: '#FF7A3C',
  },

  sendBtn: {
    marginTop: Spacing.sm,
    backgroundColor: '#FF7A3C',
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
});
