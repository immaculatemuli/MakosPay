import { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getApiUrl } from '@/lib/api';
import { colors } from './ui';

/** A car on the map: where it is, and its plate as the label. */
export type MapCar = { id: number; lat: number; lng: number; label: string };

// An OpenStreetMap map (Leaflet) in a web view: no map key needed. Cars are moved by sending them in, so the map
// does not reload (or lose the zoom) every time a position arrives.
const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;height:100%}.car{background:${colors.primary};color:#fff;font:700 12px sans-serif;padding:3px 6px;border-radius:6px;white-space:nowrap;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}</style>
</head><body><div id="map"></div><script>
var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([-1.29, 36.82], 12);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
var markers = {}, fitted = false;
window.showCars = function (cars) {
  var seen = {};
  cars.forEach(function (c) {
    seen[c.id] = true;
    var icon = L.divIcon({ className: '', html: '<div class="car"></div>', iconSize: null });
    if (!markers[c.id]) markers[c.id] = L.marker([c.lat, c.lng], { icon: icon }).addTo(map);
    markers[c.id].setLatLng([c.lat, c.lng]);
    markers[c.id].getElement().querySelector('.car').textContent = c.label;
  });
  Object.keys(markers).forEach(function (id) { if (!seen[id]) { map.removeLayer(markers[id]); delete markers[id]; } });
  if (!fitted && cars.length) {
    fitted = true;
    if (cars.length === 1) map.setView([cars[0].lat, cars[0].lng], 15);
    else map.fitBounds(cars.map(function (c) { return [c.lat, c.lng]; }), { padding: [30, 30] });
  }
};
</script></body></html>`;

/** Cars on an OpenStreetMap map, updated in place as their positions change. */
export function CarMap({ cars, height = 240 }: { cars: MapCar[]; height?: number }) {
  const ref = useRef<WebView>(null);
  const payload = useMemo(() => JSON.stringify(cars), [cars]);
  const send = useCallback(() => {
    ref.current?.injectJavaScript(`window.showCars && window.showCars(${payload}); true;`);
  }, [payload]);
  useEffect(send, [send]);
  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', marginVertical: 8, backgroundColor: colors.border }}>
      {/* The map tiles need to know which site asks for them (OpenStreetMap's rule): FarePay's address. */}
      <WebView ref={ref} source={{ html: PAGE, baseUrl: getApiUrl() }} onLoadEnd={send} originWhitelist={['*']} javaScriptEnabled scrollEnabled={false} />
    </View>
  );
}
