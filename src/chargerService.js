// Bornes Lidl le long d'un itinéraire, depuis OpenStreetMap (Overpass API), en deux requêtes légères :
//   1. tout ce qui est tagué Lidl dans la boîte englobante du trajet (filtres par égalité ⇒ index Overpass, rapide) ;
//      côté client on ne garde que les magasins à ≤ CORRIDOR_KM de la route ;
//   2. les bornes à ≤ SHOP_RADIUS_M de ces seuls magasins (un `around` ponctuel par magasin, par lots).
// Un `around` sur la polyligne du trajet ou une regex ~"lidl" seraient 10× plus coûteux et rejetés quand le serveur est chargé.
// Miroirs essayés dans l'ordre ; un miroir qui refuse (406/429/504) ou expire passe la main au suivant.
// overpass-api.de en premier : c'est le plus fiable, et quand il bloque un réseau (HTTP 406) il répond instantanément.
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
export const CORRIDOR_KM = 15; // pré-filtre à vol d'oiseau ; le détour routier réel (10 km / 15 min) est vérifié ensuite
const SHOP_RADIUS_M = 120; // une borne à moins de 120 m d'un magasin Lidl est considérée "sur site Lidl"
const SHOPS_PER_QUERY = 100;
const SITE_RADIUS_KM = 0.08; // OSM cartographie souvent chaque point de charge séparément : on regroupe les bornes d'un même parking
const MIRROR_TIMEOUT_MS = 35000; // le serveur abandonne lui-même à [timeout:30]
const R = 6371;
const radians = (degrees) => degrees * Math.PI / 180;

export function distanceKm(a, b) {
  const dLat = radians(b[1] - a[1]);
  const dLon = radians(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Projette un point sur la polyligne : décalage perpendiculaire, distance depuis le départ, point d'ancrage sur la route.
export function positionOnRoute(point, geometry) {
  let travelled = 0;
  let best = { offsetKm: Infinity, distanceFromStartKm: 0, anchor: geometry[0] };
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1], b = geometry[i];
    const latScale = Math.cos(radians((a[1] + b[1]) / 2));
    const dx = (b[0] - a[0]) * latScale, dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * latScale * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    const anchor = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const length = distanceKm(a, b);
    const offsetKm = distanceKm(point, anchor);
    if (offsetKm < best.offsetKm) best = { offsetKm, distanceFromStartKm: travelled + t * length, anchor };
    travelled += length;
  }
  return best;
}

function powerFromTags(tags) {
  const values = Object.entries(tags)
    .filter(([key]) => key === 'charging_station:output' || key === 'capacity:output' || /^socket:.*:output$/.test(key))
    .flatMap(([, value]) => String(value).split(';'))
    .map((value) => {
      const match = value.match(/(\d+(?:[.,]\d+)?)\s*(MW|kW|W)?/i);
      if (!match) return 0;
      const number = Number(match[1].replace(',', '.'));
      return match[2]?.toLowerCase() === 'mw' ? number * 1000 : match[2]?.toLowerCase() === 'w' ? number / 1000 : number;
    });
  return Math.max(0, ...values);
}

const isLidl = (tags) => ['brand', 'operator', 'name', 'network'].some((key) => /\blidl\b/i.test(tags[key] || ''));
const isCharger = (tags) => tags?.amenity === 'charging_station' || tags?.['disused:amenity'] === 'charging_station';
const coords = (item) => [item.lon ?? item.center?.lon, item.lat ?? item.center?.lat];

// État de la borne d'après OSM. OSM ne fournit pas l'occupation en temps réel : `occupancy` reste 'unknown'
// tant qu'aucune source live n'est branchée.
function statusFromTags(tags) {
  const condition = `${tags.operational_status || ''} ${tags['charging_station:operational_status'] || ''} ${tags.disused || ''} ${tags['disused:amenity'] || ''}`;
  const out = /\b(no|closed|disused|abandoned|out_of_service|broken)\b/i.test(condition) || tags.amenity !== 'charging_station';
  return { status: out ? 'out' : 'active', occupancy: 'unknown' };
}

export function routeBbox(geometry) {
  const lats = geometry.map((p) => p[1]), lons = geometry.map((p) => p[0]);
  const padLat = CORRIDOR_KM / 111, padLon = CORRIDOR_KM / (111 * Math.cos(radians((Math.min(...lats) + Math.max(...lats)) / 2)));
  return [Math.max(-90, Math.min(...lats) - padLat), Math.max(-180, Math.min(...lons) - padLon), Math.min(90, Math.max(...lats) + padLat), Math.min(180, Math.max(...lons) + padLon)].map((n) => n.toFixed(4)).join(',');
}

export function makeLidlQuery(bbox) {
  const keys = ['["brand"="Lidl"]', '["brand:wikidata"="Q151954"]', '["name"="Lidl"]', '["name"="LIDL"]', '["operator"="Lidl"]'];
  return `[out:json][timeout:30];(${keys.map((key) => `nwr${key}(${bbox});`).join('')});out center tags;`;
}

export function makeNearbyChargersQuery(shopPoints) {
  const clauses = shopPoints.map(([lon, lat]) => `nwr["amenity"="charging_station"](around:${SHOP_RADIUS_M},${lat.toFixed(5)},${lon.toFixed(5)});nwr["disused:amenity"="charging_station"](around:${SHOP_RADIUS_M},${lat.toFixed(5)},${lon.toFixed(5)});`);
  return `[out:json][timeout:30];(${clauses.join('')});out center tags;`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOverpass(base, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MIRROR_TIMEOUT_MS);
  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal
    });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    const data = await response.json();
    if (!Array.isArray(data.elements)) throw new Error('réponse invalide');
    return data.elements;
  } finally { clearTimeout(timeout); }
}

// 429 = un créneau encore occupé pour notre IP, 504 = serveur trop chargé : les deux se libèrent souvent en quelques
// secondes, on réessaie une fois avant de passer au miroir suivant. Le miroir qui a répondu est réutilisé ensuite.
let preferredMirror = null;
async function loadOverpass(query) {
  const errors = [];
  const order = preferredMirror ? [preferredMirror, ...OVERPASS_URLS.filter((url) => url !== preferredMirror)] : OVERPASS_URLS;
  for (const base of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const elements = await fetchOverpass(base, query);
        preferredMirror = base;
        return elements;
      } catch (error) {
        if ((error.status === 429 || error.status === 504) && attempt === 0) { await sleep(5000); continue; }
        errors.push(`${new URL(base).host}: ${error.name === 'AbortError' ? 'délai dépassé' : error.message}`);
        break;
      }
    }
  }
  preferredMirror = null;
  throw new Error(`La base OpenStreetMap est momentanément indisponible (${errors.join(' · ')}). Réessayez dans quelques instants.`);
}

// Fusionne les bornes d'un même site : puissance max, nombre de bornes, site « hors service » seulement si toutes
// ses bornes le sont, tarif « mixed » si les bornes divergent. Par défaut deux bornes à moins de SITE_RADIUS_KM
// forment un site ; `sameSite(site, station)` permet un autre critère (ex. identifiant de station IRVE).
const byDistance = (site, station) => distanceKm([site.lon, site.lat], [station.lon, station.lat]) <= SITE_RADIUS_KM;
export function groupSites(stations, sameSite = byDistance) {
  const sites = [];
  for (const station of stations) {
    const site = sites.find((s) => sameSite(s, station));
    if (!site) { sites.push({ ...station, count: 1, ids: [station.id] }); continue; }
    site.count++;
    site.ids.push(station.id);
    site.powerKw = Math.max(site.powerKw, station.powerKw);
    if (station.status === 'active') site.status = 'active';
    if (site.fee !== station.fee) site.fee = site.fee === 'unknown' ? station.fee : station.fee === 'unknown' ? site.fee : 'mixed';
    if (station.association === 'Lidl identifié') site.association = station.association;
    site.operator ||= station.operator;
    if (site.address === 'Adresse non renseignée') site.address = station.address;
    if (site.name === 'Recharge Lidl') site.name = station.name;
    site.connector = [...new Set([...site.connector.split(', '), ...station.connector.split(', ')].filter(Boolean))].join(', ');
    if (station.offsetKm < site.offsetKm) Object.assign(site, { lat: station.lat, lon: station.lon, offsetKm: station.offsetKm, distanceFromStartKm: station.distanceFromStartKm, anchor: station.anchor });
  }
  return sites;
}

// Retourne { stations, warnings }. `onProgress(text)` est optionnel et sert à afficher l'avancement.
// Si la recherche des bornes sur les parkings (étape 2) échoue, on renvoie quand même les bornes taguées Lidl
// avec un avertissement plutôt qu'une erreur : mode dégradé.
export async function getChargersAlongRoute(route, onProgress = () => {}) {
  const lidl = await loadOverpass(makeLidlQuery(routeBbox(route.geometry)));
  const located = (item) => ({ item, point: coords(item) });
  const inCorridor = lidl.map(located).filter(({ point }) => point.every(Number.isFinite)).map((entry) => ({ ...entry, position: positionOnRoute(entry.point, route.geometry) })).filter(({ position }) => position.offsetKm <= CORRIDOR_KM);
  const shops = inCorridor.filter(({ item }) => item.tags?.shop === 'supermarket' && isLidl(item.tags));
  onProgress(`${shops.length} magasin${shops.length > 1 ? 's' : ''} Lidl dans le corridor. Recherche des bornes sur leurs parkings…`);

  const nearby = [], warnings = [];
  try {
    for (let offset = 0; offset < shops.length; offset += SHOPS_PER_QUERY) {
      nearby.push(...await loadOverpass(makeNearbyChargersQuery(shops.slice(offset, offset + SHOPS_PER_QUERY).map((s) => s.point))));
    }
  } catch (error) {
    warnings.push(`Résultats partiels : la recherche des bornes sur les parkings Lidl a échoué (${error.message.replace(/^La base OpenStreetMap est momentanément indisponible \((.*)\)\..*$/, '$1')}). Seules les bornes explicitement taguées Lidl sont affichées.`);
  }

  const seen = new Set();
  const candidates = [...inCorridor.filter(({ item }) => isCharger(item.tags)), ...nearby.filter((item) => isCharger(item.tags)).map(located)];
  const stations = candidates.map(({ item, point, position }) => {
    const id = `${item.type}/${item.id}`;
    if (seen.has(id) || !point.every(Number.isFinite)) return null;
    seen.add(id);
    position ??= positionOnRoute(point, route.geometry);
    if (position.offsetKm > CORRIDOR_KM) return null;
    const [lon, lat] = point;
    const tags = item.tags;
    const direct = isLidl(tags);
    const nearestShop = shops.map((shop) => ({ shop, km: distanceKm(point, shop.point) })).sort((a, b) => a.km - b.km)[0];
    if (!direct && (!nearestShop || nearestShop.km > SHOP_RADIUS_M / 1000)) return null;
    const shopTags = nearestShop?.shop.item.tags || {};
    const address = [tags['addr:housenumber'] || shopTags['addr:housenumber'], tags['addr:street'] || shopTags['addr:street'], tags['addr:city'] || shopTags['addr:city']].filter(Boolean).join(' ');
    const connector = Object.keys(tags).filter((key) => /^socket:[^:]+$/.test(key) && tags[key] !== '0').map((key) => key.slice(7).replace('type2_combo', 'CCS').replace('type2', 'Type 2').replace('chademo', 'CHAdeMO')).join(', ');
    return {
      id,
      name: tags.name || (shopTags.name ? `Recharge ${shopTags.name}` : 'Recharge Lidl'),
      address: address || 'Adresse non renseignée',
      lat, lon,
      powerKw: powerFromTags(tags),
      ...statusFromTags(tags),
      source: 'osm',
      fee: tags.fee === 'no' ? 'free' : tags.fee === 'yes' ? 'paid' : 'unknown',
      access: tags.access || 'unknown',
      operator: tags.operator || tags.brand || tags.network || '',
      connector,
      sourceUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
      association: direct ? 'Lidl identifié' : 'Sur site Lidl (à confirmer)',
      ...position
    };
  }).filter(Boolean);
  return { stations: groupSites(stations).sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm), warnings };
}
