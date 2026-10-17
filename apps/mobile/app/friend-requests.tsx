import { thumbUrl } from '@/lib/imageThumb';
/**
 * Friend Requests inbox - Incoming + Sent tabs.
 *
 * Wired to useFriendRequests, which loads both lists on mount and keeps them
 * in sync with the server via per-user WS events. Mutations are optimistic;
 * the hook rolls back + alerts on server error.
 */

import { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { canAccessProfile } from '@/lib/profileAccess';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Avatar, Button, EmptyState, Screen, ScreenHeader, Segmented } from '@/ui';
import type { FriendRequest } from '@/types';

type Tab = 'incoming' | 'sent';

export default function FriendRequestsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const router = useRouter();
  const { t } = useTranslation('misc');
  const { account } = useApp();
  const [tab, setTab] = useState<Tab>('incoming');
  const { incoming, outgoing, loading, accept, decline, cancel } = useFriendRequests();

  const data = useMemo(() => (tab === 'incoming' ? incoming : outgoing), [tab, incoming, outgoing]);

  function handleOpenProfile(req: FriendRequest) {
    if (!req.other_user_id || !canAccessProfile(account)) return;
    router.push(`/user/${req.other_user_id}` as never);
  }

  function renderRow({ item }: { item: FriendRequest }) {
    const name = item.other_display_name ?? '?';
    return (
      <TouchableOpacity style={styles.row} activeOpacity={0.85} onPress={() => handleOpenProfile(item)} accessibilityRole="button">
        <Avatar uri={item.other_photo_url ? thumbUrl(item.other_photo_url) : null} name={name} size={44} fallback="color" />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {tab === 'incoming' ? t('friendReq.wantsToBeFriend') : t('friendReq.requestSent')}
          </Text>
        </View>
        {tab === 'incoming' ? (
          <View style={styles.actions}>
            <Button variant="secondary" size="sm" label={t('friendReq.decline')} onPress={() => decline(item.id)} />
            <Button size="sm" label={t('friendReq.accept')} onPress={() => accept(item.id)} />
          </View>
        ) : (
          <Button variant="secondary" size="sm" label={t('friendReq.cancel')} onPress={() => cancel(item.id)} />
        )}
      </TouchableOpacity>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('friendReq.title')} />

      <View style={styles.tabs}>
        <Segmented
          options={[
            { key: 'incoming' as const, label: `${t('friendReq.incoming')}${incoming.length > 0 ? ` · ${incoming.length}` : ''}` },
            { key: 'sent' as const, label: `${t('friendReq.sent')}${outgoing.length > 0 ? ` · ${outgoing.length}` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon={tab === 'incoming' ? 'person-add-outline' : 'paper-plane-outline'}
            title={tab === 'incoming' ? t('friendReq.emptyIncomingTitle') : t('friendReq.emptySentTitle')}
            body={tab === 'incoming' ? t('friendReq.emptyIncomingSub') : t('friendReq.emptySentSub')}
          />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(r) => r.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  tabs:        { paddingHorizontal: Spacing.md, paddingTop: 4, paddingBottom: 8 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  listContent: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xl },
  separator:   { height: 1, backgroundColor: c.line },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  body:        { flex: 1, minWidth: 0 },
  name:        { fontSize: 15, fontWeight: '700', color: c.text },
  sub:         { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, marginTop: 2 },
  actions:     { flexDirection: 'row', gap: 8 },
});
