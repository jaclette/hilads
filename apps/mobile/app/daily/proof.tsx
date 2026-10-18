import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
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
import { ApiError } from '@/api/client';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { AndroidCameraCapture } from '@/features/chat/AndroidCameraCapture';
import { PlaceStep, type PlaceChoice, type Position } from '@/features/proof/PlaceStep';
import { distance } from '@/features/today/format';
import { defaultCurrency } from '@/features/daily/currency';
import { dailyTrackProps } from '@/features/daily/track';
import type { DailyProof, DailyProofInput, DailyToday } from '@/types';

/** A position older than this is refreshed before posting (the distance check). */
const POSITION_MAX_AGE_MS = 2 * 60 * 1000;

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
type Step = 'place' | 'photo' | 'details';
type TooFar = { distanceM: number; radiusM: number };

/**
 * Daily Challenge proof (SPEC 9.4, V3-08), in steps: the photo first (camera
 * only, opened right away from "I'm in"), then for place themes the place
 * suggested from my GPS position (an existing Hilads spot within 100 m, or a
 * new place at my position), then the caption and price. Language proofs
 * skip the place. The backend checks I'm within 150 m of the spot; "too far"
 * lets me retry from where I am or pick another place. /daily/proof creates,
 * /daily/proof?edit=<id> edits. Every proof goes to review.
 */
export default function DailyProofScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { account, city, identity } = useApp();

  const [today, setToday]       = useState<DailyToday | null>(null);
  const [original, setOriginal] = useState<DailyProof | null>(null);
  const [loading, setLoading]   = useState(true);
  const [step, setStep]         = useState<Step>('photo');
  const [place, setPlace]       = useState<PlaceChoice | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [photo, setPhoto]       = useState<Photo | null>(null);
  const [caption, setCaption]   = useState('');
  const [amount, setAmount]     = useState('');
  const [currency, setCurrency] = useState(defaultCurrency(city?.country));
  const [androidCamera, setAndroidCamera] = useState(false);
  const [sending, setSending]   = useState(false);
  const [tooFar, setTooFar]     = useState<TooFar | null>(null);
  const started = useRef(false);
  const autoCamera = useRef(false);   // open the camera once the challenge is loaded (new proof)

  // Proofs need an account (AUDIT Q4).
  useEffect(() => {
    if (!account) router.replace('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never);
  }, [account, router]);

  const themeKey = today?.challenge?.theme?.key ?? null;
  const needsPlace = themeKey !== null && themeKey !== 'language';

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
          setStep('details');
        } else {
          // Camera first (SPEC 9.3: the button opens it right away); the place comes after.
          setStep('photo');
          autoCamera.current = true;
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

  // ── Photo: camera only (SPEC 9.4) ────────────────────────────────────────
  const takePhoto = async () => {
    // Android: in-app camera (launchCameraAsync hangs on Android 14 + singleTask).
    if (Platform.OS === 'android') { setAndroidCamera(true); return; }
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.status !== 'granted') { Alert.alert(t('proof.permCameraTitle'), t('proof.permCameraBody')); return; }
    const pick = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, cameraType: ImagePicker.CameraType.back });
    if (!pick.canceled && pick.assets?.[0]) gotPhoto({ uri: pick.assets[0].uri, mime: pick.assets[0].mimeType ?? null, remoteUrl: null });
  };
  const gotPhoto = (p: Photo) => {
    setPhoto(p);
    // Place themes: the place, suggested from where I am, comes right after the photo.
    setStep(needsPlace && !place && !original ? 'place' : 'details');
  };

  const onPlace = (choice: PlaceChoice, pos: Position) => {
    setPlace(choice);
    setPosition(pos);
    setTooFar(null);
    setStep(photo ? 'details' : 'photo');
  };

  useEffect(() => {
    if (loading || !autoCamera.current || !today?.challenge?.isActive) return;
    autoCamera.current = false;
    takePhoto();
  }, [loading, today]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The position to send: the place step's, refreshed when it is old. */
  const freshPosition = async (force = false): Promise<Position | null> => {
    if (!force && position && Date.now() - position.at < POSITION_MAX_AGE_MS) return position;
    const geo = await requestFeatureLocation('challenge_proof', { precise: true });
    if (!geo.ok || !geo.coords) return null;
    const pos = { ...geo.coords, accuracy: geo.accuracy ?? null, at: Date.now() };
    setPosition(pos);
    return pos;
  };

  // ── Submit ───────────────────────────────────────────────────────────────
  const submit = async (forcePosition = false) => {
    if (sending) return;
    if (!photo) { Alert.alert(t('proof.photoRequired')); return; }
    if (needsPlace && !place && !original) { setStep('place'); return; }
    const parsedAmount = parseAmount(amount);
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0 || !/^[A-Z]{3}$/.test(currency))) {
      Alert.alert(t('errors.invalid_price')); return;
    }

    setSending(true);
    setTooFar(null);
    try {
      const input: DailyProofInput = {
        caption: caption.trim() === '' ? null : caption.trim(),
        price:   parsedAmount === null ? null : { amount: parsedAmount, currency },
      };
      // The place, in the V3 format (V3-02). An edit that keeps its place sends none.
      if (needsPlace && place) {
        const pos = await freshPosition(forcePosition);
        if (!pos) { Alert.alert(t('place.failedTitle'), t('place.failedBody')); return; }
        input.position = { lat: pos.lat, lng: pos.lng };
        if (place.kind === 'spot') input.spotId = place.spot.id;
        else input.newPlace = { name: place.name };
      }
      const photoUrl = photo.remoteUrl ?? (await uploadFile(photo.uri, photo.mime)).url;
      if (!original || photoUrl !== original.photoUrl) input.photoUrl = photoUrl;
      // The upload is done: keep it if a retry is needed.
      if (!photo.remoteUrl) setPhoto({ ...photo, remoteUrl: photoUrl });

      const saved = original ? await updateDailyProof(original.id, input) : await createDailyProof(input);
      track('daily_proof_posted', {
        ...dailyTrackProps({ challenge: today?.challenge ?? null, city: today?.city ?? null, myProof: saved }, account?.mode),
        edit: !!original, has_caption: !!input.caption, has_price: !!input.price,
        has_place: !!saved.spot, new_place: input.newPlace !== undefined,
      });

      // An existing spot shows on the map at once; a new place after review.
      const spot = saved.spot ?? null;
      const next = spot && !spot.inReview ? `/(tabs)/map?spot=${spot.id}&source=proof` : '/(tabs)/today';
      if (original) { router.replace(next as never); return; }
      // In-context push ask after the first proof (AUDIT Q9), once, then go on.
      const afterProof = async (to: string) => {
        const done = await AsyncStorage.getItem(FIRST_PROOF_KEY).catch(() => null);
        if (!done) {
          await AsyncStorage.setItem(FIRST_PROOF_KEY, '1').catch(() => {});
          await askDailyPush('first_proof', identity?.guestId);
        }
        router.replace(to as never);
      };
      // "Propose a challenge" nudge (V2-06), at most once a week.
      const lastNudge = Number(await AsyncStorage.getItem(PROPOSE_NUDGE_KEY).catch(() => null)) || 0;
      const nudge = Date.now() - lastNudge > PROPOSE_NUDGE_EVERY_MS;
      if (nudge) AsyncStorage.setItem(PROPOSE_NUDGE_KEY, String(Date.now())).catch(() => {});
      const body = spot?.inReview ? `${t('proof.sentBody')}\n\n${t('place.newOnMapLater')}` : t('proof.sentBody');
      Alert.alert(t('proof.sentTitle'), body, [
        ...(nudge ? [{ text: t('propose.cta'), onPress: () => afterProof('/daily/propose?source=after_proof') }] : []),
        { text: t('proof.ok'), onPress: () => afterProof(next) },
      ]);
    } catch (err) {
      const code = dailyErrorCode(err);
      if (code === 'too_far' && err instanceof ApiError) {
        const far = { distanceM: Number(err.body?.distanceM ?? 0), radiusM: Number(err.body?.radiusM ?? 150) };
        setTooFar(far);
        track('proof_too_far', { distance_m: far.distanceM, radius_m: far.radiusM, theme: themeKey });
        return;
      }
      if (code === 'place_not_found' || code === 'place_required') { setPlace(null); setStep('place'); }
      Alert.alert(code ? t(`errors.${code}`, { defaultValue: t('errors.generic') }) : t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  const challenge = today?.challenge ?? null;
  const closed = !loading && (!challenge || (original !== null && !challenge.isActive));
  const placeName = place ? (place.kind === 'spot' ? place.spot.name : place.name) : original?.spot?.name ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.nav}>
        <TouchableOpacity
          style={styles.back}
          onPress={() => (step === 'details' && !original && needsPlace ? setStep('place')
            : step === 'place' && photo ? setStep('photo') : router.back())}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>{original ? t('proof.titleEdit') : t('proof.titleNew')}</Text>
      </View>
      {challenge && !loading && !closed && <Text style={styles.challenge} numberOfLines={3}>{challenge.text}</Text>}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : closed ? (
        <View style={styles.center}><Text style={styles.muted}>{challenge ? t('proof.editOnlyActive') : t('errors.no_active_challenge')}</Text></View>
      ) : step === 'place' ? (
        <PlaceStep theme={themeKey} onPicked={onPlace} />
      ) : step === 'photo' ? (
        <View style={styles.center}>
          <View style={styles.icon}><Ionicons name="camera-outline" size={32} color={colors.primaryOnTint} /></View>
          <Text style={styles.stepTitle}>{t('proof.takeTitle')}</Text>
          {placeName && <Text style={styles.muted}>{t('place.at', { name: placeName })}</Text>}
          <TouchableOpacity style={styles.cta} onPress={takePhoto} accessibilityRole="button">
            <Ionicons name="camera" size={20} color={colors.white} />
            <Text style={styles.ctaText}>{t('proof.camera')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {photo && (
              <View style={styles.photoWrap}>
                <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
                <TouchableOpacity style={styles.retake} onPress={takePhoto} accessibilityRole="button">
                  <Ionicons name="camera-outline" size={18} color={colors.text} />
                  <Text style={styles.retakeText}>{t('proof.retake')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {needsPlace && (
              <View style={styles.placeRow}>
                <Ionicons name="location-outline" size={20} color={colors.primaryText} />
                <Text style={styles.placeName} numberOfLines={1}>{placeName ?? t('place.none')}</Text>
                <TouchableOpacity onPress={() => setStep('place')} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.link}>{t('place.change')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {tooFar && (
              <View style={styles.tooFar} accessibilityRole="alert">
                <Text style={styles.tooFarText}>
                  {t('place.tooFar', { distance: distance(tooFar.distanceM, i18n.language), name: placeName ?? '', radius: tooFar.radiusM })}
                </Text>
                <View style={styles.tooFarActions}>
                  <TouchableOpacity style={[styles.smallBtn, styles.smallPrimary]} onPress={() => submit(true)} accessibilityRole="button">
                    <Text style={styles.smallPrimaryText}>{t('place.tryAgain')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallBtn} onPress={() => { setTooFar(null); setPlace(null); setStep('place'); }} accessibilityRole="button">
                    <Text style={styles.smallBtnText}>{t('place.pickAnother')}</Text>
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
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={[styles.submit, (!photo || sending) && styles.submitOff]} onPress={() => submit()} disabled={sending} accessibilityRole="button">
              {sending ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitText}>{original ? t('proof.save') : t('proof.submit')}</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      <AndroidCameraCapture
        visible={androidCamera}
        onCapture={uri => { setAndroidCamera(false); gotPhoto({ uri, mime: 'image/jpeg', remoteUrl: null }); }}
        onClose={() => setAndroidCamera(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  flex:        { flex: 1 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: 12 },
  nav:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  back:        { width: 44, height: 44, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  challenge:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted, paddingHorizontal: Spacing.md, paddingBottom: 6 },
  icon:        { width: 64, height: 64, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center' },
  stepTitle:   { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, textAlign: 'center' },
  cta:         { alignSelf: 'stretch', flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  ctaText:     { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
  body:        { padding: Spacing.md, gap: 8, paddingBottom: 30 },
  photoWrap:   { gap: 8 },
  photo:       { width: '100%', aspectRatio: 1, borderRadius: 18, backgroundColor: c.bg3 },
  retake:      { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  retakeText:  { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  placeRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line },
  placeName:   { flex: 1, fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  tooFar:      { gap: 10, padding: 14, borderRadius: 16, backgroundColor: c.primaryTint },
  tooFarText:  { fontSize: FontSizes.sm, fontWeight: '600', color: c.primaryOnTint },
  tooFarActions: { flexDirection: 'row', gap: 8 },
  smallBtn:    { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, paddingHorizontal: 8 },
  smallBtnText:{ fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  smallPrimary:{ backgroundColor: c.primary, borderColor: c.primary },
  smallPrimaryText: { fontSize: FontSizes.sm, fontWeight: '700', color: c.white },
  label:       { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, marginTop: 10 },
  input:       { backgroundColor: c.bg2, borderWidth: 1.5, borderColor: c.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: FontSizes.sm, color: c.text },
  counter:     { alignSelf: 'flex-end', fontSize: 12, color: c.muted },
  counterNear: { color: c.primaryText, fontWeight: '700' },
  priceRow:    { flexDirection: 'row', gap: 8 },
  currency:    { width: 84, textAlign: 'center', fontWeight: '700' },
  muted:       { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  footer:      { padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg },
  submit:      { backgroundColor: c.primary, borderRadius: 16, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  submitOff:   { opacity: 0.5 },
  submitText:  { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
});
