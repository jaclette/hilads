import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import type { DailyPlacePin } from '@/types';

// Map of pinned places: Leaflet + OpenStreetMap tiles in a WebView, the same
// setup as LocationPicker (no API key, no native map dependency). Only places
// users explicitly pinned on their proof are shown.
//
// The HTML is a module-level constant: pins and options are injected before
// the page loads (window.__pins / __interactive), so the WebView source never
// changes and never reloads. To show other pins, remount with a new `key`.
// Markers are built with DOM APIs (no HTML string concatenation of user data).
const MAP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    html,body,#map { width:100%; height:100%; margin:0; background:#1a1512; }
    .leaflet-control-zoom { display:none !important; }
    .leaflet-control-attribution { font-size:9px !important; background:rgba(255,255,255,0.6) !important; }
    .hl-pin { width:40px; height:40px; border-radius:20px; border:2px solid #FF7A3C; background:#2a1a12;
              overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,0.45); box-sizing:border-box; }
    .hl-pin img { width:100%; height:100%; object-fit:cover; display:block; }
    .hl-pin.hl-dot { background:#FF7A3C; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var pins = window.__pins || [];
    var interactive = !!window.__interactive;
    var map = L.map('map', {
      zoomControl: false, dragging: interactive, touchZoom: interactive, doubleClickZoom: interactive,
      scrollWheelZoom: false, boxZoom: false, keyboard: false, tap: interactive
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(map);
    function send(msg) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
    var bounds = [];
    pins.forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'hl-pin' + (p.thumbUrl ? '' : ' hl-dot');
      if (p.thumbUrl) { var img = document.createElement('img'); img.src = p.thumbUrl; el.appendChild(img); }
      var marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: el, iconSize: [40, 40], iconAnchor: [20, 20] })
      }).addTo(map);
      marker.on('click', function () { send({ type: 'pin', proofId: p.proofId }); });
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length === 0) map.setView([20, 0], 2);
    else if (bounds.length === 1) map.setView(bounds[0], 15);
    else map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    if (!interactive) map.attributionControl.setPrefix(false);
  </script>
</body>
</html>`;

interface Props {
  pins:        DailyPlacePin[];
  interactive: boolean;                       // false = static preview
  onPinPress?: (proofId: string) => void;
}

export const DailyPlacesMap = memo(
  function DailyPlacesMap({ pins, interactive, onPinPress }: Props) {
    const styles = useThemedStyles(makeStyles);
    const inject = `window.__pins = ${JSON.stringify(pins.map(p => ({
      proofId: p.proofId, lat: p.lat, lng: p.lng, thumbUrl: p.thumbUrl,
    }))).replace(/</g, '\\u003c')}; window.__interactive = ${interactive ? 'true' : 'false'}; true;`;

    const onMessage = useCallback((e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg?.type === 'pin' && typeof msg.proofId === 'string') onPinPress?.(msg.proofId);
      } catch { /* ignore */ }
    }, [onPinPress]);

    return (
      <View style={styles.wrap} pointerEvents={interactive ? 'auto' : 'none'}>
        <WebView
          style={styles.webview}
          source={{ html: MAP_HTML }}
          injectedJavaScriptBeforeContentLoaded={inject}
          onMessage={onMessage}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        />
      </View>
    );
  },
  // Never re-render after mount (the WebView would reload); remount with a new key
  // instead. onPinPress is read at mount: pass a stable callback.
  () => true,
);

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:    { flex: 1 },
  webview: { flex: 1, backgroundColor: c.bg3 },
});
