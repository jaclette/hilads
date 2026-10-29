import { useMemo, useRef, useState } from 'react';
import {
  Modal, PanResponder, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
  type LayoutChangeEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { captureRef } from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { ZoomIn, ZoomOut, useReducedMotion } from 'react-native-reanimated';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { Button } from '@/ui';
import { FRAMES, Frame, STICKERS, Sticker, type FrameId, type StickerId } from './stickers';

/**
 * The sticker step (event mode, Halloween first): after the photo, before the
 * caption. Tap a sticker to add it, drag it, pinch / twist with two fingers to
 * size and turn it, drop it on the trash to remove it; 10 at most; a frame
 * over the whole photo; "Spookify me 🎲" drops 3 at random. With dual photo,
 * the selfie gets its own stickers (Photo / Selfie). Done bakes them into the
 * image (view-shot, at the upload size: never bigger than the photo, 1600 px
 * at most); Skip keeps the photos as they are.
 */

export interface StickeredShot { main: string; selfie: string | null }

type Placed = { key: number; id: string; x: number; y: number; scale: number; rotation: number };
type Layer = { stickers: Placed[]; frame: FrameId | null };
type Which = 'main' | 'selfie';

const MAX = 10;
const BASE = 0.24;           // a sticker's size: this share of the photo's width at scale 1
const OUT_MAX = 1600;        // the upload's size (uploadFile downscales to it anyway)
const TRASH = 64;

export function StickerStep({ visible, main, selfie, remote, onDone, onSkip }: {
  visible: boolean;
  main: string;
  selfie: string | null;
  /** The event's remote pack (PNG URLs); empty: the bundled pack. */
  remote?: { id: string; url: string }[];
  onDone: (shot: StickeredShot) => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation('daily');
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [which, setWhich] = useState<Which>('main');
  const [layers, setLayers] = useState<Record<Which, Layer>>({ main: { stickers: [], frame: null }, selfie: { stickers: [], frame: null } });
  const [selected, setSelected] = useState<number | null>(null);
  const [ratio, setRatio] = useState<Record<Which, number>>({ main: 3 / 4, selfie: 3 / 4 });
  const [natural, setNatural] = useState<Record<Which, number>>({ main: OUT_MAX, selfie: OUT_MAX });
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [overTrash, setOverTrash] = useState(false);
  const [baking, setBaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canvas = useRef<View>(null);
  const seq = useRef(0);

  const pack = remote && remote.length > 0 ? remote.map(r => r.id) : STICKERS;
  const urlOf = useMemo(() => new Map((remote ?? []).map(r => [r.id, r.url])), [remote]);
  const layer = layers[which];
  const uri = which === 'main' ? main : selfie!;

  // The photo fits the area at its own ratio.
  const fit = (() => {
    if (!area.w || !area.h) return { w: 0, h: 0 };
    const r = ratio[which];
    return area.w / area.h > r ? { w: area.h * r, h: area.h } : { w: area.w, h: area.w / r };
  })();

  const update = (fn: (l: Layer) => Layer) => setLayers(ls => ({ ...ls, [which]: fn(ls[which]) }));

  /** A sticker's center over the trash (bottom center of the editor area). */
  const isOverTrash = (p: Placed) => {
    const x = (area.w - fit.w) / 2 + p.x * fit.w;
    const y = (area.h - fit.h) / 2 + p.y * fit.h;
    return Math.hypot(x - area.w / 2, y - (area.h - 8 - TRASH / 2)) < TRASH;
  };

  const add = (id: string, at?: Partial<Placed>) => {
    if (layer.stickers.length >= MAX) { setNotice(t('event.stickers.max', { count: MAX })); return; }
    const key = ++seq.current;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    update(l => ({ ...l, stickers: [...l.stickers, { key, id, x: 0.5, y: 0.45, scale: 1, rotation: 0, ...at }] }));
    setSelected(key);
  };

  const spookify = () => {
    const free = MAX - layer.stickers.length;
    const ids = pack.filter(id => id !== 'boo' && id !== 'trick');
    for (let i = 0; i < Math.min(3, free); i++) {
      add(ids[Math.floor(Math.random() * ids.length)], {
        x: 0.18 + Math.random() * 0.64, y: 0.15 + Math.random() * 0.6,
        scale: 0.75 + Math.random() * 0.6, rotation: (Math.random() - 0.5) * 50,
      });
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const remove = (key: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    update(l => ({ ...l, stickers: l.stickers.filter(s => s.key !== key) }));
    setSelected(null);
  };

  /** Bake one image's stickers and frame (a view-shot of the canvas). */
  const bake = async (w: Which): Promise<string> => {
    const l = layers[w];
    const src = w === 'main' ? main : selfie!;
    if (l.stickers.length === 0 && !l.frame) return src;
    if (w !== which) {
      setWhich(w);
      await new Promise(r => setTimeout(r, 250));   // the canvas shows that image
    }
    const r = ratio[w];
    const outW = Math.min(OUT_MAX, natural[w]);
    const outH = Math.round(outW / r);
    // view-shot sizes are points on iOS, pixels on Android.
    const k = Platform.OS === 'ios' ? PixelRatio.get() : 1;
    return captureRef(canvas, { format: 'jpg', quality: 0.9, result: 'tmpfile', width: outW / k, height: outH / k });
  };

  const done = async () => {
    setSelected(null);
    setBaking(true);
    try {
      const outMain = await bake('main');
      const outSelfie = selfie ? await bake('selfie') : null;
      onDone({ main: outMain, selfie: outSelfie });
    } catch (e) {
      console.warn('[stickers] bake failed:', String(e));
      onDone({ main, selfie });   // the photos as they were: never lose the shot
    } finally {
      setBaking(false);
    }
  };

  const top = insets.top + Spacing.sm;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onSkip}>
      <View style={styles.root}>
        <View style={[styles.topBar, { paddingTop: top }]}>
          <TouchableOpacity onPress={onSkip} style={styles.skip} accessibilityRole="button" testID="stickers-skip">
            <Text style={styles.skipText}>{t('event.stickers.skip')}</Text>
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>{t('event.stickers.title')}</Text>
          <Button label={t('event.stickers.done')} onPress={done} loading={baking} style={styles.doneBtn} testID="stickers-done" />
        </View>

        {selfie && (
          <View style={styles.switchRow}>
            {(['main', 'selfie'] as Which[]).map(w => (
              <TouchableOpacity key={w} style={[styles.switch, which === w && styles.switchOn]} onPress={() => { setSelected(null); setWhich(w); }}
                                accessibilityRole="tab" accessibilityState={{ selected: which === w }}>
                <Text style={[styles.switchText, which === w && styles.switchTextOn]}>{t(w === 'main' ? 'event.stickers.photo' : 'event.stickers.selfie')}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* The canvas: the photo, its frame, its stickers (what gets baked). */}
        <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {fit.w > 0 && (
            <Pressable onPress={() => setSelected(null)} style={{ width: fit.w, height: fit.h }}>
              <View ref={canvas} collapsable={false} style={[styles.canvas, { width: fit.w, height: fit.h }]}>
                <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover"
                       onLoad={e => {
                         const { width, height } = e.source;
                         if (width && height) {
                           setRatio(r => ({ ...r, [which]: width / height }));
                           setNatural(n => ({ ...n, [which]: width }));
                         }
                       }} />
                {layer.frame && <View style={StyleSheet.absoluteFill} pointerEvents="none"><Frame id={layer.frame} width={fit.w} height={fit.h} /></View>}
                {layer.stickers.map(s => (
                  <PlacedSticker key={s.key} s={s} box={fit} selected={selected === s.key} reduced={reduced}
                                 url={urlOf.get(s.id)}
                                 onSelect={() => setSelected(s.key)}
                                 onChange={next => update(l => ({ ...l, stickers: l.stickers.map(x => (x.key === s.key ? next : x)) }))}
                                 isOverTrash={isOverTrash}
                                 onTrashHover={setOverTrash}
                                 onDrop={last => { setOverTrash(false); if (isOverTrash(last)) remove(last.key); }} />
                ))}
              </View>
            </Pressable>
          )}
          {/* The trash, while a sticker is held. */}
          {selected !== null && (
            <View style={[styles.trash, overTrash && styles.trashOn]} pointerEvents="none" accessibilityLabel={t('event.stickers.remove')}>
              <Ionicons name="trash-outline" size={26} color={colors.white} />
            </View>
          )}
        </View>

        {!!notice && <Text style={styles.notice} onPress={() => setNotice(null)}>{notice}</Text>}

        <View style={[styles.tray, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={styles.spookify} onPress={spookify} accessibilityRole="button" testID="stickers-spookify">
            <Text style={styles.spookifyText}>{t('event.stickers.spookify')}</Text>
          </TouchableOpacity>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trayRow}>
            {pack.map(id => (
              <TouchableOpacity key={id} style={styles.trayItem} onPress={() => add(id)} accessibilityRole="button"
                                accessibilityLabel={t('event.stickers.add')}>
                {urlOf.get(id) ? <Image source={{ uri: urlOf.get(id) }} style={styles.trayImg} contentFit="contain" />
                  : <Sticker id={id as StickerId} size={52} />}
              </TouchableOpacity>
            ))}
            {FRAMES.map(f => (
              <TouchableOpacity key={f} style={[styles.trayItem, layer.frame === f && styles.trayOn]}
                                onPress={() => update(l => ({ ...l, frame: l.frame === f ? null : f }))}
                                accessibilityRole="button" accessibilityState={{ selected: layer.frame === f }}
                                accessibilityLabel={t('event.stickers.frame')}>
                <View style={styles.framePreview}><Frame id={f} width={52} height={52} /></View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** One sticker: one finger drags, two fingers pinch and twist; dropped on the trash, it goes. */
function PlacedSticker({ s, box, selected, reduced, url, onSelect, onChange, isOverTrash, onTrashHover, onDrop }: {
  s: Placed; box: { w: number; h: number }; selected: boolean; reduced: boolean; url?: string;
  onSelect: () => void; onChange: (s: Placed) => void; isOverTrash: (s: Placed) => boolean;
  onTrashHover: (over: boolean) => void; onDrop: (last: Placed) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const latest = useRef({ s, box, onChange, onSelect, isOverTrash, onTrashHover, onDrop });
  latest.current = { s, box, onChange, onSelect, isOverTrash, onTrashHover, onDrop };
  const start = useRef<{ s: Placed; dist: number; angle: number } | null>(null);
  const size = box.w * BASE;

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { latest.current.onSelect(); start.current = { s: latest.current.s, dist: 0, angle: 0 }; },
    onPanResponderMove: (e, g) => {
      const { box: b, onChange: change, onTrashHover: hover, isOverTrash: over } = latest.current;
      const st = start.current;
      if (!st) return;
      const touches = e.nativeEvent.touches;
      if (touches.length >= 2) {
        const dx = touches[1].pageX - touches[0].pageX;
        const dy = touches[1].pageY - touches[0].pageY;
        const dist = Math.hypot(dx, dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (!st.dist) { st.dist = dist; st.angle = angle; st.s = latest.current.s; return; }
        change({ ...st.s, scale: Math.min(4, Math.max(0.3, st.s.scale * (dist / st.dist))), rotation: st.s.rotation + angle - st.angle });
        return;
      }
      if (st.dist) return;   // a pinch ended with one finger left: stay put
      const next = { ...st.s, x: st.s.x + g.dx / b.w, y: st.s.y + g.dy / b.h };
      change(next);
      hover(over(next));
    },
    onPanResponderRelease: () => {
      start.current = null;
      latest.current.onDrop(latest.current.s);
    },
    onPanResponderTerminate: () => { start.current = null; latest.current.onTrashHover(false); },
  }), []);

  return (
    <Animated.View
      entering={reduced ? undefined : ZoomIn.springify().damping(12)}
      exiting={reduced ? undefined : ZoomOut.duration(150)}
      style={[styles.placed, {
        width: size, height: size, left: s.x * box.w - size / 2, top: s.y * box.h - size / 2,
        transform: [{ scale: s.scale }, { rotate: `${s.rotation}deg` }],
      }, selected && styles.placedOn]}
      {...pan.panHandlers}
    >
      {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="contain" />
        : <Sticker id={s.id as StickerId} size={size} />}
    </Animated.View>
  );
}

// The editor is dark in both themes (a photo screen: fixed photo tokens).
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root:        { flex: 1, backgroundColor: c.photoScrim },
  topBar:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingBottom: 8 },
  skip:        { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  skipText:    { color: c.white, fontSize: FontSizes.md, fontWeight: '700' },
  title:       { flex: 1, color: c.white, fontSize: FontSizes.md, fontWeight: '800', textAlign: 'center' },
  doneBtn:     { minWidth: 96 },
  switchRow:   { flexDirection: 'row', alignSelf: 'center', gap: 6, backgroundColor: c.photoControl, borderRadius: Radius.full, padding: 4, marginBottom: 8 },
  switch:      { minHeight: 36, paddingHorizontal: 16, borderRadius: Radius.full, justifyContent: 'center' },
  switchOn:    { backgroundColor: c.white },
  switchText:  { color: c.white, fontSize: FontSizes.sm, fontWeight: '700' },
  switchTextOn:{ color: c.onGold },
  area:        { flex: 1, alignItems: 'center', justifyContent: 'center', marginHorizontal: Spacing.sm },
  canvas:      { overflow: 'hidden', borderRadius: 4, backgroundColor: c.photoBlurShade },
  placed:      { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  placedOn:    { borderWidth: 1.5, borderColor: c.white, borderStyle: 'dashed', borderRadius: 8 },
  trash:       { position: 'absolute', bottom: 8, width: TRASH, height: TRASH, borderRadius: TRASH / 2, alignItems: 'center', justifyContent: 'center',
                 backgroundColor: c.photoButton, borderWidth: 2, borderColor: c.onPhotoLine },
  trashOn:     { backgroundColor: c.red, transform: [{ scale: 1.15 }] },
  notice:      { color: c.white, textAlign: 'center', fontSize: FontSizes.xs, fontWeight: '700', paddingVertical: 6 },
  tray:        { gap: 10, paddingTop: 10, backgroundColor: c.photoControl },
  spookify:    { alignSelf: 'center', minHeight: 40, paddingHorizontal: 18, borderRadius: Radius.full, backgroundColor: c.white, justifyContent: 'center' },
  spookifyText:{ color: c.onGold, fontSize: FontSizes.sm, fontWeight: '800' },
  trayRow:     { gap: 8, paddingHorizontal: Spacing.md },
  trayItem:    { width: 64, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.photoButton },
  trayOn:      { borderWidth: 2, borderColor: c.white },
  trayImg:     { width: 52, height: 52 },
  framePreview:{ width: 52, height: 52, borderRadius: 8, overflow: 'hidden', backgroundColor: c.photoBlurShade },
});
