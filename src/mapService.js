import { APP_CONFIG } from './config.js';

const ORS_BASE = 'https://api.heigit.org';

async function geocode(place) {
  const key = APP_CONFIG.ORS_API_KEY || window.__APP_CONFIG__?.ORS_API_KEY;
  if (!key) throw new Error('NO_ORS_KEY');
  const url = `${ORS_BASE}/geocode/search?api_key=${key}&text=${encodeURIComponent(place)}&size=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('GEOCODE_ERROR');
  const data = await res.json();
  if (!data.features?.length) throw new Error('GEOCODE_EMPTY');
  return data.features[0].geometry.coordinates; // [lon,lat]
}

async function route(startLonLat, endLonLat) {
  const key = APP_CONFIG.ORS_API_KEY || window.__APP_CONFIG__?.ORS_API_KEY;
  if (!key) throw new Error('NO_ORS_KEY');
  const res = await fetch(`${ORS_BASE}/v2/directions/driving-car/geojson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ coordinates: [startLonLat, endLonLat] })
  });
  if (!res.ok) throw new Error('ROUTE_ERROR');
  const data = await res.json();
  const feat = data.features?.[0];
  if (!feat) throw new Error('ROUTE_EMPTY');
  return {
    geometry: feat.geometry.coordinates,
    distanceKm: feat.properties.summary.distance / 1000
  };
}

export async function getRoute(origin, destination) {
  const start = await geocode(origin);
  const end = await geocode(destination);
  const routeData = await route(start, end);
  return { start, end, ...routeData };
}
