import { thumbUrl } from '@/lib/imageThumb';
/**
 * Blocked Users settings screen - Settings → Blocked users.
 *
 * Required by Apple Guideline 1.2: users must be able to review and undo
 * blocks. Powered by GET /users/me/blocks (auth required).
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet,
  ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { fetchMyBlocks, unblockById, type BlockRow } from '@/api/blocks';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Button, EmptyState, Screen, ScreenHeader } from '@/ui';

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
    const name  = item.display_name ?? item.target_nickname ?? t('blocked.ghostName');
    const photo = item.profile_thumb_photo_url ?? item.profile_photo_url ?? null;
    const busy  = busyIds.has(item.id);

    return (
      <View style={styles.row}>
        <Avatar uri={photo ? thumbUrl(photo) : null} name={name} size={44} fallback="color" />
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {!item.blocked_user_id && item.blocked_guest_id ? (
            <Text style={styles.subtitle}>{t('blocked.guest')}</Text>
          ) : null}
        </View>
        <Button variant="secondary" size="sm" label={t('blocked.unblock')} onPress={() => handleUnblock(item)} loading={busy} />
      </View>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('blocked.title')} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="shield-checkmark-outline" title={t('blocked.emptyTitle')} body={t('blocked.emptySub')} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
          }
        />
      )}
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg },
  listContent: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  divider:     { height: 1, backgroundColor: c.line },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  info:        { flex: 1, gap: 2 },
  name:        { fontSize: 15, fontWeight: '700', color: c.text },
  subtitle:    { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted },
});
