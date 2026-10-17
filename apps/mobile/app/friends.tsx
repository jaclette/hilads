import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { Avatar, EmptyState, ListRow, RowGroup, ScreenHeader, SectionTitle } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchUserFriends, fetchUserVibes, type UserVibe } from '@/api/users';
import { fetchIncomingFriendRequestCount } from '@/api/friendRequests';
import { thumbUrl } from '@/lib/imageThumb';
import { socket } from '@/lib/socket';
import type { UserDTO } from '@/types';

/**
 * Friends (V3-10, from Passport): the friend requests inbox, my friends and
 * the vibes I received (the former profile Friends and Vibes tabs).
 */
export default function FriendsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('me');
  const router = useRouter();
  const { account } = useApp();
  const [friends, setFriends]   = useState<UserDTO[] | null>(null);
  const [requests, setRequests] = useState(0);
  const [vibes, setVibes]       = useState<{ items: UserVibe[]; score: number | null; count: number } | null>(null);

  useEffect(() => {
    if (!account) { router.replace('/auth-gate?reason=view_profile&returnTo=%2Ffriends' as never); return; }
    fetchUserFriends(account.id, 1, 100).then(d => setFriends(d.friends)).catch(() => setFriends([]));
    fetchIncomingFriendRequestCount().then(setRequests).catch(() => {});
    fetchUserVibes(account.id).then(d => setVibes({ items: d.vibes ?? [], score: d.score, count: d.count ?? 0 })).catch(() => setVibes({ items: [], score: null, count: 0 }));
    const offReceived  = socket.on('friendRequestReceived',  () => setRequests(c => c + 1));
    const offCancelled = socket.on('friendRequestCancelled', () => setRequests(c => Math.max(0, c - 1)));
    return () => { offReceived(); offCancelled(); };
  }, [account, router]);

  const avatar = (name: string, photo?: string | null) => <Avatar uri={photo ? thumbUrl(photo) : null} name={name} size={36} fallback="color" />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={t('tabFriends')} />
      <ScrollView contentContainerStyle={styles.body}>
        <ListRow icon="person-add-outline" title={t('friendRequests')} badge={requests} onPress={() => router.push('/friend-requests' as never)}
                 style={styles.requests} />

        <SectionTitle title={t('myFriends')} style={styles.section} />
        <RowGroup>
          {friends === null ? <ActivityIndicator color={colors.primary} style={styles.pad} />
            : friends.length === 0 ? <EmptyState body={t('noFriends')} />
            : friends.map((f, i) => (
              <ListRow key={f.id} divider={i > 0} style={styles.person} leading={avatar(f.displayName, f.thumbAvatarUrl ?? f.avatarUrl)} title={f.displayName}
                       onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id, name: f.displayName } } as never)} />
            ))}
        </RowGroup>

        <SectionTitle title={t('vibesReceived')} style={styles.section} />
        <RowGroup>
          {vibes === null ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : (
            <>
              {vibes.count > 0 && (
                <View style={styles.score}>
                  <Text style={styles.stars}>{'★'.repeat(Math.round(vibes.score ?? 0))}<Text style={styles.starsOff}>{'★'.repeat(5 - Math.round(vibes.score ?? 0))}</Text></Text>
                  <Text style={styles.scoreText}>{t('vibeScore', { score: vibes.score?.toFixed(1) })} · {t('vibeBasis', { count: vibes.count })}</Text>
                </View>
              )}
              {vibes.items.length === 0 ? (
                <EmptyState body={`${t('noVibes')}\n${t('noVibesSub')}`} />
              ) : vibes.items.map((v, i) => (
                <View key={v.id} style={[styles.vibeRow, (i > 0 || vibes.count > 0) && styles.divider]}>
                  {avatar(v.authorName, v.authorPhoto)}
                  <View style={styles.vibeBody}>
                    <Text style={styles.name} numberOfLines={1}>{v.authorName} <Text style={styles.vibeStars}>{'★'.repeat(v.rating)}</Text></Text>
                    {!!v.message && <Text style={styles.vibeMsg}>{v.message}</Text>}
                  </View>
                </View>
              ))}
            </>
          )}
        </RowGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  body:      { padding: Spacing.md, gap: 10, paddingBottom: Spacing.xl },
  requests:  { borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  section:   { marginTop: 8 },
  pad:       { paddingVertical: Spacing.md },
  person:    { minHeight: 56, paddingVertical: 8 },
  vibeRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8 },
  divider:   { borderTopWidth: 1, borderTopColor: c.line },
  name:      { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  score:     { alignItems: 'center', gap: 4, padding: 14 },
  stars:     { fontSize: 22, color: c.gold },
  starsOff:  { color: c.line },
  scoreText: { fontSize: FontSizes.xs, color: c.muted },
  vibeBody:  { flex: 1, gap: 2 },
  vibeStars: { fontSize: FontSizes.xs, color: c.gold },
  vibeMsg:   { fontSize: FontSizes.sm, color: c.text },
});
