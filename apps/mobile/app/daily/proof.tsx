import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, ScrollView,
  Text, TextInput, TouchableOpacity, View, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/core';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { askDailyPush } from '@/services/push';
import { uploadFile } from '@/api/uploads';
import { createDailyProof, dailyErrorCode, fetchDailyProof, fetchDailyToday, fetchDailyTodayCountries, updateDailyProof } from '@/api/daily';
import * as Haptics from 'expo-haptics';
import { Confetti } from '@/ui/joy';
import { ApiError } from '@/api/client';
import { requestFeatureLocation } from '@/lib/geoFeature';
import { DualCamera, dualPreferred, type DualShot } from '@/features/daily/DualCamera';
import { StickerStep } from '@/features/event/StickerStep';
import { AndroidCameraCapture } from '@/features/chat/AndroidCameraCapture';
import { fetchAppConfig } from '@/api/appConfig';
import { PlaceStep, type PlaceChoice, type Position } from '@/features/proof/PlaceStep';
import { distance } from '@/features/today/format';
import { defaultCurrency } from '@/features/daily/currency';
import { dailyTrackProps } from '@/features/daily/track';
import { isPlaceTheme } from '@/features/daily/themes';
import { SharePanel } from '@/features/share/SharePanel';
import { proofShare, representShare, type ShareContent } from '@/features/share/content';
import { ShareSheet } from '@/features/share/ShareSheet';
import { shortCityName } from '@/i18n/cityName';
import { Button, CityFlag, DualPhoto, TextField } from '@/ui';
import { AnswerInput } from '@/features/compare/AnswerInput';
import { HomeCityPicker } from '@/features/compare/HomeCityPicker';
import { answerValue, draftFrom, emptyDraft, hhmm, type AnswerDraft } from '@/features/compare/format';
import type { DailyProof, DailyProofInput, DailyToday, HomeCityRef } from '@/types';
import { goBack as leave } from '@/lib/nav';
import { KeyboardForm, useNextField } from '@/ui/keyboard';
import { BatBurst, SeasonalScope } from '@/features/event/SeasonalArt';
import { setSeasonalEvent, useEventFeature, useSeasonalLive } from '@/features/event/seasonal';

/** A position older than this is refreshed before posting (the distance check). */
const POSITION_MAX_AGE_MS = 2 * 60 * 1000;

const CAPTION_MAX = 140;
const HOME_LINE_MAX = 80;

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
type Step = 'place' | 'photo' | 'answer' | 'details' | 'home';
/** Back home's fields; answerSet = the answer was given (a time wheel always holds a value). */
type HomeDraft = { answer: AnswerDraft; answerSet: boolean; amount: string; currency: string; line: string };
type TooFar = { distanceM: number; radiusM: number };

/**
 * Daily Challenge proof (SPEC 9.4, V3-08), in steps: the photo first (camera
 * only, opened right away from "I'm in"), then for place themes the place
 * suggested from my GPS position (an existing Hilads spot within 100 m, or a
 * new place at my position), then the answer to the comparison question
 * (SPEC 10.2, required when the challenge has one), the caption and price,
 * and "And back home?" (10.4, optional: the same question for my home city).
 * A special day's proofs skip the place. The backend checks I'm within 150 m of the spot; "too far"
 * lets me retry from where I am or pick another place. /daily/proof creates,
 * /daily/proof?edit=<id> edits. Every proof goes to review.
 */
// A seasonal event's live look (Halloween...) re-colors the screen.
export default function DailyProofScreen() {
  return <SeasonalScope><DailyProofScreenContent /></SeasonalScope>;
}

function DailyProofScreenContent() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { account, city, identity, setAccount } = useApp();
  const seasonal = useSeasonalLive();

  const [today, setToday]       = useState<DailyToday | null>(null);
  const [original, setOriginal] = useState<DailyProof | null>(null);
  const [loading, setLoading]   = useState(true);
  const [step, setStep]         = useState<Step>('photo');
  const [place, setPlace]       = useState<PlaceChoice | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [photo, setPhoto]       = useState<Photo | null>(null);
  const [invite, setInvite]     = useState<ShareContent | null>(null);
  const [sent, setSent]         = useState<{ proof: DailyProof; body: string; next: string; nudge: boolean; cityFirst: boolean } | null>(null);
  const [citiesToday, setCitiesToday] = useState<number | null>(null);
  const [caption, setCaption]   = useState('');
  const [amount, setAmount]     = useState('');
  const [currency, setCurrency] = useState(defaultCurrency(city?.country));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [androidCamera, setAndroidCamera] = useState(false);
  const [dualEnabled, setDualEnabled] = useState(false);
  // iOS hybrid and Add your face: the photo the selfie goes with (the camera opens on the selfie).
  const [selfieFor, setSelfieFor] = useState<string | null>(null);
  // Event mode: the sticker step after a new photo (Halloween's pack, or the event's remote one).
  const stickerEvent = useEventFeature('stickers');
  const hasPack = !!stickerEvent && (stickerEvent.key === 'halloween' || (stickerEvent.event.stickers?.length ?? 0) > 0);
  const [stickersOpen, setStickersOpen] = useState(false);
  const afterCapture = () => { if (hasPack) setStickersOpen(true); };
  // Dual photo: the selfie taken right after the photo (null: the photo alone).
  const [selfie, setSelfie]     = useState<Photo | null>(null);
  const [sending, setSending]   = useState(false);
  const [tooFar, setTooFar]     = useState<TooFar | null>(null);
  const [answer, setAnswer]     = useState<AnswerDraft>(emptyDraft());
  const [home, setHome]         = useState<HomeCityRef | null>(account?.home_city_ref ?? null);
  const [homeDraft, setHomeDraft] = useState<HomeDraft>({ answer: emptyDraft(), answerSet: false, amount: '', currency: '', line: '' });
  const [homePicker, setHomePicker] = useState(false);
  const started = useRef(false);
  const autoCamera = useRef(false);   // open the camera once the challenge is loaded (new proof)

  // Proofs need an account (AUDIT Q4).
  useEffect(() => {
    if (!account) router.replace('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Fproof' as never);
  }, [account, router]);

  const themeKey = today?.challenge?.theme?.key ?? null;
  const needsPlace = isPlaceTheme(themeKey);
  const compare = today?.challenge?.compare ?? null;
  // Back home (SPEC 10.4): my home city differs from the proof's city, or I'm
  // exploring without one yet. An edit that already has one shows it too.
  const proofCityId = original?.city?.id ?? today?.here?.id ?? null;   // a new proof is posted for where I am
  const showHome = !!original?.backHome
    || (home ? home.id === null || home.id !== proofCityId : account?.mode === 'exploring');

  // Back (the navigation rule): every way out (Android back, the arrow, the iOS
  // swipe) goes one step back - home → details → answer → place → photo - and,
  // on the first step, asks before throwing away a new photo. Leaving after a
  // post (leaving.current) is never held.
  const navigation = useNavigation();
  const leaving = useRef(false);
  const stepBack = (): boolean => {
    if (step === 'home') setStep('details');
    else if (step === 'details' && compare) setStep('answer');
    else if ((step === 'details' || step === 'answer') && !original && needsPlace) setStep('place');
    else if (step === 'place' && photo) setStep('photo');
    else return false;
    return true;
  };
  const canStepBack = step === 'home' || (step === 'details' && !!compare)
    || ((step === 'details' || step === 'answer') && !original && needsPlace) || (step === 'place' && !!photo);
  const unsaved = !sent && !original && !!photo;
  // Next / Done on the raw fields (TextField has it built in).
  const captionRef = useRef<TextInput>(null);
  const amountRef = useRef<TextInput>(null);
  const currencyRef = useRef<TextInput>(null);
  const homeAmountRef = useRef<TextInput>(null);
  const homeCurrencyRef = useRef<TextInput>(null);
  const captionNext = useNextField(captionRef);
  const amountNext = useNextField(amountRef);
  const currencyNext = useNextField(currencyRef);
  const homeAmountNext = useNextField(homeAmountRef);
  const homeCurrencyNext = useNextField(homeCurrencyRef);
  usePreventRemove(canStepBack || unsaved, ({ data }) => {
    if (leaving.current || stepBack()) {
      if (leaving.current) navigation.dispatch(data.action);
      return;
    }
    Alert.alert(t('proof.discardTitle'), t('proof.discardBody'), [
      { text: t('proof.keepEditing'), style: 'cancel' },
      { text: t('proof.discard'), style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let [d, p, config] = await Promise.all([
          fetchDailyToday(city?.channelId),
          edit ? fetchDailyProof(edit) : Promise.resolve(null),
          // The dual photo switch, known before the camera opens (a failure or 3 s without an answer: off).
          Promise.race([fetchAppConfig().catch(() => null), new Promise<null>(r => setTimeout(() => r(null), 3000))]),
        ]);
        if (!alive) return;
        setDualEnabled(config?.dualPhoto === true);
        setToday(d);
        setSeasonalEvent(d.event);
        // Already posted today: "new proof" edits that one instead.
        if (!p && d.myProof && d.myProof.status !== 'removed') p = d.myProof;
        if (p) {
          setOriginal(p);
          setPhoto({ uri: p.photoUrl, mime: null, remoteUrl: p.photoUrl });
          setSelfie(p.selfieUrl ? { uri: p.selfieUrl, mime: null, remoteUrl: p.selfieUrl } : null);
          setCaption(p.caption ?? '');
          if (p.price) { setAmount(String(p.price.amount)); setCurrency(p.price.currency); }
          setAnswer(draftFrom(p.answer));
          if (p.backHome) {
            setHome(p.backHome.city);
            setHomeDraft({
              answer: draftFrom(p.backHome.answer), answerSet: !!p.backHome.answer, line: p.backHome.line ?? '',
              amount: p.backHome.price ? String(p.backHome.price.amount) : '',
              currency: p.backHome.price?.currency ?? defaultCurrency(p.backHome.city.country),
            });
          }
          setStep(d.challenge?.compare ? 'answer' : 'details');
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
  // Dual photo on (remote switch, Admin › App versions): our camera on both
  // platforms, the photo then the selfie (the system camera can't chain one).
  // Off: the previous capture, unchanged.
  const takePhoto = async () => {
    if (dualEnabled) {
      // Android: our camera for both. iOS (hybrid): the system camera for the photo (lenses,
      // macro, tap-to-focus, HDR), then ours opens on the selfie at once. A cancel posts nothing.
      if (Platform.OS === 'android') { setSelfieFor(null); setCameraOpen(true); return; }
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') { Alert.alert(t('proof.permCameraTitle'), t('proof.permCameraBody')); return; }
      const pick = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, cameraType: ImagePicker.CameraType.back });
      if (pick.canceled || !pick.assets?.[0]) return;
      const uri = pick.assets[0].uri;
      if (!(await dualPreferred())) {   // Dual turned off by the person: the photo alone
        setSelfie(null);
        gotPhoto({ uri, mime: pick.assets[0].mimeType ?? null, remoteUrl: null });
        afterCapture();
        return;
      }
      setSelfieFor(uri);
      setCameraOpen(true);
      return;
    }
    // Android: in-app camera (launchCameraAsync hangs on Android 14 + singleTask).
    if (Platform.OS === 'android') { setAndroidCamera(true); return; }
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.status !== 'granted') { Alert.alert(t('proof.permCameraTitle'), t('proof.permCameraBody')); return; }
    const pick = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, cameraType: ImagePicker.CameraType.back });
    if (!pick.canceled && pick.assets?.[0]) {
      setSelfie(null);   // a new photo from the single camera never keeps an earlier selfie
      gotPhoto({ uri: pick.assets[0].uri, mime: pick.assets[0].mimeType ?? null, remoteUrl: null });
      afterCapture();
    }
  };
  const gotShot = (shot: DualShot) => {
    setCameraOpen(false);
    // Add your face on a photo already there: only the selfie changes.
    if (photo && shot.main === photo.uri) {
      setSelfie(shot.selfie ? { uri: shot.selfie, mime: 'image/jpeg', remoteUrl: null } : null);
      return;
    }
    setSelfie(shot.selfie ? { uri: shot.selfie, mime: 'image/jpeg', remoteUrl: null } : null);
    gotPhoto({ uri: shot.main, mime: 'image/jpeg', remoteUrl: null });
    afterCapture();
  };
  /** After the photo and the place: the question when there is one, else the caption and price. */
  const afterPlace: Step = compare ? 'answer' : 'details';
  const gotPhoto = (p: Photo) => {
    setPhoto(p);
    // Place themes: the place, suggested from where I am, comes right after the photo.
    // Retaking the photo from a later step stays on that step.
    setStep(prev => (needsPlace && !place && !original ? 'place' : prev === 'photo' ? afterPlace : prev));
  };

  const onPlace = (choice: PlaceChoice, pos: Position) => {
    setPlace(choice);
    setPosition(pos);
    setTooFar(null);
    setStep(photo ? afterPlace : 'photo');
  };

  const answerReady = !compare || answerValue(compare.type, answer) !== null;
  const pickHome = (c: HomeCityRef) => {
    setHomePicker(false);
    setHome(c);
    setHomeDraft(d => ({ ...d, currency: defaultCurrency(c.country) }));
  };
  /** The Back home body, or undefined when nothing was filled in. */
  const backHomeInput = (): DailyProofInput['backHome'] | undefined => {
    if (!home) return undefined;
    const a = compare && homeDraft.answerSet ? answerValue(compare.type, homeDraft.answer) : null;
    const answerSet = a !== null;
    const amount = parseAmount(homeDraft.amount);
    const line = homeDraft.line.replace(/\s+/g, ' ').trim();
    if (!answerSet && amount === null && line === '') return undefined;
    return {
      city: home.id !== null ? { id: home.id } : { name: home.name, country: home.country },
      answer: answerSet ? a : null,
      price: amount !== null && Number.isFinite(amount) && amount >= 0 && /^[A-Z]{3}$/.test(homeDraft.currency)
        ? { amount, currency: homeDraft.currency } : null,
      line: line === '' ? null : line,
    };
  };
  /** From the caption and price: Back home when it applies, else post. */
  const afterDetails = () => {
    const parsedAmount = parseAmount(amount);
    if (parsedAmount !== null && (!Number.isFinite(parsedAmount) || parsedAmount < 0 || !/^[A-Z]{3}$/.test(currency))) {
      Alert.alert(t('errors.invalid_price')); return;
    }
    if (showHome) {
      if (!home) setHomePicker(true);
      setStep('home');
    } else {
      submit();
    }
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
  const submit = async (forcePosition = false, withHome = true) => {
    if (sending) return;
    if (!photo) { Alert.alert(t('proof.photoRequired')); return; }
    if (needsPlace && !place && !original) { setStep('place'); return; }
    if (!answerReady) { setStep('answer'); return; }
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
      if (compare) input.answer = answerValue(compare.type, answer);
      // Back home: skipped = nothing sent (an edit keeps its block); emptied on an edit = removed.
      const backHome = withHome && step === 'home' ? backHomeInput() : undefined;
      if (backHome) input.backHome = backHome;
      else if (withHome && step === 'home' && original?.backHome) input.backHome = null;
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
      // The selfie, in the same post (atomic): sent when new, changed or removed.
      const selfieUrl = selfie ? selfie.remoteUrl ?? (await uploadFile(selfie.uri, selfie.mime)).url : null;
      if (selfie && !selfie.remoteUrl && selfieUrl) setSelfie({ ...selfie, remoteUrl: selfieUrl });
      if (original ? (original.selfieUrl ?? null) !== selfieUrl : selfieUrl !== null) input.selfieUrl = selfieUrl;

      let cityFirst = false;
      let saved: DailyProof;
      if (original) {
        saved = await updateDailyProof(original.id, input);
      } else {
        const created = await createDailyProof(input);
        saved = created.proof;
        cityFirst = created.cityFirstToday;
      }
      track('daily_proof_posted', {
        ...dailyTrackProps({ challenge: today?.challenge ?? null, city: today?.city ?? null, myProof: saved }, account?.mode),
        edit: !!original, has_caption: !!input.caption, has_price: !!input.price,
        has_place: !!saved.spot, new_place: input.newPlace !== undefined, has_answer: input.answer != null,
      });
      if (compare && input.answer != null) track('compare_answer_posted', { type: compare.type, edit: !!original });
      if (input.backHome) {
        track('back_home_added', {
          has_answer: input.backHome.answer != null, has_price: !!input.backHome.price, has_line: !!input.backHome.line,
          home_city_known: 'id' in input.backHome.city ? 'id' : 'custom', edit: !!original,
        });
        // The server remembers the first Back home city as my home city: so does the app.
        if (account && !account.home_city_ref && home) setAccount({ ...account, home_city_ref: home });
      }

      // An existing spot shows on the map at once; a new place after review.
      const spot = saved.spot ?? null;
      const next = spot && !spot.inReview ? `/(tabs)/map?spot=${spot.id}&source=proof` : '/(tabs)/today';
      if (original) { leaving.current = true; router.replace(next as never); return; }
      // "Propose a challenge" nudge (V2-06), at most once a week.
      const lastNudge = Number(await AsyncStorage.getItem(PROPOSE_NUDGE_KEY).catch(() => null)) || 0;
      const nudge = Date.now() - lastNudge > PROPOSE_NUDGE_EVERY_MS;
      if (nudge) AsyncStorage.setItem(PROPOSE_NUDGE_KEY, String(Date.now())).catch(() => {});
      const body = spot?.inReview ? `${t('proof.sentBody')}\n\n${t('place.newOnMapLater')}` : t('proof.sentBody');
      setSent({ proof: saved, body, next, nudge, cityFirst });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // How many cities are on today's board with mine (the celebration's line).
      fetchDailyTodayCountries({ cityId: saved.city?.id ?? null }).then(d => setCitiesToday(d.cityCount ?? d.items.length)).catch(() => {});
    } catch (err) {
      const code = dailyErrorCode(err);
      if (code === 'too_far' && err instanceof ApiError) {
        const far = { distanceM: Number(err.body?.distanceM ?? 0), radiusM: Number(err.body?.radiusM ?? 150) };
        setTooFar(far);
        track('proof_too_far', { distance_m: far.distanceM, radius_m: far.radiusM, theme: themeKey });
        return;
      }
      if (code === 'place_not_found' || code === 'place_required') { setPlace(null); setStep('place'); }
      if (code === 'answer_required' || code === 'invalid_answer') setStep('answer');
      if (code === 'invalid_back_home') setStep('home');
      Alert.alert(code ? t(`errors.${code}`, { defaultValue: t('errors.generic') }) : t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  // In-context push ask after the first proof (AUDIT Q9), once, then go on.
  const afterProof = async (to: string) => {
    const done = await AsyncStorage.getItem(FIRST_PROOF_KEY).catch(() => null);
    if (!done) {
      await AsyncStorage.setItem(FIRST_PROOF_KEY, '1').catch(() => {});
      await askDailyPush('first_proof', identity?.guestId);
    }
    leaving.current = true;
    router.replace(to as never);
  };

  const challenge = today?.challenge ?? null;

  // Sent (SPEC 9.14): the confirmation, then the share card and where to share it.
  if (sent && challenge) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="proof-screen">
        <ScrollView contentContainerStyle={styles.sent}>
          {/* A seasonal event's live day: a burst of bats instead of the checkmark. */}
          {seasonal?.key === 'halloween' ? <BatBurst />
            : <View style={styles.icon}><Ionicons name="checkmark" size={32} color={colors.primaryOnTint} /></View>}
          {/* My city is on today's board (V3 polish 7): its flag, a burst of confetti, how many cities play with it. */}
          <View style={styles.boardRow}>
            {!!sent.proof.city?.country && <CityFlag country={sent.proof.city.country} size={22} />}
            <Text style={styles.stepTitle} accessibilityRole="header">
              {sent.proof.city?.name
                ? t(seasonal?.key === 'halloween' ? 'event.halloween.onBoard' : 'proof.onBoard', { city: shortCityName(sent.proof.city.name) })
                : t('proof.sentTitleNoCity')}
            </Text>
          </View>
          {citiesToday !== null && citiesToday > 1 && <Text style={styles.boardSub}>{t('proof.citiesToday', { count: citiesToday })}</Text>}
          <Text style={styles.muted}>{sent.body}</Text>
          {/* On the map at once (an existing spot): its link. */}
          {sent.next.startsWith('/(tabs)/map') && (
            <Button variant="link" icon="location-outline" label={t('proof.onMap')} onPress={() => afterProof(sent.next)} />
          )}
          {/* Represent your city (SPEC 9.16): the city's first proof of the day. */}
          {sent.cityFirst && !!sent.proof.city?.name && (
            <View style={styles.firstCity}>
              <CityFlag country={sent.proof.city.country} size={18} />
              <Text style={styles.firstCityText}>{t('represent.firstPosted', { city: shortCityName(sent.proof.city.name) })}</Text>
            </View>
          )}
          <Text style={styles.sentShare}>{t('share.afterProof')}</Text>
          <SharePanel content={proofShare(sent.proof, challenge)} source="after_proof" previewHeight={320} />
          {sent.cityFirst && !!sent.proof.city?.name && (
            <Button variant="link" icon="paper-plane-outline" label={t('represent.invite')}
                    onPress={() => setInvite(representShare(challenge, sent.proof.city!))} />
          )}
        </ScrollView>
        <ShareSheet content={invite} source="represent_after_proof" onClose={() => setInvite(null)} />
        {seasonal?.key !== 'halloween' && <Confetti run />}
        <View style={styles.footer}>
          {/* Votes go to the other cities: straight to how the world answered (COPY.md). */}
          <Text style={styles.votesNext}>{t('vote.afterPost')}</Text>
          {/* Compare now: the world's cities side by side (the compare view). */}
          <Button icon="earth-outline" label={t('proof.compareNow')} onPress={() => afterProof('/daily/countries?source=after_proof')} />
          {sent.nudge && <Button variant="link" label={t('propose.cta')} onPress={() => afterProof('/daily/propose?source=after_proof')} />}
        </View>
      </SafeAreaView>
    );
  }

  const closed = !loading && (!challenge || (original !== null && !challenge.isActive));
  const placeName = place ? (place.kind === 'spot' ? place.spot.name : place.name) : original?.spot?.name ?? null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="proof-screen">
      <View style={styles.nav}>
        <TouchableOpacity
          style={styles.back}
          onPress={leave}
          testID="header-back"
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
        <PlaceStep theme={themeKey === 'special' ? null : themeKey} onPicked={onPlace} />
      ) : step === 'answer' && compare ? (
        // The comparison question (SPEC 10.2): one quick screen, required.
        <KeyboardForm contentContainerStyle={styles.body} footer={(
            <View style={styles.footer}>
              <Button label={t('compare.next')} disabled={!answerReady} onPress={() => setStep('details')} testID="answer-next" />
            </View>
          )}>
          {photo ? (
            // My photo with today's question over it, and my answer appearing on it as I type.
            <View style={styles.qCard}>
              <DualPhoto main={{ uri: photo.uri }} selfie={selfie ? { uri: selfie.uri } : null} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']} locations={[0, 0.45, 1]} style={styles.qShade} />
              <View style={styles.qText}>
                <Text style={styles.qKicker}>{t('compare.kicker')}</Text>
                <Text style={styles.qQuestion} accessibilityRole="header">{compare.question}</Text>
                {!!draftLabel(answer, compare.type) && (
                  <View style={styles.qAnswer}><Text style={styles.qAnswerText} numberOfLines={1}>{draftLabel(answer, compare.type)}</Text></View>
                )}
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.kicker}>{t('compare.kicker')}</Text>
              <Text style={styles.question} accessibilityRole="header">{compare.question}</Text>
            </>
          )}
          <Text style={styles.questionSub}>{t('compare.sub')}</Text>
          <AnswerInput compare={compare} draft={answer} onChange={setAnswer} autoFocus={compare.type !== 'time'} />
        </KeyboardForm>
      ) : step === 'home' ? (
        // "And back home?" (SPEC 10.4): optional, skippable.
        <KeyboardForm contentContainerStyle={styles.body} footer={(
            <View style={[styles.footer, styles.footerRow]}>
              <Button variant="secondary" style={styles.flex} label={t('backHome.skip')} disabled={sending} onPress={() => submit(false, false)} />
              <Button style={styles.flex} loading={sending} label={original ? t('proof.save') : t('proof.submit')} onPress={() => submit()} />
            </View>
          )}>
          <Text style={styles.question} accessibilityRole="header">{t('backHome.title')}</Text>
          <TouchableOpacity style={styles.placeRow} onPress={() => setHomePicker(true)} accessibilityRole="button">
            {home ? <CityFlag country={home.country} size={20} /> : <Ionicons name="home-outline" size={20} color={colors.primaryText} />}
            <Text style={styles.placeName} numberOfLines={1}>
              {home ? t('backHome.homeIn', { city: shortCityName(home.name) }) : t('backHome.pickCity')}
            </Text>
            <Text style={styles.link}>{home ? t('place.change') : t('backHome.choose')}</Text>
          </TouchableOpacity>
          {home && (
            <>
              {compare && (
                <>
                  <Text style={styles.label}>{compare.question}</Text>
                  <AnswerInput compare={compare} draft={homeDraft.answer}
                               onChange={a => setHomeDraft(d => ({ ...d, answer: a, answerSet: true }))}
                               placeholder={t('backHome.answerPlaceholder', { city: shortCityName(home.name) })} />
                </>
              )}
              {parseAmount(amount) !== null && (
                <>
                  <Text style={styles.label}>{t('backHome.price', { city: shortCityName(home.name) })}</Text>
                  <View style={styles.priceRow}>
                    <TextInput
                      ref={homeAmountRef}
                      {...homeAmountNext}
                      style={[styles.input, styles.flex]}
                      value={homeDraft.amount}
                      onChangeText={v => setHomeDraft(d => ({ ...d, amount: v }))}
                      placeholder={t('proof.pricePlaceholder')}
                      placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                    />
                    <TextInput
                      ref={homeCurrencyRef}
                      {...homeCurrencyNext}
                      style={[styles.input, styles.currency]}
                      value={homeDraft.currency || defaultCurrency(home.country)}
                      onChangeText={v => setHomeDraft(d => ({ ...d, currency: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) }))}
                      autoCapitalize="characters"
                      maxLength={3}
                      accessibilityLabel="Currency"
                    />
                  </View>
                </>
              )}
              <Text style={styles.label}>{t('backHome.line')}</Text>
              <TextField
                value={homeDraft.line}
                testID="home-line"
                onChangeText={v => setHomeDraft(d => ({ ...d, line: v.replace(/\n/g, ' ').slice(0, HOME_LINE_MAX) }))}
                placeholder={t('backHome.linePlaceholder')}
                maxLength={HOME_LINE_MAX}
              />
              <Text style={[styles.counter, homeDraft.line.length > HOME_LINE_MAX - 10 && styles.counterNear]}>{homeDraft.line.length} / {HOME_LINE_MAX}</Text>
            </>
          )}
        </KeyboardForm>
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
        <KeyboardForm contentContainerStyle={styles.body} footer={(
            <View style={styles.footer}>
              <TouchableOpacity style={[styles.submit, (!photo || sending) && styles.submitOff]} onPress={afterDetails} disabled={sending} accessibilityRole="button">
                {sending ? <ActivityIndicator color={colors.white} />
                  : <Text style={styles.submitText}>{showHome ? t('compare.next') : original ? t('proof.save') : t('proof.submit')}</Text>}
              </TouchableOpacity>
            </View>
          )}>
          {photo && (
            <View style={styles.photoWrap}>
              <DualPhoto main={{ uri: photo.uri }} selfie={selfie ? { uri: selfie.uri } : null} style={styles.photo} />
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.retake} onPress={takePhoto} accessibilityRole="button">
                  <Ionicons name="camera-outline" size={18} color={colors.text} />
                  <Text style={styles.retakeText}>{t('proof.retake')}</Text>
                </TouchableOpacity>
                {/* Dual photo: a selfie for a photo without one. */}
                {dualEnabled && !selfie && (
                  <TouchableOpacity style={styles.retake} onPress={() => { setSelfieFor(photo.uri); setCameraOpen(true); }} accessibilityRole="button">
                    <Text style={styles.retakeText}>{t('dual.addFace')}</Text>
                  </TouchableOpacity>
                )}
              </View>
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
            testID="proof-caption"
            onChangeText={v => setCaption(v.replace(/\n/g, ' ').slice(0, CAPTION_MAX))}
            placeholder={t('proof.captionPlaceholder')}
            placeholderTextColor={colors.muted}
            maxLength={CAPTION_MAX}
            ref={captionRef}
            {...captionNext}
          />
          <Text style={[styles.counter, caption.length > CAPTION_MAX - 15 && styles.counterNear]}>{caption.length} / {CAPTION_MAX}</Text>

          <Text style={styles.label}>{compare?.priceLabel ? t('proof.priceFor', { label: compare.priceLabel }) : t('proof.price')}</Text>
          <View style={styles.priceRow}>
            <TextInput
              ref={amountRef}
              {...amountNext}
              style={[styles.input, styles.flex]}
              value={amount}
              testID="proof-amount"
              onChangeText={setAmount}
              placeholder={t('proof.pricePlaceholder')}
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
            />
            <TextInput
              ref={currencyRef}
              {...currencyNext}
              style={[styles.input, styles.currency]}
              value={currency}
              testID="proof-currency"
              onChangeText={v => setCurrency(v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))}
              autoCapitalize="characters"
              maxLength={3}
              accessibilityLabel="Currency"
            />
          </View>
        </KeyboardForm>
      )}

      <HomeCityPicker visible={homePicker} selected={home} onPick={pickHome} onClose={() => setHomePicker(false)} />

      {dualEnabled && (
        <DualCamera visible={cameraOpen} selfieFor={selfieFor} onCapture={gotShot} onClose={() => setCameraOpen(false)}
                    onRetakeMain={Platform.OS === 'ios' ? () => { setCameraOpen(false); setTimeout(takePhoto, 400); } : undefined}
                    night={today?.challenge?.theme?.key === 'night_out' || !!today?.challenge?.special?.id?.startsWith('halloween')} />
      )}
      {photo && stickersOpen && (
        <StickerStep visible main={photo.uri} selfie={selfie?.uri ?? null} remote={stickerEvent?.event.stickers}
                     onSkip={() => setStickersOpen(false)}
                     onDone={out => {
                       setStickersOpen(false);
                       if (out.main !== photo.uri) setPhoto({ uri: out.main, mime: 'image/jpeg', remoteUrl: null });
                       if (selfie && out.selfie && out.selfie !== selfie.uri) setSelfie({ uri: out.selfie, mime: 'image/jpeg', remoteUrl: null });
                     }} />
      )}
      <AndroidCameraCapture
        visible={androidCamera}
        onCapture={uri => { setAndroidCamera(false); setSelfie(null); gotPhoto({ uri, mime: 'image/jpeg', remoteUrl: null }); afterCapture(); }}
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
  boardRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  boardSub:     { fontSize: 15, fontWeight: '700', color: c.primaryText, textAlign: 'center' },
  cta:         { alignSelf: 'stretch', flexDirection: 'row', gap: 8, minHeight: 48, borderRadius: 16, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  ctaText:     { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
  body:        { padding: Spacing.md, gap: 8, paddingBottom: 30 },
  photoWrap:   { gap: 8 },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
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
  sent:        { alignItems: 'center', padding: Spacing.lg, gap: 12 },
  firstCity:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: c.primaryTint },
  firstCityText: { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryOnTint },
  sentShare:   { alignSelf: 'stretch', fontSize: FontSizes.md, fontWeight: '800', color: c.text, marginTop: 12 },
  link:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  footer:      { padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.bg },
  votesNext:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 10 },
  footerRow:   { flexDirection: 'row', gap: 10 },
  kicker:      { fontSize: FontSizes.xs, fontWeight: '800', color: c.primaryText, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 },
  question:    { fontSize: FontSizes.xl, lineHeight: 30, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
  questionSub: { fontSize: FontSizes.sm, color: c.muted, marginBottom: 10 },
  qCard:       { aspectRatio: 4 / 5, maxHeight: 420, borderRadius: 20, overflow: 'hidden', backgroundColor: c.bg3, justifyContent: 'flex-end', marginBottom: 6 },
  qShade:      { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%' },
  qText:       { padding: 16, gap: 4 },
  qKicker:     { fontSize: FontSizes.xs, fontWeight: '800', color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.9 },
  qQuestion:   { fontSize: 22, lineHeight: 27, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  qAnswer:     { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#FFFFFF' },
  qAnswerText: { color: '#2A1C13', fontSize: FontSizes.md, fontWeight: '800' },
  submit:      { backgroundColor: c.primary, borderRadius: 16, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  submitOff:   { opacity: 0.5 },
  submitText:  { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
});

/** The answer as it will read (the photo card's live preview): the text, or the time. */
function draftLabel(d: AnswerDraft, type: string): string {
  if (type === 'time') return hhmm(d.minutes);
  return d.text.trim();
}
