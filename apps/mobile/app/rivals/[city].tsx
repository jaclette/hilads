import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Screen, ScreenHeader, Avatar } from '@/ui';
import { Confetti, FlagSticker, themeColor, tint } from '@/ui/joy';
import { shortCityName } from '@/i18n/cityName';
import { thumbUrl } from '@/lib/imageThumb';
import { handOffList } from '@/lib/prefetch';
import { track } from '@/services/analytics';
import { useDailyToday } from '@/hooks/useDaily';
import { fetchRivalFaceoff, type RivalDuel, type RivalFaceoff } from '@/api/daily';
import { themeName } from '@/features/daily/themes';
import { ShareSheet } from '@/features/share/ShareSheet';
import { representShare, type ShareContent } from '@/features/share/content';
import { CountUp } from '@/features/ranks/parts';
import type { DailyProof } from '@/types';

/**
 * A face-off (V6, Passport › Your rivals): "Saigon vs Berlin". Both flags with
 * a VS badge and the score (a duel is won by the photo with more likes), a
 * playful "send them a challenge" card when that city hasn't played today, then
 * every shared challenge, newest first: my photo vs their best, the winner
 * crowned. Replaces the dead-end "Berlin hasn't played yet" screen.
 */
export default function RivalScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, city: myCity } = useApp();
  const { city: cityParam, user } = useLocalSearchParams<{ city: string; user?: string }>();
  const today = useDailyToday(myCity?.channelId).data;
  const [data, setData] = useState<RivalFaceoff | null>(null);
  const [failed, setFailed] = useState(false);
  const [share, setShare] = useState<ShareContent | null>(null);
  const [party, setParty] = useState(false);
  const userId = user ?? account?.id ?? null;

  useEffect(() => {
    if (!userId || !cityParam) return;
    fetchRivalFaceoff(userId, Number(cityParam)).then(d => {
      setData(d);
      track('rivals_opened', { city: d.city.name, duels: d.duels.length });
      if (d.score.me > d.score.them) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setParty(true);
        setTimeout(() => setParty(false), 1800);
      }
    }).catch(() => setFailed(true));
  }, [userId, cityParam]);

  const rival = data ? shortCityName(data.city.name) : '';
  const me = data?.score.me ?? 0;
  const them = data?.score.them ?? 0;
  const mood = me > them ? t('rivals.leading') : me < them ? t('rivals.behind', { city: rival }) : t('rivals.tied');

  const open = (duel: RivalDuel, p: DailyProof) => {
    const key = `rival-${Date.now()}`;
    handOffList(key, [duel.mine, duel.theirs]);
    router.push(`/daily/photos?list=${key}&proof=${p.id}&source=rivals` as never);
  };

  const head = data && (
    <View>
      {/* Both flags facing each other, VS between them, the score counting up. */}
      <View style={styles.versus}>
        <View style={styles.side}>
          {account ? <Avatar uri={account.thumbAvatarUrl ?? account.profile_photo_url ?? null} name={account.display_name ?? ''} size={64} />
            : <FlagSticker country={myCity?.country} size={64} />}
          <Text style={styles.sideName} numberOfLines={1}>{t('rivals.you')}</Text>
          {me > them && <Text style={styles.trophy}>🏆</Text>}
        </View>
        <View style={styles.vsCol}>
          <View style={styles.vs}><Text style={styles.vsText}>VS</Text></View>
          <View style={styles.score}>
            <CountUp value={me} style={styles.scoreNum} />
            <Text style={styles.scoreDash}>–</Text>
            <CountUp value={them} style={styles.scoreNum} />
          </View>
        </View>
        <View style={styles.side}>
          <FlagSticker country={data.city.country} size={64} />
          <Text style={styles.sideName} numberOfLines={1}>{rival}</Text>
          {them > me && <Text style={styles.trophy}>🏆</Text>}
        </View>
      </View>
      <Text style={styles.mood}>{mood}</Text>

      {!data.playedToday && today?.challenge?.isActive && (
        <View style={[styles.nudge, { backgroundColor: tint(themeColor('get_around').fill, 0.18) }]}>
          <Text style={styles.nudgeText}>{t('rivals.notToday', { city: rival })}</Text>
          <Pressable style={styles.nudgeBtn} accessibilityRole="button" testID="rival-send"
                     onPress={() => {
                       track('rival_challenge_shared', { city: data.city.name });
                       setShare(representShare(today.challenge!, { name: data.city.name, country: data.city.country }));
                     }}>
            <Text style={styles.nudgeBtnText}>📣 {t('rivals.send')}</Text>
          </Pressable>
        </View>
      )}
      {data.duels.length > 0 && <Text style={styles.section}>{t('rivals.duels', { count: data.duels.length })}</Text>}
    </View>
  );

  return (
    <Screen>
      <ScreenHeader title={data ? t('rivals.title', { city: rival }) : ''} testID="rival-screen" />
      {!data ? (
        <View style={styles.center}>{failed ? <Text style={styles.mood}>{t('loadFailed')}</Text> : <ActivityIndicator color={colors.primary} />}</View>
      ) : (
        <FlatList
          data={data.duels}
          keyExtractor={d => d.date}
          ListHeaderComponent={head ?? undefined}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t('rivals.empty', { city: rival })}</Text>}
          renderItem={({ item: d }) => (
            <View style={styles.duel}>
              <View style={styles.duelHead}>
                <Text style={styles.duelText} numberOfLines={2}>{d.challenge.text}</Text>
                {!!d.challenge.theme && (
                  <View style={[styles.themeChip, { backgroundColor: tint(themeColor(d.challenge.theme).fill, 0.25) }]}>
                    <Text style={styles.themeText}>{themeName(d.challenge.theme as never)}</Text>
                  </View>
                )}
              </View>
              <View style={styles.pair}>
                <DuelPhoto proof={d.mine} label={t('rivals.yours')} win={d.winner === 'me'} onPress={() => open(d, d.mine)} />
                <DuelPhoto proof={d.theirs} label={t('rivals.theirBest', { city: rival })} win={d.winner === 'them'} onPress={() => open(d, d.theirs)} />
              </View>
            </View>
          )}
        />
      )}
      <Confetti run={party} count={36} />
      <ShareSheet content={share} source="rivals" onClose={() => setShare(null)} />
    </Screen>
  );
}

function DuelPhoto({ proof, label, win, onPress }: { proof: DailyProof; label: string; win: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable style={[styles.photoBox, win && styles.photoWin]} onPress={onPress} accessibilityRole="button"
               accessibilityLabel={`${label}, ${proof.voteCount} ❤️${win ? ', 👑' : ''}`}>
      <Image source={{ uri: thumbUrl(proof.thumbUrl ?? proof.photoUrl) ?? undefined }} style={styles.photo} contentFit="cover" />
      {win && <Text style={styles.crown}>👑</Text>}
      <View style={styles.photoFoot}>
        <Text style={styles.photoLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.photoLikes}>{proof.voteCount} ❤️</Text>
      </View>
    </Pressable>
  );
}

const GOLD = themeColor('sip').fill;
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:         { padding: Spacing.md, paddingBottom: Spacing.xl, gap: 14 },
  versus:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  side:         { flex: 1, alignItems: 'center', gap: 6 },
  sideName:     { fontSize: 16, fontWeight: '800', color: c.text, maxWidth: '100%' },
  trophy:       { fontSize: 20 },
  vsCol:        { alignItems: 'center', gap: 8 },
  vs:           { width: 48, height: 48, borderRadius: 24, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  vsText:       { fontSize: 18, fontWeight: '900', color: c.onCta },
  score:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scoreNum:     { fontSize: 30, lineHeight: 36, fontWeight: '900', color: c.text },
  scoreDash:    { fontSize: 24, fontWeight: '800', color: c.muted },
  mood:         { fontSize: 15, lineHeight: 20, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 12 },
  nudge:        { borderRadius: Radius.card, padding: 14, gap: 10, marginBottom: 14 },
  nudgeText:    { fontSize: 15, lineHeight: 20, fontWeight: '700', color: c.text },
  nudgeBtn:     { alignSelf: 'flex-start', paddingHorizontal: 16, height: 40, borderRadius: Radius.full, backgroundColor: c.cta, justifyContent: 'center' },
  nudgeBtnText: { fontSize: 14, fontWeight: '800', color: c.onCta },
  section:      { fontSize: 13, fontWeight: '800', color: c.muted, marginBottom: 4 },
  empty:        { fontSize: 15, color: c.muted, textAlign: 'center', paddingVertical: 32 },
  duel:         { borderRadius: Radius.card, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, padding: 12, gap: 10 },
  duelHead:     { gap: 6 },
  duelText:     { fontSize: 15, lineHeight: 20, fontWeight: '800', color: c.text },
  themeChip:    { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  themeText:    { fontSize: 12, fontWeight: '700', color: c.text },
  pair:         { flexDirection: 'row', gap: 10 },
  photoBox:     { flex: 1, borderRadius: 14, overflow: 'hidden', borderWidth: 3, borderColor: 'transparent', backgroundColor: c.bg3 },
  photoWin:     { borderColor: GOLD },
  photo:        { width: '100%', aspectRatio: 1 },
  crown:        { position: 'absolute', top: 6, right: 8, fontSize: 22 },
  photoFoot:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 6, backgroundColor: c.bg2 },
  photoLabel:   { flex: 1, fontSize: 12, fontWeight: '700', color: c.muted },
  photoLikes:   { fontSize: 13, fontWeight: '800', color: c.text },
});
