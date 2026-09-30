import { APP_CONFIG } from './config.js';

const DEFAULT_ORS_BASE = 'https://api.openrouteservice.org';

function resolveBaseUrl() {
  const raw = APP_CONFIG.ORS_BASE_URL || window.__APP_CONFIG__?.ORS_BASE_URL || DEFAULT_ORS_BASE;
  return raw.replace(/\/$/, '');
}

function resolveKey() {
  return APP_CONFIG.ORS_API_KEY || window.__APP_CONFIG__?.ORS_API_KEY;
}

async function geocode(place) {
  const key = resolveKey();
  if (!key) throw new Error('NO_ORS_KEY');
  const base = resolveBaseUrl();
  const url = `${base}/geocode/search?api_key=${key}&text=${encodeURIComponent(place)}&size=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GEOCODE_ERROR_${res.status}`);
  const data = await res.json();
  if (!data.features?.length) throw new Error('GEOCODE_EMPTY');
  return data.features[0].geometry.coordinates; // [lon,lat]
}

async function route(startLonLat, endLonLat) {
  const key = resolveKey();
  if (!key) throw new Error('NO_ORS_KEY');
  const base = resolveBaseUrl();
  const res = await fetch(`${base}/v2/directions/driving-car/geojson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ coordinates: [startLonLat, endLonLat] })
  });
  if (!res.ok) throw new Error(`ROUTE_ERROR_${res.status}`);
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) throw new Error('ROUTE_EMPTY');
  return {
    geometry: feat.geometry.coordinates,
    distanceKm: feat.properties.summary.distance / 1000
  };
}

// Détour routier (point d'ancrage sur la route → borne) pour chaque candidate, via l'API Matrix d'ORS :
// une seule requête par lot de 25 paires au lieu d'une requête Directions par borne (quota gratuit ≈ 40-50/min).
const MATRIX_BATCH = 25;

export async function getDrivingDetours(chargers) {
  const key = resolveKey();
  const base = resolveBaseUrl();
  if (!key) throw new Error('NO_ORS_KEY');
  const results = new Array(chargers.length).fill(null);
  for (let offset = 0; offset < chargers.length; offset += MATRIX_BATCH) {
    const batch = chargers.slice(offset, offset + MATRIX_BATCH);
    try {
      const response = await fetch(`${base}/v2/matrix/driving-car`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: key },
        body: JSON.stringify({
          locations: [...batch.map((c) => c.anchor), ...batch.map((c) => [c.lon, c.lat])],
          sources: batch.map((_, i) => i),
          destinations: batch.map((_, i) => batch.length + i),
          metrics: ['distance', 'duration'],
          units: 'km'
        })
      });
      if (!response.ok) continue;
      const data = await response.json();
      batch.forEach((_, i) => {
        const km = data.distances?.[i]?.[i], seconds = data.durations?.[i]?.[i];
        if (Number.isFinite(km) && Number.isFinite(seconds)) results[offset + i] = { detourKm: km, detourMinutes: seconds / 60 };
      });
    } catch { /* Un lot en échec laisse ses détours non vérifiés. */ }
  }
  return results;
}

export async function getRoute(origin, destination) {
  const start = await geocode(origin);
  const end = await geocode(destination);
  const routeData = await route(start, end);
  return { start, end, ...routeData };
}
