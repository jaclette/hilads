import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import type { ViewInstance } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { captureRef } from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import { Space, Gutter, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar, BrandMark, Button, Card, Screen, ScreenHeader } from '@/ui';
import { fetchCrew, type Crew, type CrewFriend } from '@/features/invites/invite';
import { directChannels, shareTo, type ShareChannel } from '@/features/share/targets';
import { track } from '@/services/analytics';

/**
 * "Bring your crew": the invite screen (scoring v2), opened from How it works, the
 * Passport's crew card, the reward's crew goal and the invite notifications.
 * The three steps, the share card (what a friend sees, captured as the image), a big
 * share button with WhatsApp / Zalo / Messenger / Copy link, this season's progress,
 * the friends I invited with their status, and the rules in small print. Every value
 * comes from GET /me/invite (the server's scoring config).
 */

/** The shortcuts under the big button (shown when the app is installed), then Copy link. */
const SHORTCUTS: ShareChannel[] = ['whatsapp', 'zalo', 'messenger'];
const SHORTCUT_ICON: Record<string, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  whatsapp:  { icon: 'logo-whatsapp', color: '#25D366' },
  zalo:      { icon: 'chatbubble-ellipses', color: '#0068FF' },
  messenger: { icon: 'chatbubbles', color: '#0084FF' },
  copy_link: { icon: 'link', color: '' },
};

export default function InviteScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('me');
  const { account } = useApp();
  const [crew, setCrew] = useState<Crew | null>(null);
  const [failed, setFailed] = useState(false);
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [busy, setBusy] = useState<ShareChannel | null>(null);
  const [copied, setCopied] = useState(false);
  const card = useRef<ViewInstance>(null);

  const load = useCallback(() => {
    if (!account) return;
    setFailed(false);
    fetchCrew().then(setCrew).catch(() => setFailed(true));
  }, [account]);
  useFocusEffect(load);
  useEffect(() => { track('invite_viewed', { signed_in: !!account }); }, [account]);
  useEffect(() => { directChannels().then(c => setChannels(SHORTCUTS.filter(s => c.includes(s)))).catch(() => {}); }, []);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/passport' as never));

  const share = async (channel: ShareChannel) => {
    if (!crew || busy) return;
    setBusy(channel);
    track('share_started', { content_type: 'invite', source: 'invite_screen', channel });
    try {
      // The card goes to the channels that take an image (the share sheet, Zalo); the others send the link.
      let file: string | null = null;
      if ((channel === 'share_sheet' || channel === 'zalo') && card.current) {
        file = await captureRef(card.current, { format: 'jpg', quality: 0.92, result: 'tmpfile' }).catch(() => null);
      }
      const r = await shareTo(channel, { file, url: crew.link, text: t('invite.shareLine') });
      if (r.done) track('share_completed', { content_type: 'invite', channel, activity: r.activity ?? null });
      if (channel === 'copy_link') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* cancelled */ } finally { setBusy(null); }
  };

  // Signed out: an invite link needs an account (the friend is credited to it).
  if (!account) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader title={t('invite.title')} onBack={back} testID="invite" />
        <View style={styles.center}>
          <Text style={styles.heroEmoji} accessibilityElementsHidden importantForAccessibility="no">🤝</Text>
          <Text style={styles.heroTitle}>{t('invite.signedOutTitle')}</Text>
          <Text style={styles.heroText}>{t('invite.signedOutText')}</Text>
          <Button label={t('invite.signUp')} onPress={() => router.push('/auth-gate?reason=invite&returnTo=%2Finvite' as never)} style={styles.full} />
        </View>
      </Screen>
    );
  }

  const max = crew?.max ?? 5;
  const count = crew?.count ?? 0;
  const progress = Math.min(1, count / Math.max(1, max));
  const steps = [
    { emoji: '🔗', title: t('invite.step1Title'), text: t('invite.step1Text') },
    { emoji: '📲', title: t('invite.step2Title'), text: t('invite.step2Text') },
    { emoji: '📸', title: t('invite.step3Title'), text: t('invite.step3Text'), points: crew?.points.friend ?? 10 },
  ];

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader title={t('invite.title')} onBack={back} testID="invite" />
      <ScrollView contentContainerStyle={styles.body}>
        {/* What a friend receives: the card shared as the image (same in every theme, like the photo cards). */}
        <View ref={card} collapsable={false} style={styles.shareCard} accessible accessibilityLabel={t('invite.cardA11y', { name: account.username ? '@' + account.username : account.display_name })}>
          <LinearGradient colors={['#FF8A4C', '#E2562A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={styles.cardTop}>
            <BrandMark size="sm" />
            <Text style={styles.cardBrand}>Hilads</Text>
          </View>
          <Avatar uri={account.profile_photo_url ?? null} name={account.display_name ?? account.username ?? ''} size={72} />
          <Text style={styles.cardTitle} numberOfLines={2}>
            {t('invite.cardTitle', { name: account.username ? '@' + account.username : account.display_name })}
          </Text>
          <Text style={styles.cardText}>{t('invite.cardText')}</Text>
          <View style={styles.cardLink}><Text style={styles.cardLinkText}>hilads.live</Text></View>
        </View>

        {/* This season's progress. */}
        <Card style={styles.progressCard}>
          <View style={styles.progressHead}>
            <Text style={styles.sectionSmall} accessibilityRole="header">{t('invite.progressTitle')}</Text>
            <Text style={styles.progressCount} accessibilityLabel={t('crew.a11y', { count, max })}>{t('invite.progress', { count, max })}</Text>
          </View>
          <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: crew?.bonus ? colors.gold : colors.cta }]} />
          </View>
          <Text style={styles.progressText}>
            {crew?.bonus ? t('crew.done', { points: crew.points.crew })
              : t('invite.crewLine', { count: max, points: crew?.points.crew ?? 50 })}
          </Text>
        </Card>

        {/* How it works, in three steps. */}
        <Card style={styles.steps}>
          {steps.map((s, i) => (
            <View key={s.title} style={styles.step} accessible accessibilityLabel={`${i + 1}. ${s.title}. ${s.text}${s.points ? `. +${s.points}` : ''}`}>
              <View style={styles.rail}>
                <View style={styles.dot}><Text style={styles.dotEmoji}>{s.emoji}</Text></View>
                {i < steps.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.stepBody}>
                <View style={styles.stepHead}>
                  <Text style={styles.stepTitle}>{s.title}</Text>
                  {!!s.points && <View style={styles.pill}><Text style={styles.pillText}>+{s.points}</Text></View>}
                </View>
                <Text style={styles.stepText}>{s.text}</Text>
              </View>
            </View>
          ))}
          <View style={styles.bonus} accessible>
            <Text style={styles.bonusText}>🎉 {t('invite.bonus', { count: max, points: crew?.points.crew ?? 50 })}</Text>
          </View>
        </Card>

        {/* The friends I invited, with where they are. */}
        <Text style={styles.section} accessibilityRole="header">{t('invite.friendsTitle')}</Text>
        {!crew && !failed && <ActivityIndicator color={colors.muted} style={{ marginVertical: Space.lg }} />}
        {failed && (
          <Card style={styles.empty}>
            <Text style={styles.emptyText}>{t('invite.error')}</Text>
            <Button variant="secondary" size="sm" label={t('invite.retry')} onPress={load} />
          </Card>
        )}
        {crew && (
          <Card style={styles.friends}>
            {(crew.clicks ?? 0) > 0 && (
              <View style={styles.friendRow} accessible>
                <View style={styles.clickIcon}><Ionicons name="eye-outline" size={IconSize.md} color={colors.muted} /></View>
                <Text style={styles.friendName}>{t('invite.clicks', { count: crew.clicks })}</Text>
              </View>
            )}
            {crew.friends.length === 0 ? (
              <Text style={styles.emptyText}>{t('invite.noFriends')}</Text>
            ) : crew.friends.map(f => <FriendRow key={f.id} friend={f} points={crew.points.friend} />)}
          </Card>
        )}

        {/* The rules. */}
        <Text style={styles.small}>
          {t('invite.rules', { count: crew?.perSeason ?? max })}
        </Text>
      </ScrollView>

      {/* Always in reach: the big share button and the shortcuts. */}
      <View style={styles.footer}>
        <View style={styles.shortcuts}>
          {[...channels, 'copy_link' as ShareChannel].map(c => (
            <Pressable key={c} onPress={() => share(c)} disabled={!crew || !!busy} style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.6 }]}
                       accessibilityRole="button" accessibilityLabel={t(`invite.channel.${c}`)} testID={`invite-${c}`}>
              <View style={[styles.shortcutIcon, { backgroundColor: SHORTCUT_ICON[c].color || colors.bg3 }]}>
                {busy === c ? <ActivityIndicator color={colors.white} size="small" />
                  : <Ionicons name={c === 'copy_link' && copied ? 'checkmark' : SHORTCUT_ICON[c].icon} size={22} color={SHORTCUT_ICON[c].color ? '#FFFFFF' : colors.text} />}
              </View>
              <Text style={styles.shortcutLabel} numberOfLines={1}>{c === 'copy_link' && copied ? t('invite.copied') : t(`invite.channel.${c}`)}</Text>
            </Pressable>
          ))}
        </View>
        <Button icon="share-outline" label={t('invite.share')} onPress={() => share('share_sheet')} loading={busy === 'share_sheet'} disabled={!crew} testID="invite-share" />
      </View>
    </Screen>
  );
}

/** One invited friend: avatar, name, and where they are (joined, played, +10). */
function FriendRow({ friend: f, points }: { friend: CrewFriend; points: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('me');
  const status = f.status ?? (f.credited ? 'credited' : 'joined');
  const label = status === 'credited' ? t('invite.status.credited', { points })
    : status === 'played' ? t('invite.status.played') : t('invite.status.joined');
  const name = f.username ? '@' + f.username : f.displayName ?? '';
  return (
    <Pressable style={styles.friendRow} onPress={() => router.push({ pathname: '/user/[id]', params: { id: f.id } })}
               accessibilityRole="button" accessibilityLabel={`${name}, ${label}`}>
      <Avatar uri={f.photoUrl} name={f.displayName ?? f.username ?? ''} size={40} />
      <View style={styles.friendBody}>
        <Text style={styles.friendName} numberOfLines={1}>{name}</Text>
        <Text style={[styles.friendStatus, status === 'credited' && { color: colors.green }]} numberOfLines={2}>{label}</Text>
      </View>
      {status === 'credited' && <Text style={styles.check}>✅</Text>}
      <Ionicons name="chevron-forward" size={IconSize.sm} color={colors.muted} />
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  body:         { paddingHorizontal: Gutter, paddingBottom: Space.xl, gap: Space.md },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Gutter, gap: Space.md },
  full:         { alignSelf: 'stretch' },
  heroEmoji:    { fontSize: 48, lineHeight: 58 },
  heroTitle:    { ...Type.title, color: c.text, textAlign: 'center' },
  heroText:     { ...Type.body, color: c.muted, textAlign: 'center' },
  shareCard:    { marginTop: Space.sm, borderRadius: Radius.card, overflow: 'hidden', alignItems: 'center', padding: Space.lg, gap: Space.sm },
  cardTop:      { flexDirection: 'row', alignItems: 'center', gap: Space.xs, alignSelf: 'flex-start' },
  cardBrand:    { ...Type.label, fontWeight: '900', color: '#FFFFFF' },
  cardTitle:    { ...Type.title, color: '#FFFFFF', textAlign: 'center' },
  cardText:     { ...Type.body, color: '#FFF3EA', textAlign: 'center' },
  cardLink:     { marginTop: Space.xs, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: Radius.control, paddingHorizontal: Space.md, paddingVertical: Space.xs },
  cardLinkText: { ...Type.caption, fontWeight: '900', color: '#C24E1C' },
  progressCard: { padding: Space.md, gap: Space.sm },
  progressHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.sm },
  progressCount:{ ...Type.label, fontWeight: '900', color: c.text },
  progressText: { ...Type.caption, color: c.muted },
  bar:          { height: 10, borderRadius: 5, backgroundColor: c.bg3, overflow: 'hidden' },
  barFill:      { height: '100%', borderRadius: 5 },
  sectionSmall: { ...Type.label, color: c.text },
  section:      { ...Type.title, color: c.text, marginTop: Space.sm },
  steps:        { padding: Space.md },
  step:         { flexDirection: 'row', gap: Space.md },
  rail:         { alignItems: 'center', width: 44 },
  dot:          { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  dotEmoji:     { fontSize: 20, lineHeight: 26 },
  line:         { flex: 1, width: 2, minHeight: Space.md, backgroundColor: c.line, marginVertical: Space.xxs },
  stepBody:     { flex: 1, gap: Space.xxs, paddingBottom: Space.md, paddingTop: Space.xs },
  stepHead:     { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  stepTitle:    { ...Type.label, color: c.text, flexShrink: 1 },
  stepText:     { ...Type.body, color: c.muted },
  pill:         { paddingHorizontal: Space.sm, minHeight: 26, borderRadius: Radius.control, backgroundColor: c.primaryTint, justifyContent: 'center' },
  pillText:     { ...Type.caption, fontWeight: '900', color: c.primaryOnTint },
  bonus:        { backgroundColor: c.goldTint, borderRadius: Radius.control, paddingHorizontal: Space.md, paddingVertical: Space.sm },
  bonusText:    { ...Type.caption, fontWeight: '800', color: c.text, textAlign: 'center' },
  friends:      { paddingHorizontal: Space.md, paddingVertical: Space.xs },
  friendRow:    { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.xs },
  clickIcon:    { width: 40, height: 40, borderRadius: 20, backgroundColor: c.bg3, alignItems: 'center', justifyContent: 'center' },
  friendBody:   { flex: 1 },
  friendName:   { ...Type.label, color: c.text, flexShrink: 1 },
  friendStatus: { ...Type.caption, color: c.muted },
  check:        { fontSize: 18 },
  empty:        { padding: Space.md, gap: Space.sm, alignItems: 'center' },
  emptyText:    { ...Type.body, color: c.muted, textAlign: 'center', paddingVertical: Space.md },
  small:        { ...Type.caption, color: c.muted, textAlign: 'center', marginTop: Space.sm },
  footer:       { paddingHorizontal: Gutter, paddingTop: Space.sm, paddingBottom: Space.sm, gap: Space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line, backgroundColor: c.bg },
  shortcuts:    { flexDirection: 'row', justifyContent: 'center', gap: Space.lg },
  shortcut:     { alignItems: 'center', gap: Space.xxs, minWidth: 64 },
  shortcutIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  shortcutLabel:{ ...Type.caption, color: c.text },
});
