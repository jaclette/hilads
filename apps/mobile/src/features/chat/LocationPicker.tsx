/**
 * LocationPicker - full-screen location confirmation modal.
 *
 * Map: Leaflet + OpenStreetMap tiles rendered in a WebView (react-native-webview).
 * Zero Google dependencies. Works identically on iOS and Android.
 *
 * Flow:
 *   1. WebView renders Leaflet map centred on user's GPS coords
 *   2. Pin fixed in center of screen; map moves underneath
 *   3. map.moveend → WebView postMessage → Nominatim reverse geocode (native)
 *   4. Address shown in native card below map
 *   5. "Share this spot" → onConfirm({ place, address })
 */

import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import type { RefObject } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal,
  TextInput, ScrollView, Keyboard,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

// ── Leaflet HTML - loaded in WebView ─────────────────────────────────────────
// • OSM tiles - no API key
// • Zoom/attribution controls hidden for clean look
// • map.moveend → debounce 600ms → postMessage {type:'move', lat, lng}
// • ready event fires immediately with initial coords
//
// CRITICAL: this HTML is a *module-level constant* with NO interpolated coords.
// The initial center is injected at mount via injectedJavaScriptBeforeContentLoaded
// (window.__lat/__lng). Because the `source={{ html: MAP_HTML }}` string is
// byte-identical for every render and every picker instance, react-native-webview
// can never see a "changed source" and therefore never reloads the page after
// mount - the #1 cause of the map "reloading / shaking" on Android.
//
// The moveend handler also guards against no-op moves: a WebView viewport resize
// (Android fires these on layout / inset / keyboard changes) makes Leaflet emit a
// `moveend` whose center hasn't actually changed. Geocoding those caused an
// endless "Getting location…" flicker. We only postMessage when the center moved
// more than ~5 m since the last report.
const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body,#map { width:100%; height:100%; background:#1a1512; }
    .leaflet-control-attribution, .leaflet-control-zoom { display:none !important; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var startLat = (typeof window.__lat === 'number') ? window.__lat : 0;
    var startLng = (typeof window.__lng === 'number') ? window.__lng : 0;
    var map = L.map('map',{center:[startLat,startLng],zoom:16,zoomControl:false,attributionControl:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    var t = null;
    var lastLat = startLat, lastLng = startLng;
    function send(type,lat,lng){ window.ReactNativeWebView.postMessage(JSON.stringify({type:type,lat:lat,lng:lng})); }
    map.on('moveend',function(){
      clearTimeout(t);
      t = setTimeout(function(){
        var c = map.getCenter();
        // Skip moveend events that didn't actually move the center (resize/relayout).
        if (Math.abs(c.lat-lastLat) < 0.00005 && Math.abs(c.lng-lastLng) < 0.00005) return;
        lastLat = c.lat; lastLng = c.lng;
        send('move', c.lat, c.lng);
      },600);
    });
    send('ready', startLat, startLng);
  </script>
</body>
</html>`;

// ── Reverse geocode via Nominatim ─────────────────────────────────────────────

async function nominatimReverse(lat: number, lng: number): Promise<{ place: string; address: string }> {
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=en`,
    { headers: { 'User-Agent': 'Hilads/1.0' } },
  );
  if (!resp.ok) throw new Error('Nominatim error');
  const data = await resp.json();
  const addr = data.address ?? {};

  const place: string = addr.amenity
    ?? addr.shop ?? addr.tourism ?? addr.building
    ?? addr.quarter ?? addr.neighbourhood ?? addr.suburb
    ?? addr.city_district ?? addr.district
    ?? addr.town ?? addr.city
    ?? (data.display_name?.split(',')[0] ?? '');

  const parts = [addr.road, addr.quarter ?? addr.neighbourhood ?? addr.suburb, addr.city ?? addr.town].filter(Boolean) as string[];
  const address = parts.join(', ');
  // Empty place → the component shows a localized "Your location" fallback.
  return { place, address };
}

// ── Forward geocode (address search) via Nominatim ───────────────────────────
// Same provider as the reverse lookup above. Returns up to 5 ranked matches.

interface SearchHit { label: string; lat: number; lng: number }

async function nominatimSearch(query: string): Promise<SearchHit[]> {
  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=en`,
    { headers: { 'User-Agent': 'Hilads/1.0' } },
  );
  if (!resp.ok) throw new Error('Nominatim search error');
  const data = await resp.json();
  return (Array.isArray(data) ? data : [])
    .map((d: any) => ({ label: String(d.display_name ?? ''), lat: parseFloat(d.lat), lng: parseFloat(d.lon) }))
    .filter((h: SearchHit) => h.label && Number.isFinite(h.lat) && Number.isFinite(h.lng));
}

// ── Map WebView (isolated) ────────────────────────────────────────────────────
// The parent screen (city chat) re-renders constantly (WS messages, presence),
// which would re-render this and reload the inline-HTML WebView ~1/sec →
// "getting location" spinner + shaking. We render the WebView from a CONSTANT
// MAP_HTML (initial center injected via injectedJavaScriptBeforeContentLoaded)
// and memo with an always-equal comparator: MapWebView mounts exactly once and
// is never re-rendered, so the native WebView can never reload after mount.
// Search-pans go through the ref (injectJavaScript), not props, so freezing
// props is safe.
const MapWebView = memo(
  function MapWebView({ injectBefore, onMessage, innerRef }: {
    injectBefore: string;
    onMessage: (e: WebViewMessageEvent) => void;
    innerRef: RefObject<WebView | null>;
  }) {
    const styles = useThemedStyles(makeStyles);
    return (
      <WebView
        ref={innerRef}
        style={styles.webview}
        source={{ html: MAP_HTML }}
        injectedJavaScriptBeforeContentLoaded={injectBefore}
        onMessage={onMessage}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    );
  },
  () => true,   // never re-render after mount → WebView never reloads
);

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible:    boolean;
  initialLat: number;
  initialLng: number;
  /**
   * Deprecated / no-op. The picker no longer refines to live GPS on open - it
   * always opens at initialLat/Lng (the caller's last-known position) and stays
   * put while the user drags to fine-tune. Kept in the prop list so existing
   * call sites compile unchanged; the value is ignored.
   */
  autoLocate?: boolean;
  onConfirm:  (result: { place: string; address: string; lat: number; lng: number }) => void;
  onClose:    () => void;
}

export function LocationPicker({ visible, initialLat, initialLng, onConfirm, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');

  const [place,     setPlace]     = useState('');
  const [address,   setAddress]   = useState('');
  const [geocoding, setGeocoding] = useState(true);
  const currentCoords             = useRef({ lat: initialLat, lng: initialLng });

  // WebView ref for JS injection
  const webViewRef   = useRef<WebView>(null);
  const webViewReady = useRef(false);
  const pendingPan   = useRef<{ lat: number; lng: number } | null>(null);

  // Captured ONCE at mount: the initial center is injected into the constant
  // MAP_HTML before its scripts run. MapWebView never re-renders (see its
  // always-equal memo), so this value is locked for the picker's lifetime - the
  // WebView mounts at this center and never reloads.
  const injectBefore = useMemo(
    () => `window.__lat=${Number(initialLat)};window.__lng=${Number(initialLng)};true;`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // NOTE: we intentionally do NOT call getCurrentPositionAsync here. The caller
  // already passes the last-known position as initialLat/Lng, so the map opens
  // immediately and STAYS put - the user drags to fine-tune ("Move the map to
  // adjust"). The old "refine to precise GPS" step activated the iOS location
  // indicator and re-panned the map, which read as the map constantly
  // "getting location" / shaking. A static map at last-known + drag is the
  // standard, calm picker UX.

  const geocode = useCallback(async (lat: number, lng: number) => {
    setGeocoding(true);
    currentCoords.current = { lat, lng };
    try {
      const result = await nominatimReverse(lat, lng);
      setPlace(result.place);
      setAddress(result.address);
    } catch {
      setPlace('');
      setAddress('');
    } finally {
      setGeocoding(false);
    }
  }, []);

  // ── Address search (forward geocode) ──────────────────────────────────────
  const [query,       setQuery]       = useState('');
  const [hits,        setHits]        = useState<SearchHit[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [searched,    setSearched]    = useState(false);   // a query has run → enables "No places found"
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq   = useRef(0);                            // guards out-of-order responses

  const runSearch = useCallback(async (q: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const results = await nominatimSearch(q);
      if (seq !== searchSeq.current) return;                // a newer query superseded this one
      setHits(results);
    } catch {
      if (seq === searchSeq.current) setHits([]);
    } finally {
      if (seq === searchSeq.current) { setSearching(false); setSearched(true); }
    }
  }, []);

  const onSearchChange = useCallback((text: string) => {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = text.trim();
    if (q.length < 3) { setHits([]); setSearched(false); setSearching(false); return; }
    // Debounce so we don't hit Nominatim on every keystroke.
    searchTimer.current = setTimeout(() => runSearch(q), 450);
  }, [runSearch]);

  // Pan the map to a searched place; the WebView's moveend → geocode updates the
  // address label, and the user can still drag afterwards to fine-tune.
  const selectHit = useCallback((hit: SearchHit) => {
    Keyboard.dismiss();
    setQuery(hit.label.split(',')[0]);
    setHits([]);
    setSearched(false);
    currentCoords.current = { lat: hit.lat, lng: hit.lng };
    const js = `map.setView([${hit.lat},${hit.lng}],16);true;`;
    if (webViewReady.current) webViewRef.current?.injectJavaScript(js);
    else pendingPan.current = { lat: hit.lat, lng: hit.lng };
  }, []);

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // MUST be a stable reference: an inline-HTML <WebView> reloads its content on
  // every render where a prop reference changes. The parent (city chat) re-renders
  // constantly (WS messages/presence), so an unstable onMessage made the map
  // reload ~1/sec → constant "loading" + shaking. Memoized → render-stable.
  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        webViewReady.current = true;
        // Apply any pending pan from an address search that ran before the WebView was ready
        if (pendingPan.current) {
          const { lat, lng } = pendingPan.current;
          pendingPan.current = null;
          webViewRef.current?.injectJavaScript(`map.setView([${lat},${lng}],16);true;`);
          // moveend will fire → geocode. Skip geocoding the initial center.
          return;
        }
        geocode(msg.lat, msg.lng);
      } else if (msg.type === 'move') {
        geocode(msg.lat, msg.lng);
      }
    } catch { /* ignore */ }
  }, [geocode]);


  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>{t('locationPicker.title')}</Text>
          <View style={styles.closeBtn} />
        </View>

        {/* ── Map ── */}
        <View style={styles.mapWrap}>
          <MapWebView injectBefore={injectBefore} onMessage={handleWebViewMessage} innerRef={webViewRef} />

          {/* Fixed pin - sits in center, pointer events disabled so map stays draggable */}
          <View style={styles.pinWrap} pointerEvents="none">
            <Text style={styles.pin}>📍</Text>
          </View>

          <View style={styles.hintWrap} pointerEvents="none">
            <Text style={styles.hint}>{t('locationPicker.moveHint')}</Text>
          </View>

          {/* ── Address search overlay (top of map) ── */}
          <View style={styles.searchWrap}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={colors.muted2} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={onSearchChange}
                placeholder={t('locationPicker.search')}
                placeholderTextColor={colors.muted2}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searching ? (
                <ActivityIndicator size="small" color={colors.muted2} />
              ) : query.length > 0 ? (
                <TouchableOpacity
                  onPress={() => { setQuery(''); setHits([]); setSearched(false); Keyboard.dismiss(); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle" size={16} color={colors.muted2} />
                </TouchableOpacity>
              ) : null}
            </View>

            {(hits.length > 0 || (searched && !searching)) && (
              <View style={styles.suggestions}>
                {hits.length > 0 ? (
                  <ScrollView keyboardShouldPersistTaps="handled" style={styles.suggestionsScroll}>
                    {hits.map((hit, i) => (
                      <TouchableOpacity
                        key={`${hit.lat},${hit.lng},${i}`}
                        style={[styles.suggestionRow, i > 0 && styles.suggestionRowBorder]}
                        activeOpacity={0.7}
                        onPress={() => selectHit(hit)}
                      >
                        <Ionicons name="location-outline" size={15} color={colors.muted2} style={{ marginTop: 1 }} />
                        <Text style={styles.suggestionText} numberOfLines={2}>{hit.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.noResults}>{t('locationPicker.noResults')}</Text>
                )}
              </View>
            )}
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.addressCard}>
            {geocoding ? (
              <View style={styles.geocodingRow}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.geocodingText}>{t('locationPicker.loading')}</Text>
              </View>
            ) : (
              <>
                <Text style={styles.placeName} numberOfLines={1}>{place || t('locationPicker.yourLocation')}</Text>
                {!!address && <Text style={styles.addressText} numberOfLines={2}>{address}</Text>}
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, geocoding && styles.confirmBtnDisabled]}
            onPress={() => onConfirm({ place: place || t('locationPicker.yourLocation'), address, lat: currentCoords.current.lat, lng: currentCoords.current.lng })}
            disabled={geocoding}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmBtnText}>{t('locationPicker.confirm')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>

      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: c.bg },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  title:    { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  closeBtn: {
    width:           36,
    height:          36,
    borderRadius:    Radius.full,
    backgroundColor: c.bg2,
    borderWidth:     1,
    borderColor:     c.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  mapWrap: { flex: 1, position: 'relative' },
  webview: { flex: 1, backgroundColor: '#1a1512' },

  // ── Address search overlay ──
  searchWrap: { position: 'absolute', top: 12, left: 12, right: 12 },
  searchBox: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
    borderRadius:      12,
    paddingHorizontal: 12,
    height:            44,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 2 },
    shadowOpacity:     0.3,
    shadowRadius:      6,
    elevation:         4,
  },
  searchInput: { flex: 1, color: c.text, fontSize: FontSizes.sm, padding: 0 },
  suggestions: {
    marginTop:       6,
    backgroundColor: c.bg2,
    borderWidth:     1,
    borderColor:     c.border,
    borderRadius:    12,
    overflow:        'hidden',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 2 },
    shadowOpacity:   0.3,
    shadowRadius:    6,
    elevation:       4,
  },
  suggestionsScroll: { maxHeight: 240 },
  suggestionRow: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               8,
    paddingHorizontal: 12,
    paddingVertical:   11,
  },
  suggestionRowBorder: { borderTopWidth: 1, borderTopColor: c.border },
  suggestionText: { flex: 1, color: c.text, fontSize: FontSizes.xs, lineHeight: 17 },
  noResults: { color: c.muted2, fontSize: FontSizes.xs, paddingHorizontal: 12, paddingVertical: 12 },
  pinWrap: {
    position:       'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems:     'center',
    justifyContent: 'center',
    marginBottom:   40, // visually center the tip of the pin emoji
  },
  pin:      { fontSize: 40, lineHeight: 44 },
  hintWrap: { position: 'absolute', bottom: 16, left: 0, right: 0, alignItems: 'center' },
  hint: {
    fontSize:          12,
    fontWeight:        '500',
    color:             c.overlayStrong,
    backgroundColor:   'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical:   5,
    borderRadius:      999,
    overflow:          'hidden',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop:        16,
    borderTopWidth:    1,
    borderTopColor:    c.border,
    backgroundColor:   c.bg,
    gap:               10,
  },
  addressCard: {
    backgroundColor: c.overlayWeak,
    borderWidth:     1,
    borderColor:     c.border,
    borderRadius:    14,
    padding:         14,
    minHeight:       60,
    justifyContent:  'center',
  },
  geocodingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  geocodingText: { fontSize: FontSizes.sm, color: c.muted2 },
  placeName:     { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  addressText:   { fontSize: FontSizes.xs, color: c.muted2, marginTop: 3, lineHeight: 16 },
  confirmBtn: {
    backgroundColor: c.accent,
    borderRadius:    14,
    padding:         16,
    alignItems:      'center',
    shadowColor:     c.accent,
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.3,
    shadowRadius:    12,
    elevation:       6,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText:     { fontSize: FontSizes.md, fontWeight: '700', color: '#fff' },
  cancelBtn: {
    borderWidth:  1,
    borderColor:  c.border,
    borderRadius: 14,
    padding:      13,
    alignItems:   'center',
  },
  cancelBtnText: { fontSize: FontSizes.sm, fontWeight: '600', color: c.muted2 },
});
