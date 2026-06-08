/**
 * DM conversation screen - redesigned for Hilads visual identity.
 *
 * Two open modes (set by route params):
 *   Notification:  conv param present → open existing conversation by conversationId directly
 *   Profile flow:  no conv param → id is a userId, call findOrCreateDM to resolve thread
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, Pressable,
  ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
  Animated, Alert, Linking, InteractionManager, Keyboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { EmojiPanel } from '@/features/chat/EmojiPanel';
import { ShareSheet } from '@/features/chat/ShareSheet';
import { LocationPicker } from '@/features/chat/LocationPicker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useDMThread } from '@/hooks/useDMThread';
import { findOrCreateDM, toggleDmReaction, fetchConversations } from '@/api/conversations';
import { submitBlock } from '@/api/blocks';
import { useApp } from '@/context/AppContext';
import { ProfileActionSheet } from '@/features/profile/ProfileActionSheet';
import { canAccessProfile } from '@/lib/profileAccess';
import { track } from '@/services/analytics';
import { linkifyText, extractFirstUrl } from '@/lib/linkify';
import { LinkPreviewCard } from '@/features/chat/LinkPreviewCard';
import * as Clipboard from 'expo-clipboard';
import { Colors, FontSizes, Spacing, Radius, Gradients } from '@/constants';
import { avatarColor } from '@/lib/avatarColors';
import { isSameDay, formatDateLabel, formatSmartTime } from '@/lib/messageTime';
import { ImagePreviewModal } from '@/features/chat/ImagePreviewModal';
import { MessageActionSheet } from '@/features/chat/MessageActionSheet';
import { MessageImage } from '@/features/chat/MessageImage';
import { ReactionPills } from '@/features/chat/ReactionPills';
import { ReactionBurstOverlay } from '@/features/chat/ReactionBurstOverlay';
import { reactionEmitter, EMOJI_TO_TYPE } from '@/lib/reactionEmitter';
import type { DmMessage, ReplyRef } from '@/types';

// ── Date separator - reused from ChatMessage visual style ─────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <View style={sepStyles.row}>
      <View style={sepStyles.line} />
      <Text style={sepStyles.text}>{label}</Text>
      <View style={sepStyles.line} />
    </View>
  );
}

const sepStyles = StyleSheet.create({
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    marginVertical:    18,
    paddingHorizontal: 16,
    gap:               10,
  },
  line: {
    flex:            1,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  text: {
    fontSize:          FontSizes.xs,  // 13 - was 11 (Apple G4 floor)
    fontWeight:        '600',
    color:             Colors.muted2,
    letterSpacing:     0.5,
    textTransform:     'uppercase',
    backgroundColor:   Colors.bg2,
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      999,
    overflow:          'hidden',
  },
});

// ── Message row ───────────────────────────────────────────────────────────────
// In a 1:1 DM sender names are omitted - position (left/right) makes it obvious.
// Grouping: consecutive messages from the same sender are visually clustered.
//   isFirst = oldest in the group (top of cluster)
//   isLast  = newest in the group (bottom of cluster, shows timestamp)

interface RowProps {
  msg:                DmMessage;
  isMine:             boolean;
  isFirst:            boolean;   // first (oldest) msg in this sender's run
  isLast:             boolean;   // last  (newest) msg in this sender's run
  color:              string;    // avatar accent color for received messages
  initial:            string;
  dateLabel?:         string;    // if set, render a date separator above this row
  onImagePress:       (uri: string) => void;
  onLongPress?:       (msg: DmMessage) => void;
  onReplyQuotePress?: (replyToId: string) => void;
  isHighlighted?:     boolean;
  onReact?:           (msg: DmMessage, emoji: string) => void;
}

function parseDmLocation(content: string): { line1: string; place: string; lat?: number; lng?: number; addr: string } {
  const parts = content.split('\n');
  const line1 = parts[0] ?? '';
  // Extract the place name from "📍 nick is at Place" - the part after " is at "
  const isAtIdx = line1.indexOf(' is at ');
  const place = isAtIdx !== -1 ? line1.slice(isAtIdx + 7).trim() : '';
  if (parts.length >= 2) {
    const coordParts = (parts[1] ?? '').split(',');
    const lat = parseFloat(coordParts[0] ?? '');
    const lng = parseFloat(coordParts[1] ?? '');
    if (!isNaN(lat) && !isNaN(lng) && coordParts.length === 2) {
      return { line1, place, lat, lng, addr: parts.slice(2).join('\n') };
    }
  }
  return { line1, place, addr: parts.slice(1).join('\n') };
}

function openMaps(lat: number, lng: number, label: string) {
  const encoded = encodeURIComponent(label);
  const url = Platform.OS === 'ios'
    ? `maps://?ll=${lat},${lng}&q=${encoded}`
    : `geo:${lat},${lng}?q=${encoded}`;
  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
  });
}

function DmLocationBubble({ content, isMine }: { content: string; isMine: boolean }) {
  const { t } = useTranslation('chat');
  const { line1, place, lat, lng, addr } = parseDmLocation(content);
  const hasCoords = lat !== undefined && lng !== undefined;
  // Outgoing bubble matches web .loc-bubble--me - 135° accent → accent2 gradient.
  const innerContent = (
    <>
      <Text style={dmLocStyles.icon}>📍</Text>
      <View style={dmLocStyles.body}>
        <Text style={[dmLocStyles.line1, isMine && dmLocStyles.textMine]} numberOfLines={2}>
          {line1.replace('📍 ', '')}
        </Text>
        {!!addr && <Text style={[dmLocStyles.addr, isMine && dmLocStyles.addrMine]} numberOfLines={2}>{addr}</Text>}
        {hasCoords && <Text style={[dmLocStyles.tapHint, isMine && dmLocStyles.tapHintMine]}>{t('tapMaps')}</Text>}
      </View>
    </>
  );
  const card = isMine ? (
    <LinearGradient
      colors={Gradients.primary.colors}
      start={Gradients.primary.start}
      end={Gradients.primary.end}
      style={[dmLocStyles.card, dmLocStyles.cardMine]}
    >
      {innerContent}
    </LinearGradient>
  ) : (
    <View style={[dmLocStyles.card, dmLocStyles.cardOther]}>
      {innerContent}
    </View>
  );
  if (hasCoords) {
    // Use place name or address as the map label - never the social display wording ("nick is at ...")
    const mapLabel = place || addr;
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={() => openMaps(lat!, lng!, mapLabel)}>
        {card}
      </TouchableOpacity>
    );
  }
  return card;
}

const dmLocStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           10,
    borderRadius:  22,
    padding:       14,
    // minWidth required: parent bubble row shrinks children to content-width in
    // React Native yoga; without a concrete width, flex:1 on body collapses to 0.
    minWidth:      190,
    maxWidth:      260,
  },
  cardOther: {
    backgroundColor: Colors.bg3,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
    borderBottomLeftRadius: 5,
  },
  cardMine: {
    // Background is the LinearGradient itself; this style only shapes the
    // bottom-right "tail" corner.
    borderBottomRightRadius: 5,
  },
  icon:     { fontSize: 20, lineHeight: 26, flexShrink: 0 },
  body:     { flex: 1, flexShrink: 1, minWidth: 0, gap: 3 },
  line1:       { fontSize: 14, fontWeight: '700', color: Colors.text, lineHeight: 20 },
  addr:        { fontSize: 12, color: Colors.muted2, lineHeight: 17 },
  textMine:    { color: '#fff' },
  addrMine:    { color: 'rgba(255,255,255,0.65)' },
  tapHint:     { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 2 },
  tapHintMine: { color: 'rgba(255,255,255,0.65)' },
});

function DmRow({ msg, isMine, isFirst, isLast, color, initial, dateLabel, onImagePress, onLongPress, onReplyQuotePress, isHighlighted, onReact }: RowProps) {
  const router = useRouter();
  const { t } = useTranslation('dm');
  const { account } = useApp();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;
  const highlightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (!isHighlighted) return;
    highlightAnim.setValue(0.22);
    Animated.timing(highlightAnim, { toValue: 0, duration: 1400, useNativeDriver: false }).start();
  }, [isHighlighted]);

  const isSending = msg.status === 'sending';
  const isFailed  = msg.status === 'failed';

  // Bubble shape: the "tail" corner is only on the first message of each group.
  // Mine (right): bottom-right corner flattened on first.
  // Theirs (left): bottom-left corner flattened on first.
  const bubbleMineShape  = isFirst ? styles.bubbleMineFirst  : undefined;
  const bubbleOtherShape = isFirst ? styles.bubbleOtherFirst : undefined;

  return (
    <>
      {dateLabel && <DateSeparator label={dateLabel} />}
      <Animated.View style={[
        styles.rowWrapper,
        isMine ? styles.rowWrapperMine : styles.rowWrapperOther,
        isFirst ? styles.rowFirst : styles.rowGrouped,
        { opacity, transform: [{ translateY }] },
        { backgroundColor: highlightAnim.interpolate({ inputRange: [0, 0.22], outputRange: ['transparent', 'rgba(255,122,60,0.15)'] }) },
      ]}>
      {/* Received: small avatar dot to the left, visible only on first of group */}
      {/* Tap avatar → open sender's public profile */}
      {!isMine && (
        <View style={styles.avatarSlot}>
          {isFirst && (
            <TouchableOpacity
              onPress={() => {
                if (!canAccessProfile(account)) { router.push('/auth-gate'); return; }
                router.push(`/user/${msg.sender_id}` as Parameters<typeof router.push>[0]);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.avatar, { backgroundColor: color }]}>
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={[styles.bubbleCol, isMine && styles.bubbleColMine]}>
        {msg.deleted_at ? (
          /* Tombstone - server clears content + image_url, we render a flat italic bubble. */
          <View style={[
            styles.bubble,
            isMine  ? styles.bubbleMine  : styles.bubbleOther,
            isMine  ? bubbleMineShape    : bubbleOtherShape,
            { opacity: 0.6 },
          ]}>
            <Text style={[styles.bubbleText, { fontStyle: 'italic', color: 'rgba(255,255,255,0.55)' }]}>
              {i18n.t('messageDeleted', { ns: 'chat' })}
            </Text>
          </View>
        ) : msg.type === 'image' ? (
          <View style={[
            styles.imageBubble,
            isMine  ? styles.bubbleMine  : styles.bubbleOther,
            isMine  ? bubbleMineShape    : bubbleOtherShape,
            isSending && styles.bubbleSending,
            isFailed  && styles.bubbleFailed,
          ]}>
            <MessageImage
              uri={msg.image_url}
              isSending={isSending}
              isFailed={isFailed}
              onPress={msg.image_url ? () => onImagePress(msg.image_url!) : undefined}
              onLongPress={onLongPress ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); } : undefined}
              imageStyle={styles.bubbleImage}
              surface="dm"
            />
          </View>
        ) : msg.content?.startsWith('📍') ? (
          <DmLocationBubble content={msg.content} isMine={isMine} />
        ) : (
          <Pressable
            onPress={onLongPress ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onLongPress(msg); } : undefined}
            onLongPress={onLongPress ? () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(msg); } : undefined}
            delayLongPress={350}
          >
            <View style={[
              styles.bubble,
              isMine  ? styles.bubbleMine  : styles.bubbleOther,
              isMine  ? bubbleMineShape    : bubbleOtherShape,
              isSending && styles.bubbleSending,
              isFailed  && styles.bubbleFailed,
            ]}>
              {msg.replyTo && (
                <TouchableOpacity
                  activeOpacity={msg.replyTo.id && onReplyQuotePress ? 0.65 : 1}
                  onPress={msg.replyTo.id && onReplyQuotePress ? () => onReplyQuotePress!(msg.replyTo!.id!) : undefined}
                  disabled={!msg.replyTo.id || !onReplyQuotePress}
                >
                  <View style={[dmReplyStyles.quote, isMine ? dmReplyStyles.quoteMine : dmReplyStyles.quoteOther]}>
                    <Text style={[dmReplyStyles.name, isMine && dmReplyStyles.nameMine]}>{msg.replyTo.nickname}</Text>
                    <Text style={[dmReplyStyles.text, isMine && dmReplyStyles.textMine]} numberOfLines={2}>
                      {msg.replyTo.type === 'image' ? t('photoLabel', { ns: 'common' }) : (msg.replyTo.content || t('originalUnavailable', { ns: 'chat' }))}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
                {linkifyText(msg.content)}
                {msg.edited_at && (
                  <Text style={{ fontSize: 11, color: isMine ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.45)' }}>
                    {`  ${i18n.t('edited', { ns: 'chat' })}`}
                  </Text>
                )}
              </Text>
              {(() => {
                const u = extractFirstUrl(msg.content);
                return u ? <LinkPreviewCard url={u} isMine={isMine} /> : null;
              })()}
            </View>
          </Pressable>
        )}

        {/* Reaction pills + burst overlay */}
        {msg.reactions && msg.reactions.length > 0 && onReact && (
          <ReactionPills
            reactions={msg.reactions}
            onReact={e => {
              if (msg.id) reactionEmitter.emit(msg.id, EMOJI_TO_TYPE[e] ?? 'heart');
              onReact(msg, e);
            }}
            isMine={isMine}
          />
        )}
        {msg.id && <ReactionBurstOverlay messageId={msg.id} isMine={isMine} />}

        {/* Status / timestamp row - only on last message of group */}
        {isLast && (
          <View style={[styles.metaRow, isMine && styles.metaRowMine]}>
            {isSending && (
              <Text style={styles.metaText}>{t('sending')}</Text>
            )}
            {isFailed && (
              <Text style={styles.metaTextFailed}>{t('failedRetry')}</Text>
            )}
            {!isSending && !isFailed && (
              <Text style={styles.metaText}>{formatSmartTime(msg.created_at)}</Text>
            )}
          </View>
        )}
      </View>
    </Animated.View>
    </>
  );
}

// ── Thread - rendered once conversationId is known ────────────────────────────

function DMThread({ conversationId, displayName }: { conversationId: string; displayName: string }) {
  const { t } = useTranslation('dm');
  const { account } = useApp();
  const { messages, loading, loadingOlder, hasMore, sending, error, clearError, sendText, sendImage, loadOlder, setMessageReactions, editMessage, deleteMessage } = useDMThread(conversationId);
  const [text,          setText]          = useState('');
  const [uploading,     setUploading]     = useState(false);
  const [focused,       setFocused]       = useState(false);
  const [showEmoji,     setShowEmoji]     = useState(false);
  const [previewUri,    setPreviewUri]    = useState<string | null>(null);
  const [showShareSheet,  setShowShareSheet]  = useState(false);
  const [locationCoords,  setLocationCoords]  = useState<{ lat: number; lng: number } | null>(null);
  const [replyingTo,    setReplyingTo]    = useState<ReplyRef | null>(null);
  const replyingToRef = useRef<ReplyRef | null>(null);
  replyingToRef.current = replyingTo;
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [actionSheetMsg,   setActionSheetMsg]   = useState<DmMessage | null>(null);
  const [editingMsg,       setEditingMsg]       = useState<{ id: string; content: string } | null>(null);
  const flatListRef = useRef<FlatList<DmMessage>>(null);
  const lastSel   = useRef({ start: 0, end: 0 });

  function scrollToMessage(id: string) {
    const idx = messages.findIndex(m => m.id === id);
    if (idx === -1) return;
    flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    setHighlightedMsgId(id);
    setTimeout(() => setHighlightedMsgId(null), 1500);
  }
  const vibScale  = useRef(new Animated.Value(1)).current;

  function vibePressIn() {
    Animated.timing(vibScale, { toValue: 1.1, duration: 150, useNativeDriver: true }).start();
  }
  function vibePressOut() {
    Animated.timing(vibScale, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  const color   = avatarColor(displayName);
  const initial = displayName.slice(0, 1).toUpperCase();
  const busy    = sending || uploading;

  // Seed composer when entering edit mode; clear on exit.
  useEffect(() => {
    if (editingMsg) setText(editingMsg.content);
    else setText('');
  }, [editingMsg?.id]);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Edit mode short-circuits normal send: save the edit and exit edit mode.
    if (editingMsg) {
      const idToEdit = editingMsg.id;
      const original = editingMsg.content;
      setEditingMsg(null);
      setText('');
      if (trimmed === original) return;  // no-op when unchanged
      editMessage(idToEdit, trimmed).catch(e => {
        console.warn('[dm] edit failed:', e);
        Alert.alert(i18n.t('editFailed', { ns: 'chat' }));
      });
      return;
    }
    const reply = replyingToRef.current;
    setReplyingTo(null);
    sendText(trimmed, reply);
    setText('');
  }

  async function sendImageUri(uri: string) {
    setUploading(true);
    try {
      await sendImage(uri);
    } finally {
      setUploading(false);
    }
  }

  async function openLibrary() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('composer.photoPermTitle', { ns: 'common' }), t('composer.photoPermBody', { ns: 'common' }));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]?.uri) await sendImageUri(result.assets[0].uri);
  }

  async function openCamera() {
    console.log('[camera/dm] openCamera called');
    try {
      if (Platform.OS === 'ios') {
        console.log('[camera/dm] iOS: requesting permission...');
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        console.log('[camera/dm] iOS permission status:', status);
        if (status !== 'granted') {
          Alert.alert(t('composer.photoPermTitle', { ns: 'common' }), t('composer.cameraPermSettings', { ns: 'common' }));
          return;
        }
      }

      console.log('[camera/dm] launching camera (platform:', Platform.OS, ')...');
      const CAMERA_TIMEOUT_MS = 60_000;
      const result = await Promise.race([
        ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              'launchCameraAsync timed out after ' + CAMERA_TIMEOUT_MS + 'ms - ' +
              'activity result was never received (possible FileProvider misconfiguration)',
            )),
            CAMERA_TIMEOUT_MS,
          ),
        ),
      ]);

      console.log('[camera/dm] launchCameraAsync resolved');
      console.log('[camera/dm] full result:', JSON.stringify(result));
      console.log('[camera/dm] result.canceled:', result.canceled);
      console.log('[camera/dm] result.assets:', JSON.stringify(result.assets));

      const uri = result.assets?.[0]?.uri;
      console.log('[camera/dm] asset uri:', uri ?? 'none');

      if (!result.canceled && uri) {
        console.log('[camera/dm] entering upload flow with uri:', uri);
        await sendImageUri(uri);
      } else {
        console.log('[camera/dm] canceled or no uri - no upload');
      }
    } catch (err) {
      console.error('[camera/dm] launch failed:', String(err));
      Alert.alert(t('composer.cameraUnavailTitle', { ns: 'common' }), String(err));
    }
  }

  function handlePickImage() {
    if (busy) return;
    Alert.alert(t('composer.sendPhotoTitle', { ns: 'common' }), undefined, [
      { text: t('composer.takePhoto', { ns: 'common' }),     onPress: () => InteractionManager.runAfterInteractions(() => openCamera()) },
      { text: t('composer.chooseLibrary', { ns: 'common' }), onPress: () => InteractionManager.runAfterInteractions(() => openLibrary()) },
      { text: t('cancel', { ns: 'common' }), style: 'cancel' },
    ]);
  }

  async function handleMySpot() {
    setShowShareSheet(false);

    // Permission check (fast if already granted on boot; shows dialog only on first use)
    const existing = await Location.getForegroundPermissionsAsync();
    let granted = existing.status === 'granted';
    if (!granted) {
      if (!existing.canAskAgain) {
        Alert.alert(
          t('composer.locPermTitle', { ns: 'common' }),
          t('composer.locPermSettings', { ns: 'common' }),
          [
            { text: t('cancel', { ns: 'common' }), style: 'cancel' },
            { text: t('openSettings', { ns: 'common' }), onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      const result = await Location.requestForegroundPermissionsAsync();
      granted = result.status === 'granted';
      if (!granted) {
        Alert.alert(t('composer.locNeededTitle', { ns: 'common' }), t('composer.locNeededBody', { ns: 'common' }));
        return;
      }
    }

    // Use last known position (instant cache lookup) to open the picker immediately.
    // LocationPicker will refine to accurate GPS internally via injectJavaScript.
    let lat = 0, lng = 0;
    try {
      const last = await Location.getLastKnownPositionAsync();
      if (last) { lat = last.coords.latitude; lng = last.coords.longitude; }
    } catch {}

    setLocationCoords({ lat, lng });
  }

  function handleLocationConfirm({ place, address, lat, lng }: { place: string; address: string; lat: number; lng: number }) {
    setLocationCoords(null);
    const nickname = account?.display_name ?? displayName ?? 'Someone';
    const label = place || 'somewhere';
    const coordLine = `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const text = address
      ? `📍 ${nickname} is at ${label}\n${coordLine}\n${address}`
      : `📍 ${nickname} is at ${label}\n${coordLine}`;
    sendText(text);
  }

  function insertEmoji(emoji: string) {
    const { start, end } = lastSel.current;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    const pos = start + emoji.length;
    lastSel.current = { start: pos, end: pos };
  }

  function handleEmojiToggle() {
    if (!showEmoji) Keyboard.dismiss();
    setShowEmoji(p => !p);
  }

  // Inverted FlatList: index 0 = newest (bottom), index n-1 = oldest (top).
  // "isFirst" = oldest in sender run → avatar shown here.
  // "isLast"  = newest in sender run → timestamp shown here.
  const renderItem = useCallback(({ item, index }: { item: DmMessage; index: number }) => {
    const isMine  = item.sender_id === account?.id;
    const prevMsg = messages[index + 1]; // older message
    const nextMsg = messages[index - 1]; // newer message
    const isFirst = !prevMsg || prevMsg.sender_id !== item.sender_id;
    const isLast  = !nextMsg || nextMsg.sender_id !== item.sender_id;
    // Show date separator when this item starts a new calendar day vs the older message
    const dateLabel = !isSameDay(item.created_at, prevMsg?.created_at)
      ? formatDateLabel(item.created_at)
      : undefined;
    return (
      <DmRow
        msg={item}
        isMine={isMine}
        isFirst={isFirst}
        isLast={isLast}
        color={color}
        initial={initial}
        dateLabel={dateLabel}
        onImagePress={setPreviewUri}
        isHighlighted={highlightedMsgId === item.id}
        onReplyQuotePress={scrollToMessage}
        onLongPress={(msg) => {
          if (!msg.id || msg.id.startsWith('local-')) return;
          setActionSheetMsg(msg);
        }}
        onReact={async (msg, emoji) => {
          if (!msg.id) return;
          try {
            const reactions = await toggleDmReaction(conversationId, msg.id, emoji);
            setMessageReactions(msg.id, reactions);
          } catch (e) {
            console.warn('[dm] reaction failed:', e);
          }
        }}
      />
    );
  }, [messages, account?.id, color, initial, highlightedMsgId, setMessageReactions, conversationId]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
    >
      {error && (
        <TouchableOpacity style={styles.errorBanner} onPress={clearError} activeOpacity={0.8}>
          <Text style={styles.errorBannerText}>{t('dismissHint', { ns: 'chat', error })}</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          inverted
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onScrollToIndexFailed={() => {}}
          onEndReached={hasMore ? loadOlder : undefined}
          onEndReachedThreshold={0.2}
          ListFooterComponent={
            loadingOlder ? (
              <View style={styles.loadingOlderWrap}>
                <ActivityIndicator size="small" color={Colors.muted} />
              </View>
            ) : (!hasMore && !loading && messages.length > 0) ? (
              <View style={styles.loadingOlderWrap}>
                <Text style={styles.beginningText}>{t('beginning', { ns: 'chat' })}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>💬</Text>
              <Text style={styles.emptyTitle}>{t('emptyTitle')}</Text>
              <Text style={styles.emptySub}>{t('emptySub', { name: displayName })}</Text>
            </View>
          }
        />
      )}

      <ImagePreviewModal uri={previewUri} onClose={() => setPreviewUri(null)} />

      {/* ── Emoji panel ── */}
      {showEmoji && <EmojiPanel onSelect={insertEmoji} />}

      {/* ── Location picker ── */}
      {locationCoords && (
        <LocationPicker
          visible={!!locationCoords}
          initialLat={locationCoords.lat}
          initialLng={locationCoords.lng}
          onConfirm={handleLocationConfirm}
          onClose={() => setLocationCoords(null)}
        />
      )}

      {/* ── Share sheet ── */}
      <ShareSheet
        visible={showShareSheet}
        onSnap={() => { setShowShareSheet(false); setTimeout(handlePickImage, 0); }}
        onSpot={handleMySpot}
        onClose={() => setShowShareSheet(false)}
        spotLoading={false}
      />

      {/* ── Reply preview strip ── */}
      {replyingTo && !editingMsg && (
        <View style={dmComposerReplyStyles.strip}>
          <View style={dmComposerReplyStyles.body}>
            <Text style={dmComposerReplyStyles.name}>{replyingTo.nickname}</Text>
            <Text style={dmComposerReplyStyles.preview} numberOfLines={1}>
              {replyingTo.type === 'image' ? t('photoLabel', { ns: 'common' }) : replyingTo.content}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={dmComposerReplyStyles.close}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Edit banner - visible while editing one of your own DM messages ── */}
      {editingMsg && (
        <View style={dmComposerEditStyles.strip}>
          <View style={dmComposerEditStyles.body}>
            <Text style={dmComposerEditStyles.name}>{i18n.t('editingBanner', { ns: 'chat' })}</Text>
            <Text style={dmComposerEditStyles.preview} numberOfLines={1}>{editingMsg.content}</Text>
          </View>
          <TouchableOpacity onPress={() => setEditingMsg(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={dmComposerEditStyles.close}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Composer ── */}
      <View style={[styles.composer, focused && styles.composerFocused]}>
        <Animated.View style={[styles.vibeBtnGlow, { transform: [{ scale: vibScale }] }, busy && styles.imageBtnDisabled]}>
          <Pressable
            onPress={() => { if (!busy) setShowShareSheet(true); }}
            onPressIn={vibePressIn}
            onPressOut={vibePressOut}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={t('composer.attach', { ns: 'common' })}
          >
            <LinearGradient
              colors={['#C24A38', '#B87228']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.vibeBtn}
            >
              {uploading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="add" size={24} color="#fff" />
              }
            </LinearGradient>
          </Pressable>
        </Animated.View>
        <TouchableOpacity
          style={[styles.emojiBtn, showEmoji && styles.emojiBtnActive]}
          onPress={handleEmojiToggle}
          activeOpacity={0.7}
        >
          <Text style={styles.emojiBtnIcon}>😊</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onSelectionChange={({ nativeEvent: { selection } }) => { lastSel.current = selection; }}
          onFocus={() => { setFocused(true); setShowEmoji(false); }}
          onBlur={() => setFocused(false)}
          placeholder={t('messagePlaceholder', { name: displayName })}
          placeholderTextColor={Colors.muted2}
          multiline
          maxLength={1000}
          returnKeyType="send"
          blurOnSubmit={Platform.OS !== 'ios'}
          onSubmitEditing={Platform.OS !== 'ios' ? handleSend : undefined}
          editable={!busy}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || busy) && styles.sendBtnOff]}
          onPress={handleSend}
          disabled={!text.trim() || busy}
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color={Colors.white} />
            : <Ionicons name="send" size={20} color={text.trim() ? '#fff' : Colors.muted2} />
          }
        </TouchableOpacity>
      </View>

      <MessageActionSheet
        visible={actionSheetMsg !== null}
        reactions={actionSheetMsg?.reactions ?? []}
        onReact={async (emoji) => {
          if (!actionSheetMsg?.id) return;
          reactionEmitter.emit(actionSheetMsg.id, EMOJI_TO_TYPE[emoji] ?? 'heart');
          try {
            const reactions = await toggleDmReaction(conversationId, actionSheetMsg.id, emoji);
            setMessageReactions(actionSheetMsg.id, reactions);
          } catch (e) {
            console.warn('[dm] reaction failed:', e);
          }
        }}
        onReply={actionSheetMsg ? () => {
          setReplyingTo({ id: actionSheetMsg.id, nickname: actionSheetMsg.sender_name, content: actionSheetMsg.content ?? '', type: actionSheetMsg.type ?? 'text' });
        } : undefined}
        onCopy={actionSheetMsg?.content ? () => {
          Clipboard.setStringAsync(actionSheetMsg.content!).catch(() => {});
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } : undefined}
        onEdit={(() => {
          if (!actionSheetMsg) return undefined;
          const mine = !!account?.id && actionSheetMsg.sender_id === account.id;
          const editable = (actionSheetMsg.type ?? 'text') === 'text' && !actionSheetMsg.deleted_at && !!actionSheetMsg.content && !actionSheetMsg.content.startsWith('📍');
          return mine && editable ? () => {
            setReplyingTo(null);
            setEditingMsg({ id: actionSheetMsg.id, content: actionSheetMsg.content });
          } : undefined;
        })()}
        onDelete={(() => {
          if (!actionSheetMsg) return undefined;
          const mine = !!account?.id && actionSheetMsg.sender_id === account.id;
          return mine && !actionSheetMsg.deleted_at ? () => {
            const msgId = actionSheetMsg.id;
            Alert.alert(
              i18n.t('deleteConfirmTitle', { ns: 'chat' }),
              i18n.t('deleteConfirmBody', { ns: 'chat' }),
              [
                { text: i18n.t('deleteConfirmCancel', { ns: 'chat' }), style: 'cancel' },
                { text: i18n.t('deleteConfirmCta', { ns: 'chat' }), style: 'destructive',
                  onPress: async () => {
                    try { await deleteMessage(msgId); }
                    catch (e) { console.warn('[dm] delete failed:', e); Alert.alert(i18n.t('deleteFailed', { ns: 'chat' })); }
                  } },
              ],
            );
          } : undefined;
        })()}
        onClose={() => setActionSheetMsg(null)}
      />
    </KeyboardAvoidingView>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
// Two open modes:
//   Notification flow: conv param is set → open existing conversation directly by conversationId.
//   User-profile flow: no conv param → id is a userId, call findOrCreateDM to get/create thread.

export default function DMThreadScreen() {
  const router = useRouter();
  const { t } = useTranslation('dm');
  const { id, name, conv } = useLocalSearchParams<{ id: string; name?: string; conv?: string }>();
  const { account, identity, addBlocked, removeBlocked } = useApp();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [resolveError,   setResolveError]   = useState<string | null>(null);

  // Other party's userId. In the profile-flow `id` IS the userId; in the
  // notification-flow `id` is the conversationId so we look it up via the
  // DM list once the screen mounts. Required for the Block button + the
  // View profile action.
  const [otherUserId,    setOtherUserId]    = useState<string | null>(null);

  const [showActionSheet, setShowActionSheet] = useState(false);
  const [blockBusy,       setBlockBusy]       = useState(false);

  const displayName = name ?? t('fallbackName');
  const color       = avatarColor(displayName);
  const initial     = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    console.log('[dm-screen] route params = id:', id, '| name:', name, '| conv:', conv);

    if (conv) {
      // Notification flow: conversationId already known - open directly, no API call needed.
      console.log('[dm-screen] opened from notification');
      console.log('[dm-screen] using existing conversationId, skipping findOrCreateDM');
      console.log('[dm-screen] loading conversation', conv);
      setConversationId(conv);
      track('dm_opened', { conversationId: conv, source: 'notification' });

      // Look up the other party's userId so the Block / View profile actions
      // work from notification-opened threads. The DM list is small (cap 50)
      // so this is cheap.
      let cancelledLookup = false;
      fetchConversations()
        .then(rows => {
          if (cancelledLookup) return;
          const match = rows.find(r => r.id === conv);
          if (match?.other_user_id) setOtherUserId(match.other_user_id);
        })
        .catch(() => { /* non-fatal - Block stays disabled */ });
      return () => { cancelledLookup = true; };
    }

    // DMs require a registered account - guests don't have a user_id on either side.
    if (!canAccessProfile(account)) {
      router.replace('/auth-gate?reason=send_dm');
      return;
    }

    if (!id) return;
    let cancelled = false;
    // User-profile flow: id is a userId - find or create the DM thread.
    setOtherUserId(id);  // route param IS the userId in this flow
    console.log('[DM] opening DM → targetUserId:', id, '| name:', displayName);
    findOrCreateDM(id)
      .then(({ conversation }) => {
        if (!cancelled) {
          console.log('[DM] conversationId resolved:', conversation.id);
          setConversationId(conversation.id);
          track('dm_opened', { conversationId: conversation.id, source: 'profile' });
        }
      })
      .catch((err) => {
        console.error('[DM] findOrCreateDM failed:', err);
        if (!cancelled) setResolveError(t('resolveError'));
      });
    return () => { cancelled = true; };
  }, [id, conv, account]);

  function handleBlockPress() {
    if (!otherUserId || blockBusy) return;
    Alert.alert(
      t('blockTitle', { name: displayName }),
      t('blockBody', { name: displayName }),
      [
        { text: t('cancel', { ns: 'common' }), style: 'cancel' },
        {
          text: t('blockConfirm'), style: 'destructive',
          onPress: async () => {
            setBlockBusy(true);
            try {
              addBlocked({ userId: otherUserId });
              await submitBlock({
                targetUserId:   otherUserId,
                targetNickname: displayName,
                guestId:        account ? undefined : identity?.guestId,
              });
              // Thread is now closed for both sides - return to inbox.
              router.replace('/messages');
            } catch {
              removeBlocked({ userId: otherUserId });
              Alert.alert(t('blockFailTitle'), t('blockFailBody'));
            } finally {
              setBlockBusy(false);
            }
          },
        },
      ],
    );
  }

  function handleViewProfile() {
    if (!otherUserId) return;
    router.push({ pathname: '/user/[id]', params: { id: otherUserId, name: displayName } });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="chevron-left" size={26} color={Colors.text} />
        </TouchableOpacity>

        <View style={[styles.headerAvatar, { backgroundColor: color + '22', borderColor: color + '55' }]}>
          <Text style={[styles.headerAvatarText, { color }]}>{initial}</Text>
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.headerSub}>{t('directMessage')}</Text>
        </View>

        {/* … menu - Apple G1.2 requires Block + Report visible from chat thread */}
        <TouchableOpacity
          style={styles.headerMore}
          onPress={() => setShowActionSheet(true)}
          activeOpacity={0.7}
          accessibilityLabel={t('moreOptions')}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      {/* Action sheet - View profile / Report / Block. otherUserId may briefly
          be null in the notification flow while the conversations lookup is in
          flight; in that case all per-user actions are disabled. */}
      <ProfileActionSheet
        visible={showActionSheet}
        title={displayName}
        actions={[
          {
            key:      'view_profile',
            label:    t('viewProfile'),
            icon:     'person-outline',
            disabled: !otherUserId,
            onPress:  handleViewProfile,
          },
          {
            key:      'report',
            label:    t('reportUser'),
            icon:     'flag-outline',
            disabled: !otherUserId,
            onPress:  () => {
              if (!otherUserId) return;
              router.push({ pathname: '/user/[id]', params: { id: otherUserId, name: displayName } });
            },
          },
          {
            key:         'block',
            label:       blockBusy ? t('blocking') : t('blockUser'),
            icon:        'ban-outline',
            destructive: true,
            disabled:    !otherUserId || blockBusy,
            onPress:     handleBlockPress,
          },
        ]}
        onClose={() => setShowActionSheet(false)}
      />

      {/* ── Body ── */}
      {resolveError ? (
        <View style={styles.center}>
          <Text style={styles.resolveErrorText}>{resolveError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>{t('goBack')}</Text>
          </TouchableOpacity>
        </View>
      ) : !conversationId ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <DMThread conversationId={conversationId} displayName={displayName} />
      )}
    </SafeAreaView>
  );
}

// ── DM Reply quote styles ─────────────────────────────────────────────────────

// DM bubbles: paddingHorizontal 18, paddingVertical 12 (see styles.bubble)
const dmReplyStyles = StyleSheet.create({
  quote: {
    marginTop:    -12,
    marginLeft:   -18,
    marginRight:  -18,
    marginBottom:  9,
    paddingHorizontal: 18,
    paddingVertical:   8,
    borderLeftWidth:   3,
    borderBottomWidth: 1,
  },
  quoteOther: {
    backgroundColor:   'rgba(0,0,0,0.12)',
    borderLeftColor:   'rgba(255,122,60,0.75)',
    borderBottomColor: 'rgba(255,255,255,0.06)',
    borderTopLeftRadius:  18,
    borderTopRightRadius: 18,
  },
  quoteMine: {
    backgroundColor:   'rgba(0,0,0,0.2)',
    borderLeftColor:   'rgba(255,255,255,0.45)',
    borderBottomColor: 'rgba(255,255,255,0.1)',
    borderTopLeftRadius:  18,
    borderTopRightRadius: 18,
  },
  name:     { fontSize: FontSizes.xs, fontWeight: '700', color: '#FF7A3C', marginBottom: 2, lineHeight: 17 },
  nameMine: { color: 'rgba(255,255,255,0.8)' },
  text:     { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 16 },
  textMine: { color: 'rgba(255,255,255,0.55)' },
});

const dmComposerReplyStyles = StyleSheet.create({
  strip: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   8,
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,255,255,0.08)',
    gap:               10,
  },
  body:    { flex: 1, minWidth: 0 },
  name:    { fontSize: 12, fontWeight: '700', color: Colors.accent, marginBottom: 2 },
  preview: { fontSize: 12, color: Colors.muted2 },
  close:   { fontSize: 16, color: Colors.muted2, fontWeight: '600' },
});

const dmComposerEditStyles = StyleSheet.create({
  strip: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: 16,
    paddingVertical:   8,
    backgroundColor:   'rgba(255,122,60,0.10)',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,122,60,0.22)',
    gap:               10,
  },
  body:    { flex: 1, minWidth: 0 },
  name:    { fontSize: 12, fontWeight: '700', color: '#FF7A3C', marginBottom: 2 },
  preview: { fontSize: 12, color: Colors.muted2 },
  close:   { fontSize: 16, color: Colors.muted2, fontWeight: '600' },
});

// ── Styles ────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 28;
const SEND_BTN    = 48;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex:      { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingHorizontal: Spacing.md,
    paddingVertical:   10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap:               12,
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
  },
  headerAvatar: {
    width:          44,
    height:         44,
    borderRadius:   Radius.full,
    borderWidth:    1.5,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  headerAvatarText: { fontWeight: '800', fontSize: FontSizes.md },
  headerInfo: { flex: 1, gap: 1 },
  headerName: {
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    color:         Colors.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
  },
  headerMore: {
    width:           36,
    height:          36,
    borderRadius:    Radius.md,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },

  // ── States ──────────────────────────────────────────────────────────────────
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  resolveErrorText: {
    color:      Colors.muted,
    fontSize:   FontSizes.sm,
    textAlign:  'center',
    paddingHorizontal: Spacing.xl,
  },
  retryBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
  },
  retryBtnText: { color: Colors.text, fontSize: FontSizes.sm, fontWeight: '600' },

  errorBanner: {
    backgroundColor:   Colors.accent2,
    paddingHorizontal: Spacing.md,
    paddingVertical:   8,
  },
  errorBannerText: { color: '#fff', fontSize: FontSizes.xs, textAlign: 'center' },

  // ── Message list ────────────────────────────────────────────────────────────
  listContent: {
    paddingTop:        24,
    paddingBottom:     8,
    paddingHorizontal: 16,
  },
  loadingOlderWrap: { paddingVertical: 14, alignItems: 'center' },
  beginningText: { fontSize: FontSizes.xs, color: Colors.muted2 },

  // ── Row wrapper ─────────────────────────────────────────────────────────────
  rowWrapper: {
    flexDirection: 'row',
    alignItems:    'flex-end',
    maxWidth:      '82%',
  },
  rowWrapperMine:  { alignSelf: 'flex-end' },
  rowWrapperOther: { alignSelf: 'flex-start' },
  rowFirst:   { marginTop: 18 },
  rowGrouped: { marginTop: 3 },

  // ── Avatar slot (received messages only) ────────────────────────────────────
  avatarSlot: {
    width:       AVATAR_SIZE + 6,   // fixed slot keeps bubbles aligned within a run
    alignItems:  'flex-end',
    paddingRight: 6,
    paddingBottom: 2,
  },
  avatar: {
    width:          AVATAR_SIZE,
    height:         AVATAR_SIZE,
    borderRadius:   Radius.full,
    alignItems:     'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // ── Bubble column ────────────────────────────────────────────────────────────
  bubbleCol:     { flexShrink: 1 },
  bubbleColMine: { alignItems: 'flex-end' },

  // ── Bubble ──────────────────────────────────────────────────────────────────
  bubble: {
    borderRadius:      22,
    paddingHorizontal: 18,
    paddingVertical:   12,
    maxWidth:          '100%',
  },
  // Received: warm dark surface with subtle border
  bubbleOther: {
    backgroundColor: Colors.bg3,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.06)',
  },
  // "Tail" corner on first message of a received group
  bubbleOtherFirst: {
    borderBottomLeftRadius: 5,
  },
  // Sent: brand orange - bright, unmistakably mine
  bubbleMine: {
    backgroundColor: Colors.accent,
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 3 },
    shadowOpacity:   0.35,
    shadowRadius:    8,
    elevation:       5,
  },
  // "Tail" corner on first message of a sent group
  bubbleMineFirst: {
    borderBottomRightRadius: 5,
  },
  bubbleSending: { opacity: 0.6 },
  bubbleFailed: {
    borderWidth: 1.5,
    borderColor: 'rgba(248,113,113,0.6)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  bubbleText: {
    fontSize:   15,
    color:      Colors.text,
    lineHeight: 22,
  },
  bubbleTextMine: { color: '#fff', fontWeight: '500' },

  // ── Meta row (timestamp / status) ────────────────────────────────────────────
  metaRow:     { marginTop: 4, paddingHorizontal: 4 },
  metaRowMine: { alignItems: 'flex-end' },
  // DM message timestamps - was 11pt + #635650 (~2.4:1). Apple G4 floor.
  metaText: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
  },
  metaTextFailed: {
    fontSize: FontSizes.xs,
    color:    Colors.red,
  },

  // ── Empty state ──────────────────────────────────────────────────────────────
  emptyWrap: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    paddingVertical: Spacing.xxl,
    gap:            8,
  },
  emptyEmoji: { fontSize: 40 },
  emptyTitle: {
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      Colors.text,
    textAlign:  'center',
  },
  emptySub: {
    fontSize:  FontSizes.sm,
    color:     Colors.muted,
    textAlign: 'center',
  },

  // ── Composer ─────────────────────────────────────────────────────────────────
  composer: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    paddingHorizontal: 14,
    paddingVertical:   12,
    paddingBottom:     Platform.OS === 'android' ? 12 : 14,
    borderTopWidth:    1,
    borderTopColor:    Colors.border,
    backgroundColor:   Colors.bg,
    gap:               10,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: -4 },
    shadowOpacity:     0.22,
    shadowRadius:      10,
    elevation:         8,
  },
  composerFocused: {
    borderTopColor: 'rgba(255,122,60,0.3)',
  },
  vibeBtnGlow: {
    flexShrink:    0,
    borderRadius:  Radius.full,
    shadowColor:   '#C24A38',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius:  12,
    elevation:     10,
  },
  vibeBtn: {
    width:          SEND_BTN,
    height:         SEND_BTN,
    borderRadius:   Radius.full,
    alignItems:     'center',
    justifyContent: 'center',
  },
  imageBtnDisabled: { opacity: 0.4 },
  emojiBtn: {
    width:           36,
    height:          36,
    borderRadius:    18,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.09)',
    flexShrink:      0,
    opacity:         0.6,
  },
  emojiBtnActive: {
    opacity:         1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  emojiBtnIcon: { fontSize: 18, lineHeight: 22 },
  input: {
    flex:              1,
    flexShrink:        1,
    minWidth:          0,
    minHeight:         48,
    maxHeight:         130,
    backgroundColor:   Colors.bg2,
    borderRadius:      Radius.full,
    borderWidth:       1.5,
    borderColor:       Colors.border,
    paddingHorizontal: 20,
    paddingTop:        13,
    paddingBottom:     13,
    color:             Colors.text,
    fontSize:          FontSizes.sm,
    lineHeight:        22,
  },
  sendBtn: {
    width:           SEND_BTN,
    height:          SEND_BTN,
    borderRadius:    Radius.full,
    backgroundColor: Colors.accent,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.5,
    shadowRadius:    10,
    elevation:       8,
  },
  sendBtnOff: {
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    shadowOpacity:   0,
    elevation:       0,
  },

  // ── Image bubble ─────────────────────────────────────────────────────────────
  imageBubble: {
    borderRadius:    22,
    overflow:        'hidden',
    maxWidth:        '100%',
    padding:         0,
  },
  bubbleImage: {
    width:  220,
    height: 180,
  },
});
