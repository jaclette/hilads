import { thumbUrl } from '@/lib/imageThumb';
/**
 * Blocked Users settings screen - Settings → Blocked users.
 *
 * Required by Apple Guideline 1.2: users must be able to review and undo
 * blocks. Powered by GET /users/me/blocks (auth required).
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { fetchMyBlocks, unblockById, type BlockRow } from '@/api/blocks';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { avatarColor as avatarBg } from '@/lib/avatarColors';

export default function BlockedUsersScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('misc');
  const { account, removeBlocked } = useApp();

  const [rows,        setRows]        = useState<BlockRow[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [busyIds,     setBusyIds]     = useState<Set<number>>(new Set());

  // Auth gate - backend requires registered user; redirect guests to landing.
  useEffect(() => {
    if (!canAccessProfile(account)) {
      router.replace('/auth-gate');
    }
  }, [account]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await fetchMyBlocks();
      setRows(data);
    } catch {
      // silent - empty state will show
    } finally {
      if (isRefresh) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleUnblock(row: BlockRow) {
    const name = row.display_name ?? row.target_nickname ?? t('blocked.thisUser');
    Alert.alert(
      t('blocked.unblockTitle', { name }),
      t('blocked.unblockBody', { name }),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('blocked.unblock'),
          onPress: async () => {
            // Optimistic: drop the row + patch context immediately.
            setBusyIds(prev => { const next = new Set(prev); next.add(row.id); return next; });
            const before = rows;
            setRows(prev => prev.filter(r => r.id !== row.id));
            removeBlocked({
              userId:  row.blocked_user_id  ?? null,
              guestId: row.blocked_guest_id ?? null,
            });
            try {
              await unblockById(row.id);
            } catch {
              // Roll back on failure.
              setRows(before);
              Alert.alert(t('blocked.unblockFailTitle'), t('blocked.unblockFailBody'));
            } finally {
              setBusyIds(prev => { const next = new Set(prev); next.delete(row.id); return next; });
            }
          },
        },
      ],
    );
  }

  function renderRow({ item }: { item: BlockRow }) {
    const name    = item.display_name ?? item.target_nickname ?? t('blocked.ghostName');
    const initial = name[0]?.toUpperCase() ?? '?';
    const photo   = item.profile_thumb_photo_url ?? item.profile_photo_url ?? null;
    const busy    = busyIds.has(item.id);

    return (
      <View style={styles.row}>
        {photo ? (
          <Image source={{ uri: thumbUrl(photo) }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: avatarBg(name) }]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {!item.blocked_user_id && item.blocked_guest_id ? (
            <Text style={styles.subtitle}>{t('blocked.guest')}</Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.unblockBtn, busy && styles.unblockBtnDisabled]}
          onPress={() => handleUnblock(item)}
          disabled={busy}
          activeOpacity={0.75}
        >
          {busy
            ? <ActivityIndicator size="small" color={colors.text} />
            : <Text style={styles.unblockBtnText}>{t('blocked.unblock')}</Text>
          }
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('blocked.title')}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🤝</Text>
          <Text style={styles.emptyTitle}>{t('blocked.emptyTitle')}</Text>
          <Text style={styles.emptySub}>{t('blocked.emptySub')}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accent}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const AVATAR_SIZE = 44;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    minHeight:         56,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    Radius.md,
    backgroundColor: c.bg2,
    borderWidth:     1,
    borderColor:     c.border,
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
    fontSize:      FontSizes.lg,
    fontWeight:    '800',
    color:         c.text,
    letterSpacing: -0.3,
  },

  center: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: Spacing.xl,
    gap:             10,
  },
  emptyEmoji: { fontSize: 44 },
  emptyTitle: {
    fontSize:    FontSizes.lg,
    fontWeight:  '700',
    color:       c.text,
    textAlign:   'center',
  },
  emptySub: {
    fontSize:    FontSizes.sm,
    color:       c.muted,
    textAlign:   'center',
    lineHeight:  20,
  },

  listContent: {
    paddingVertical: Spacing.sm,
  },
  divider: {
    height:          1,
    backgroundColor: c.border,
    marginLeft:      Spacing.md + AVATAR_SIZE + 12,
  },

  row: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    gap:               12,
  },
  avatar: {
    width:        AVATAR_SIZE,
    height:       AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    flexShrink:   0,
  },
  avatarFallback: {
    width:          AVATAR_SIZE,
    height:         AVATAR_SIZE,
    borderRadius:   AVATAR_SIZE / 2,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  avatarInitial: {
    fontSize:   FontSizes.md,
    fontWeight: '800',
    color:      '#fff',
  },
  info: {
    flex: 1,
    gap:  2,
  },
  name: {
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      c.text,
  },
  subtitle: {
    fontSize: FontSizes.xs,
    color:    c.muted2,
  },

  unblockBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.xs + 2,
    borderRadius:      Radius.full,
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
    minWidth:          80,
    alignItems:        'center',
  },
  unblockBtnDisabled: {
    opacity: 0.5,
  },
  unblockBtnText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      c.text,
  },
});
