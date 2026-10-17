import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { fetchUserFriends, fetchUserVibes, type UserVibe } from '@/api/users';
import { fetchIncomingFriendRequestCount } from '@/api/friendRequests';
import { thumbUrl } from '@/lib/imageThumb';
import { avatarColor } from '@/lib/avatarColors';
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

  const Avatar = ({ name, photo }: { name: string; photo?: string | null }) => photo
    ? <Image source={{ uri: thumbUrl(photo) }} style={styles.avatar} contentFit="cover" />
    : <View style={[styles.avatar, { backgroundColor: avatarColor(name) }]}><Text style={styles.initial}>{(name || '?')[0].toUpperCase()}</Text></View>;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back', { ns: 'common' })}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('tabFriends')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <TouchableOpacity style={styles.row} onPress={() => router.push('/friend-requests' as never)} accessibilityRole="button">
          <Ionicons name="person-add-outline" size={20} color={colors.primaryText} />
          <Text style={styles.rowLabel}>{t('friendRequests')}</Text>
          {requests > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{requests > 9 ? '9+' : requests}</Text></View>}
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </TouchableOpacity>

        <Text style={styles.section}>{t('myFriends')}</Text>
        <View style={styles.card}>
          {friends === null ? <ActivityIndicator color={colors.primary} style={styles.pad} />
            : friends.length === 0 ? <Text style={styles.empty}>{t('noFriends')}</Text>
            : friends.map((f, i) => (
              <TouchableOpacity key={f.id} style={[styles.person, i > 0 && styles.divider]} accessibilityRole="button"
                                onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id, name: f.displayName } } as never)}>
                <Avatar name={f.displayName} photo={f.thumbAvatarUrl ?? f.avatarUrl} />
                <Text style={styles.name} numberOfLines={1}>{f.displayName}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </TouchableOpacity>
            ))}
        </View>

        <Text style={styles.section}>{t('vibesReceived')}</Text>
        <View style={styles.card}>
          {vibes === null ? <ActivityIndicator color={colors.primary} style={styles.pad} /> : (
            <>
              {vibes.count > 0 && (
                <View style={styles.score}>
                  <Text style={styles.stars}>{'★'.repeat(Math.round(vibes.score ?? 0))}<Text style={styles.starsOff}>{'★'.repeat(5 - Math.round(vibes.score ?? 0))}</Text></Text>
                  <Text style={styles.scoreText}>{t('vibeScore', { score: vibes.score?.toFixed(1) })} · {t('vibeBasis', { count: vibes.count })}</Text>
                </View>
              )}
              {vibes.items.length === 0 ? (
                <Text style={styles.empty}>{t('noVibes')}{'\n'}{t('noVibesSub')}</Text>
              ) : vibes.items.map((v, i) => (
                <View key={v.id} style={[styles.person, (i > 0 || vibes.count > 0) && styles.divider]}>
                  <Avatar name={v.authorName} photo={v.authorPhoto} />
                  <View style={styles.vibeBody}>
                    <Text style={styles.name} numberOfLines={1}>{v.authorName} <Text style={styles.vibeStars}>{'★'.repeat(v.rating)}</Text></Text>
                    {!!v.message && <Text style={styles.vibeMsg}>{v.message}</Text>}
                  </View>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  nav:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  back:      { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, alignItems: 'center', justifyContent: 'center' },
  title:     { flex: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  body:      { padding: Spacing.md, gap: 10, paddingBottom: Spacing.xl },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  rowLabel:  { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  badge:     { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: c.white, fontSize: 12, fontWeight: '800' },
  section:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginTop: 8 },
  card:      { borderRadius: 18, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2, overflow: 'hidden' },
  pad:       { paddingVertical: Spacing.md },
  empty:     { fontSize: FontSizes.sm, color: c.muted, padding: 14, textAlign: 'center' },
  person:    { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8 },
  divider:   { borderTopWidth: 1, borderTopColor: c.line },
  avatar:    { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  initial:   { color: '#fff', fontSize: FontSizes.sm, fontWeight: '800' },
  name:      { flex: 1, fontSize: 15, fontWeight: '700', color: c.text },
  score:     { alignItems: 'center', gap: 4, padding: 14 },
  stars:     { fontSize: 22, color: c.gold },
  starsOff:  { color: c.line },
  scoreText: { fontSize: FontSizes.xs, color: c.muted },
  vibeBody:  { flex: 1, gap: 2 },
  vibeStars: { fontSize: FontSizes.xs, color: c.gold },
  vibeMsg:   { fontSize: FontSizes.sm, color: c.text },
});
