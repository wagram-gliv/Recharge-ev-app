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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function matrixBatch(base, key, batch) {
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
  if (!response.ok) throw new Error(`MATRIX_${response.status}`);
  const data = await response.json();
  return batch.map((_, i) => {
    const km = data.distances?.[i]?.[i], seconds = data.durations?.[i]?.[i];
    return Number.isFinite(km) && Number.isFinite(seconds) ? { detourKm: km, detourMinutes: seconds / 60 } : null;
  });
}

// Un lot en échec est retenté une fois, puis coupé en deux jusqu'à la paire seule : un point non routable
// (ou une erreur passagère) ne fait plus perdre les 24 autres sites du lot.
async function resilientBatch(base, key, batch, attempt = 0) {
  try {
    return await matrixBatch(base, key, batch);
  } catch (error) {
    if (attempt === 0) { await sleep(1500); return resilientBatch(base, key, batch, 1); }
    if (batch.length === 1) { console.warn('Détour non vérifiable pour', batch[0].name, error.message); return [null]; }
    const half = Math.ceil(batch.length / 2);
    return [...await resilientBatch(base, key, batch.slice(0, half), 1), ...await resilientBatch(base, key, batch.slice(half), 1)];
  }
}

export async function getDrivingDetours(chargers) {
  const key = resolveKey();
  const base = resolveBaseUrl();
  if (!key) throw new Error('NO_ORS_KEY');
  const results = [];
  for (let offset = 0; offset < chargers.length; offset += MATRIX_BATCH) {
    results.push(...await resilientBatch(base, key, chargers.slice(offset, offset + MATRIX_BATCH)));
  }
  return results;
}

export async function getRoute(origin, destination) {
  const start = await geocode(origin);
  const end = await geocode(destination);
  const routeData = await route(start, end);
  return { start, end, ...routeData };
}
