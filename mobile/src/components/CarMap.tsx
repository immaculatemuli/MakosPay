import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api, getApiUrl } from '@/lib/api';
import { colors } from './ui';

/** A car on the map: where it is, and its plate as the label. */
export type MapCar = { id: number; lat: number; lng: number; label: string };

/** The map tiles the server says to use: Google's when the SACCO has a key, else OpenStreetMap's. */
type Tiles = { provider: 'google' | 'osm'; url: string; attribution: string; max_zoom: number };
const OSM: Tiles = { provider: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', max_zoom: 19 };

// Asked once and kept for an hour (Google's map session lasts about two weeks; the server renews it).
let tilesCache: { tiles: Tiles; at: number } | null = null;
async function loadTiles(): Promise<Tiles> {
  if (tilesCache && Date.now() - tilesCache.at < 3600_000) return tilesCache.tiles;
  const tiles = await api<Tiles>('/book-api/map').catch(() => OSM);
  tilesCache = { tiles, at: Date.now() };
  return tiles;
}

// A Leaflet map in a web view, with Google's or OpenStreetMap's tiles. Cars are moved by sending them in, so the map
// does not reload (or lose the zoom) every time a position arrives.
const page = (tiles: Tiles) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;height:100%}.car{background:${colors.primary};color:#fff;font:700 12px sans-serif;padding:3px 6px;border-radius:6px;white-space:nowrap;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}</style>
</head><body><div id="map"></div><script>
var map = L.map('map', { zoomControl: true, attributionControl: true }).setView([-1.29, 36.82], 12);
L.tileLayer(${JSON.stringify(tiles.url)}, { maxZoom: ${tiles.max_zoom}, attribution: ${JSON.stringify(tiles.attribution)} }).addTo(map);
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

/** Cars on the map, updated in place as their positions change. */
export function CarMap({ cars, height = 240 }: { cars: MapCar[]; height?: number }) {
  const ref = useRef<WebView>(null);
  const [tiles, setTiles] = useState<Tiles | null>(tilesCache?.tiles ?? null);
  useEffect(() => {
    let live = true;
    void loadTiles().then((t) => live && setTiles(t));
    return () => {
      live = false;
    };
  }, []);
  const html = useMemo(() => (tiles ? page(tiles) : null), [tiles]);
  const payload = useMemo(() => JSON.stringify(cars), [cars]);
  const send = useCallback(() => {
    ref.current?.injectJavaScript(`window.showCars && window.showCars(${payload}); true;`);
  }, [payload]);
  useEffect(send, [send]);
  return (
    <View style={{ height, borderRadius: 12, overflow: 'hidden', marginVertical: 8, backgroundColor: colors.border }}>
      {/* The tiles need to know which site asks for them (OpenStreetMap's rule, and Google's key is limited to it): FarePay's address. */}
      {html && <WebView ref={ref} source={{ html, baseUrl: getApiUrl() }} onLoadEnd={send} originWhitelist={['*']} javaScriptEnabled scrollEnabled={false} />}
    </View>
  );
}
