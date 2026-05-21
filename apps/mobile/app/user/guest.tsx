/**
 * Guest profile screen — /user/guest
 *
 * Shown when a feed join-bubble is tapped for a guest who has no registered
 * account. Receives nickname + guestId as route params; shows a minimal
 * profile card with generated avatar, "Guest" label, and city context.
 * Does NOT call the /users/{id} API endpoint.
 */

import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { avatarColor as avatarBg } from '@/lib/avatarColors';
import { ReportModal } from '@/features/profile/ReportModal';
import { ProfileActionSheet } from '@/features/profile/ProfileActionSheet';
import { fetchReportStatus, type ExistingReport } from '@/api/reports';
import { submitBlock } from '@/api/blocks';
import { formatDateLabel } from '@/lib/messageTime';

// ── Screen ────────────────────────────────────────────────────────────────────

export default function GuestProfileScreen() {
  const router = useRouter();
  const { nickname, guestId } = useLocalSearchParams<{ nickname: string; guestId: string }>();
  const { city, identity, account, addBlocked, removeBlocked } = useApp();

  const name    = nickname || 'Ghost';
  const initial = name[0].toUpperCase();
  const bg      = avatarBg(name);

  const [showReportModal, setShowReportModal] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [blockBusy,       setBlockBusy]       = useState(false);
  const [existingReport,  setExistingReport]  = useState<ExistingReport | null>(null);

  function handleBlockPress() {
    if (!guestId || blockBusy) return;
    Alert.alert(
      `Block ${name}?`,
      `You won't see content from ${name}, and they won't see yours. You can unblock anyone later from Me → Settings → Blocked users.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            try {
              addBlocked({ guestId });
              await submitBlock({
                targetGuestId:  guestId,
                targetNickname: name,
                guestId:        account ? undefined : identity?.guestId,
              });
              router.back();
            } catch {
              removeBlocked({ guestId });
              Alert.alert('Could not block', 'Please try again.');
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  }

  useEffect(() => {
    if (!guestId) return;
    fetchReportStatus({
      guestId: account ? undefined : identity?.guestId ?? undefined,
      targetGuestId: guestId,
    })
      .then(r => setExistingReport(r.reported ? (r.existing ?? null) : null))
      .catch(() => {});
  }, [guestId, account, identity?.guestId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
      </View>

      {/* Hero */}
      <View style={styles.hero}>
        <View style={[styles.avatar, { backgroundColor: bg }]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>

        <Text style={styles.displayName}>{name}</Text>

        <View style={styles.guestBadge}>
          <Text style={styles.guestBadgeText}>👻 Ghost</Text>
        </View>

        {city ? (
          <Text style={styles.cityLabel}>Visiting {city.name}</Text>
        ) : null}
      </View>

      <Text style={styles.note}>Floating around as a ghost 👻</Text>

      <TouchableOpacity
        style={styles.reportLink}
        onPress={() => setShowActionSheet(true)}
        activeOpacity={0.6}
        accessibilityLabel="More options"
      >
        <Text style={styles.reportLinkText}>More options</Text>
      </TouchableOpacity>

      <ProfileActionSheet
        visible={showActionSheet}
        title={name}
        actions={[
          {
            key:      'report',
            label:    existingReport ? 'Already reported' : 'Report user',
            icon:     'flag-outline',
            disabled: !!existingReport,
            onPress:  () => {
              if (existingReport) {
                Alert.alert(
                  'Already reported',
                  `You reported this user on ${formatDateLabel(existingReport.created_at)}. Your report is being reviewed.`,
                );
                return;
              }
              setShowReportModal(true);
            },
          },
          {
            key:         'block',
            label:       blockBusy ? 'Blocking…' : 'Block user',
            icon:        'ban-outline',
            destructive: true,
            disabled:    blockBusy,
            onPress:     handleBlockPress,
          },
        ]}
        onClose={() => setShowActionSheet(false)}
      />

      <ReportModal
        visible={showReportModal}
        reporterGuestId={account ? undefined : identity?.guestId}
        targetGuestId={guestId}
        targetNickname={name}
        onClose={() => setShowReportModal(false)}
      />

    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 88;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.md,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    zIndex:          1,
  },
  headerCenter: {
    position:   'absolute',
    left:       0,
    right:      0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
  },

  hero: {
    alignItems:    'center',
    paddingTop:    Spacing.xxl,
    paddingBottom: Spacing.md,
    gap:           12,
  },
  avatar: {
    width:          AVATAR_SIZE,
    height:         AVATAR_SIZE,
    borderRadius:   AVATAR_SIZE / 2,
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize:   36,
    fontWeight: '800',
    color:      '#fff',
  },
  displayName: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.5,
    textAlign:     'center',
  },
  guestBadge: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.10)',
    borderRadius:    Radius.full,
    paddingHorizontal: 10,
    paddingVertical:   4,
  },
  guestBadgeText: {
    fontSize:      FontSizes.xs,
    fontWeight:    '700',
    color:         Colors.muted,
    letterSpacing: 0.6,
  },
  cityLabel: {
    fontSize: FontSizes.sm,
    color:    Colors.muted2,
  },
  note: {
    textAlign:         'center',
    fontSize:          FontSizes.sm,
    color:             Colors.muted2,
    opacity:           0.6,
    paddingHorizontal: Spacing.xl,
    marginTop:         Spacing.sm,
  },
  reportLink: {
    alignItems:  'center',
    marginTop:   Spacing.xl,
  },
  // "More options" link — was rgba(255,255,255,0.2) (~1.7:1, near-invisible).
  // Routed through the theme so it inherits future contrast fixes.
  reportLinkText: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
  },
});
