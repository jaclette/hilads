import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Switch,
  Text, TextInput, TouchableOpacity, View, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { askDailyPush } from '@/services/push';
import { uploadFile } from '@/api/uploads';
import { createDailyProof, dailyErrorCode, fetchDailyProof, fetchDailyToday, updateDailyProof } from '@/api/daily';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { AndroidCameraCapture } from '@/features/chat/AndroidCameraCapture';
import { LocationPicker } from '@/features/chat/LocationPicker';
import { defaultCurrency } from '@/features/daily/currency';
import { dailyTrackProps } from '@/features/daily/track';
import type { DailyProof, DailyProofInput, DailyToday } from '@/types';

const CAPTION_MAX = 140;

/**
 * "45,000" / "45 000" / "2,50" / "2.50" → number. A comma followed by exactly
 * 1-2 final digits is a decimal comma; any other comma or space groups thousands.
 */
function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '');
  if (s === '') return null;
  const normalized = /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  return Number(normalized);
}
const FIRST_PROOF_KEY = 'hilads_daily_first_proof_done';
const PROPOSE_NUDGE_KEY = 'hilads_daily_propose_nudge_at';
const PROPOSE_NUDGE_EVERY_MS = 7 * 24 * 3600 * 1000;

type Photo = { uri: string; mime: string | null; remoteUrl: string | null };
type Pin = { lat: number; lng: number; name: string | null };

/**
 * Daily Challenge proof: photo (camera or gallery, AUDIT Q5), optional caption
 * (one sentence, 140 max), optional price, optional pinned place (off by
 * default). /daily/proof creates, /daily/proof?edit=<id> edits. Every new or
 * edited proof goes to review before it is visible to others.
 */
export default function DailyProofScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { account, city, identity } = useApp();

  const [today, setToday]       = useState<DailyToday | null>(null);
  const [original, setOriginal] = useState<DailyProof | null>(null);
  const [loading, setLoading]   = useState(true);
  const [photo, setPhoto]       = useState<Photo | null>(null);
  const [caption, setCaption]   = useState('');
  const [amount, setAmount]     = useState('');
  const [currency, setCurrency] = useState(defaultCurrency(city?.country));
  const [pin, setPin]           = useState<Pin | null>(null);
  const [pickerCenter, setPickerCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [androidCamera, setAndroidCamera] = useState(false);
  const [sending, setSending]   = useState(false);
  const started = useRef(false);

  // Proofs need an account (AUDIT Q4).
  useEffect(() => {
    if (!account) router.replace('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never);
  }, [account, router]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let [d, p] = await Promise.all([
          fetchDailyToday(city?.channelId),
          edit ? fetchDailyProof(edit) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setToday(d);
        // Already posted today: "new proof" edits that one instead.
        if (!p && d.myProof && d.myProof.status !== 'removed') p = d.myProof;
        if (p) {
          setOriginal(p);
          setPhoto({ uri: p.photoUrl, mime: null, remoteUrl: p.photoUrl });
          setCaption(p.caption ?? '');
          if (p.price) { setAmount(String(p.price.amount)); setCurrency(p.price.currency); }
          if (p.place) setPin({ lat: p.place.lat, lng: p.place.lng, name: p.place.name });
        }
      } catch {
        if (alive) Alert.alert(t('errors.generic'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [edit, city?.channelId, t]);

  useEffect(() => {
    if (edit || !today?.challenge || started.current) return;
    started.current = true;
    track('daily_proof_started', dailyTrackProps(today, account?.mode));
  }, [edit, today, account?.mode]);

  // ── Photo ────────────────────────────────────────────────────────────────
  const takePhoto = async () => {
    // Android: in-app camera (launchCameraAsync hangs on Android 14 + singleTask).
    if (Platform.OS === 'android') { setAndroidCamera(true); return; }
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.status !== 'granted') { Alert.alert(t('proof.permCameraTitle'), t('proof.permCameraBody')); return; }
    const pick = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, cameraType: ImagePicker.CameraType.back });
    if (!pick.canceled && pick.assets?.[0]) setPhoto({ uri: pick.assets[0].uri, mime: pick.assets[0].mimeType ?? null, remoteUrl: null });
  };

  const pickFromGallery = async () => {
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (lib.status !== 'granted') { Alert.alert(t('proof.permPhotoTitle'), t('proof.permPhotoBody')); return; }
    const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!pick.canceled && pick.assets?.[0]) setPhoto({ uri: pick.assets[0].uri, mime: pick.assets[0].mimeType ?? null, remoteUrl: null });
  };

  // ── Place (explicit opt-in, off by default) ──────────────────────────────
  const onPinToggle = async (on: boolean) => {
    if (!on) { setPin(null); return; }
    const geo = await requestFeatureLocation('challenge_proof');
    if (!geo.ok || !geo.coords) { Alert.alert(t('proof.locationOff')); return; }
    setPickerCenter(geo.coords);
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const submit = async () => {
    if (sending) return;
    if (!photo) { Alert.alert(t('proof.photoRequired')); return; }
    const parsedAmount = parseAmount(amount);
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0 || !/^[A-Z]{3}$/.test(currency))) {
      Alert.alert(t('errors.invalid_price')); return;
    }

    setSending(true);
    try {
      const photoUrl = photo.remoteUrl ?? (await uploadFile(photo.uri, photo.mime)).url;
      const input: DailyProofInput = {
        caption: caption.trim() === '' ? null : caption.trim(),
        price:   parsedAmount === null ? null : { amount: parsedAmount, currency },
        place:   pin ? { lat: pin.lat, lng: pin.lng, name: pin.name } : null,
      };
      if (!original || photoUrl !== original.photoUrl) input.photoUrl = photoUrl;

      const saved = original ? await updateDailyProof(original.id, input) : await createDailyProof(input);
      track('daily_proof_posted', {
        ...dailyTrackProps({ challenge: today?.challenge ?? null, city: today?.city ?? null, myProof: saved }, account?.mode),
        edit: !!original, has_caption: !!input.caption, has_price: !!input.price, has_place: !!input.place,
      });

      if (original) { router.back(); return; }
      // In-context push ask after the first proof (AUDIT Q9), once, then go on.
      const afterProof = async (next: string) => {
        const done = await AsyncStorage.getItem(FIRST_PROOF_KEY).catch(() => null);
        if (!done) {
          await AsyncStorage.setItem(FIRST_PROOF_KEY, '1').catch(() => {});
          await askDailyPush('first_proof', identity?.guestId);
        }
        router.replace(next as never);
      };
      // "Propose a challenge" nudge (V2-06), at most once a week.
      const lastNudge = Number(await AsyncStorage.getItem(PROPOSE_NUDGE_KEY).catch(() => null)) || 0;
      const nudge = Date.now() - lastNudge > PROPOSE_NUDGE_EVERY_MS;
      if (nudge) AsyncStorage.setItem(PROPOSE_NUDGE_KEY, String(Date.now())).catch(() => {});
      Alert.alert(t('proof.sentTitle'), t('proof.sentBody'), [
        ...(nudge ? [{ text: `💡 ${t('propose.cta')}`, onPress: () => afterProof('/daily/propose?source=after_proof') }] : []),
        { text: t('proof.ok'), onPress: () => afterProof('/daily/today') },
      ]);
    } catch (err) {
      const code = dailyErrorCode(err);
      Alert.alert(code ? t(`errors.${code}`, { defaultValue: t('errors.generic') }) : t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  const challenge = today?.challenge ?? null;
  const closed = !loading && (!challenge || (original !== null && !challenge.isActive));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{original ? t('proof.titleEdit') : t('proof.titleNew')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : closed ? (
        <View style={styles.center}><Text style={styles.muted}>{challenge ? t('proof.editOnlyActive') : t('errors.no_active_challenge')}</Text></View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {challenge && <Text style={styles.challenge}>🔥 {challenge.text}</Text>}

            {photo ? (
              <View style={styles.photoWrap}>
                <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
                <View style={styles.photoActions}>
                  <TouchableOpacity style={styles.smallBtn} onPress={takePhoto}><Text style={styles.smallBtnText}>📷 {t('proof.camera')}</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={pickFromGallery}><Text style={styles.smallBtnText}>🖼️ {t('proof.gallery')}</Text></TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.photoEmpty}>
                <Text style={styles.photoEmptyText}>{t('proof.addPhoto')}</Text>
                <View style={styles.photoChoices}>
                  <TouchableOpacity style={styles.bigBtn} onPress={takePhoto} accessibilityRole="button">
                    <Ionicons name="camera" size={26} color={colors.accentText} />
                    <Text style={styles.bigBtnText}>{t('proof.camera')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.bigBtn} onPress={pickFromGallery} accessibilityRole="button">
                    <Ionicons name="images" size={26} color={colors.accentText} />
                    <Text style={styles.bigBtnText}>{t('proof.gallery')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <Text style={styles.label}>{t('proof.caption')}</Text>
            <TextInput
              style={styles.input}
              value={caption}
              onChangeText={v => setCaption(v.replace(/\n/g, ' ').slice(0, CAPTION_MAX))}
              placeholder={t('proof.captionPlaceholder')}
              placeholderTextColor={colors.muted}
              maxLength={CAPTION_MAX}
              returnKeyType="done"
              blurOnSubmit
            />
            <Text style={[styles.counter, caption.length > CAPTION_MAX - 15 && styles.counterNear]}>{caption.length} / {CAPTION_MAX}</Text>

            <Text style={styles.label}>{t('proof.price')}</Text>
            <View style={styles.priceRow}>
              <TextInput
                style={[styles.input, styles.flex]}
                value={amount}
                onChangeText={setAmount}
                placeholder={t('proof.pricePlaceholder')}
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.currency]}
                value={currency}
                onChangeText={v => setCurrency(v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
                autoCapitalize="characters"
                maxLength={3}
                accessibilityLabel="Currency"
              />
            </View>

            <View style={styles.pinRow}>
              <View style={styles.flex}>
                <Text style={styles.pinTitle}>📍 {t('proof.pin')}</Text>
                <Text style={styles.muted}>{pin ? (pin.name || t('unnamedPlace')) : t('proof.pinHint')}</Text>
              </View>
              {pin && (
                <TouchableOpacity onPress={() => setPickerCenter({ lat: pin.lat, lng: pin.lng })}>
                  <Text style={styles.link}>{t('proof.pinChange')}</Text>
                </TouchableOpacity>
              )}
              <Switch
                value={!!pin}
                onValueChange={onPinToggle}
                trackColor={{ true: colors.accent, false: colors.border }}
                accessibilityLabel={t('proof.pin')}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.submit, (!photo || sending) && styles.submitOff]} onPress={submit} disabled={sending} accessibilityRole="button">
              {sending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitText}>{original ? t('proof.save') : t('proof.submit')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      <AndroidCameraCapture
        visible={androidCamera}
        onCapture={uri => { setAndroidCamera(false); setPhoto({ uri, mime: 'image/jpeg', remoteUrl: null }); }}
        onClose={() => setAndroidCamera(false)}
      />
      {pickerCenter && (
        <LocationPicker
          visible
          initialLat={pickerCenter.lat}
          initialLng={pickerCenter.lng}
          onConfirm={r => { setPin({ lat: r.lat, lng: r.lng, name: r.place || null }); setPickerCenter(null); }}
          onClose={() => setPickerCenter(null)}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  flex:        { flex: 1 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
  nav:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:        { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  body:        { padding: Spacing.md, gap: 8, paddingBottom: 30 },
  challenge:   { fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginBottom: 8 },
  photoEmpty:  { borderRadius: Radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: c.accent, backgroundColor: c.bg2, padding: 18, gap: 14, alignItems: 'center' },
  photoEmptyText: { fontSize: FontSizes.sm, color: c.muted, fontWeight: '600' },
  photoChoices:{ flexDirection: 'row', gap: 12 },
  bigBtn:      { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 16, borderRadius: Radius.md, backgroundColor: c.bg3 },
  bigBtnText:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  photoWrap:   { gap: 8 },
  photo:       { width: '100%', aspectRatio: 1, borderRadius: Radius.lg, backgroundColor: c.bg3 },
  photoActions:{ flexDirection: 'row', gap: 8 },
  smallBtn:    { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg2 },
  smallBtnText:{ fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  label:       { fontSize: FontSizes.xs, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10 },
  input:       { backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 12, fontSize: FontSizes.sm, color: c.text },
  counter:     { alignSelf: 'flex-end', fontSize: 12, color: c.muted },
  counterNear: { color: c.accentText, fontWeight: '700' },
  priceRow:    { flexDirection: 'row', gap: 8 },
  currency:    { width: 84, textAlign: 'center', fontWeight: '700' },
  pinRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 12, borderRadius: Radius.md, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border },
  pinTitle:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  muted:       { fontSize: 12, color: c.muted },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.accentText },
  footer:      { padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg },
  submit:      { backgroundColor: c.accent, borderRadius: Radius.full, paddingVertical: 15, alignItems: 'center' },
  submitOff:   { opacity: 0.5 },
  submitText:  { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
});
