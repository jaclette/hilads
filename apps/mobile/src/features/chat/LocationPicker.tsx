/**
 * LocationPicker — full-screen location confirmation modal.
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

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

// ── Leaflet HTML — loaded in WebView ─────────────────────────────────────────
// • OSM tiles — no API key
// • Zoom/attribution controls hidden for clean look
// • map.moveend → debounce 600ms → postMessage {type:'move', lat, lng}
// • ready event fires immediately with initial coords

function buildMapHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
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
    var map = L.map('map',{center:[${lat},${lng}],zoom:16,zoomControl:false,attributionControl:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    var t = null;
    function send(type,lat,lng){ window.ReactNativeWebView.postMessage(JSON.stringify({type:type,lat:lat,lng:lng})); }
    map.on('moveend',function(){
      clearTimeout(t);
      t = setTimeout(function(){ var c=map.getCenter(); send('move',c.lat,c.lng); },600);
    });
    send('ready',${lat},${lng});
  </script>
</body>
</html>`;
}

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
  return { place: place || 'Your location', address };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible:    boolean;
  initialLat: number;
  initialLng: number;
  onConfirm:  (result: { place: string; address: string; lat: number; lng: number }) => void;
  onClose:    () => void;
}

export function LocationPicker({ visible, initialLat, initialLng, onConfirm, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const [place,     setPlace]     = useState('');
  const [address,   setAddress]   = useState('');
  const [geocoding, setGeocoding] = useState(true);
  const currentCoords             = useRef({ lat: initialLat, lng: initialLng });

  // WebView ref for JS injection
  const webViewRef   = useRef<WebView>(null);
  const webViewReady = useRef(false);
  const pendingPan   = useRef<{ lat: number; lng: number } | null>(null);

  // html is stable for the lifetime of this open — rebuild only when initial coords change
  const html = useRef(buildMapHtml(initialLat, initialLng));
  useEffect(() => {
    if (visible) {
      html.current = buildMapHtml(initialLat, initialLng);
      webViewReady.current = false;
      pendingPan.current   = null;
      setGeocoding(true);
    }
  }, [visible, initialLat, initialLng]);

  // After picker opens: refine to accurate GPS without blocking the UI.
  // The caller already provided last-known position as initialLat/Lng so the map
  // renders immediately. Here we silently upgrade to precise GPS and pan the map.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const { latitude: lat, longitude: lng } = pos.coords;
        // Only pan if the accurate fix differs meaningfully from the initial center
        const d = Math.abs(lat - currentCoords.current.lat) + Math.abs(lng - currentCoords.current.lng);
        if (d < 0.0001) return; // already close enough
        currentCoords.current = { lat, lng };
        const js = `map.setView([${lat},${lng}],16);true;`;
        if (webViewReady.current) {
          webViewRef.current?.injectJavaScript(js);
        } else {
          pendingPan.current = { lat, lng };
        }
      } catch { /* stay at last-known position */ }
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const geocode = useCallback(async (lat: number, lng: number) => {
    setGeocoding(true);
    currentCoords.current = { lat, lng };
    try {
      const result = await nominatimReverse(lat, lng);
      setPlace(result.place);
      setAddress(result.address);
    } catch {
      setPlace('Your location');
      setAddress('');
    } finally {
      setGeocoding(false);
    }
  }, []);

  function handleWebViewMessage(event: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        webViewReady.current = true;
        // Apply any pending pan from accurate GPS that arrived before WebView was ready
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
  }

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
            <Ionicons name="close" size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Where are you? 👀</Text>
          <View style={styles.closeBtn} />
        </View>

        {/* ── Map ── */}
        <View style={styles.mapWrap}>
          <WebView
            ref={webViewRef}
            style={styles.webview}
            source={{ html: html.current }}
            onMessage={handleWebViewMessage}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />

          {/* Fixed pin — sits in center, pointer events disabled so map stays draggable */}
          <View style={styles.pinWrap} pointerEvents="none">
            <Text style={styles.pin}>📍</Text>
          </View>

          <View style={styles.hintWrap} pointerEvents="none">
            <Text style={styles.hint}>Move the map to adjust</Text>
          </View>
        </View>

        {/* ── Footer ── */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.addressCard}>
            {geocoding ? (
              <View style={styles.geocodingRow}>
                <ActivityIndicator size="small" color={Colors.accent} />
                <Text style={styles.geocodingText}>Getting location…</Text>
              </View>
            ) : (
              <>
                <Text style={styles.placeName} numberOfLines={1}>{place}</Text>
                {!!address && <Text style={styles.addressText} numberOfLines={2}>{address}</Text>}
              </>
            )}
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, geocoding && styles.confirmBtnDisabled]}
            onPress={() => onConfirm({ place: place || 'Your location', address, lat: currentCoords.current.lat, lng: currentCoords.current.lng })}
            disabled={geocoding}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmBtnText}>Share this spot</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>

      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical:   12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title:    { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  closeBtn: {
    width:           36,
    height:          36,
    borderRadius:    Radius.full,
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    alignItems:      'center',
    justifyContent:  'center',
  },
  mapWrap: { flex: 1, position: 'relative' },
  webview: { flex: 1, backgroundColor: '#1a1512' },
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
    color:             'rgba(255,255,255,0.8)',
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
    borderTopColor:    Colors.border,
    backgroundColor:   Colors.bg,
    gap:               10,
  },
  addressCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth:     1,
    borderColor:     Colors.border,
    borderRadius:    14,
    padding:         14,
    minHeight:       60,
    justifyContent:  'center',
  },
  geocodingRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  geocodingText: { fontSize: FontSizes.sm, color: Colors.muted2 },
  placeName:     { fontSize: FontSizes.md, fontWeight: '700', color: Colors.text },
  addressText:   { fontSize: FontSizes.xs, color: Colors.muted2, marginTop: 3, lineHeight: 16 },
  confirmBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    14,
    padding:         16,
    alignItems:      'center',
    shadowColor:     Colors.accent,
    shadowOffset:    { width: 0, height: 6 },
    shadowOpacity:   0.3,
    shadowRadius:    12,
    elevation:       6,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText:     { fontSize: FontSizes.md, fontWeight: '700', color: '#fff' },
  cancelBtn: {
    borderWidth:  1,
    borderColor:  Colors.border,
    borderRadius: 14,
    padding:      13,
    alignItems:   'center',
  },
  cancelBtnText: { fontSize: FontSizes.sm, fontWeight: '600', color: Colors.muted2 },
});
