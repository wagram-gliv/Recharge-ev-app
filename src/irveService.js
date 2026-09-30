// Source primaire : fichier consolidé IRVE (toutes les bornes publiques déclarées en France, data.gouv.fr),
// interrogé via l'API tabulaire de data.gouv.fr — rapide, stable, CORS ouvert, sans clé.
// Chaque ligne est un point de charge (pdc) ; on les regroupe par station (id_station_itinerance).
import { routeBbox, positionOnRoute, groupSites, CORRIDOR_KM } from './chargerService.js';

const RESOURCE_ID = 'eb76d20a-8501-400e-b336-d85724de5435'; // consolidated-etalab-schema-irve-statique-latest
const API = `https://tabular-api.data.gouv.fr/api/resources/${RESOURCE_ID}/data/`;
const PAGE_SIZE = 200; // maximum autorisé par l'API
const PARALLEL_PAGES = 6;
const TIMEOUT_MS = 20000;
const COLUMNS = [
  'id_pdc_itinerance', 'id_station_itinerance', 'nom_station', 'nom_enseigne', 'nom_operateur', 'nom_amenageur',
  'adresse_station', 'consolidated_commune', 'puissance_nominale', 'nbre_pdc', 'gratuit', 'condition_acces',
  'prise_type_2', 'prise_type_combo_ccs', 'prise_type_chademo', 'prise_type_ef',
  'consolidated_latitude', 'consolidated_longitude', 'date_maj'
];
export const SOURCE_URL = 'https://transport.data.gouv.fr/datasets/fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques';

function pageUrl(bbox, page) {
  const [south, west, north, east] = bbox.split(',');
  const params = new URLSearchParams({
    nom_enseigne__contains: 'Lidl', // insensible à la casse ; couvre aussi les lignes dont l'opérateur/aménageur est Lidl
    consolidated_latitude__greater: south, consolidated_latitude__less: north,
    consolidated_longitude__greater: west, consolidated_longitude__less: east,
    columns: COLUMNS.join(','), page_size: PAGE_SIZE, page
  });
  return `${API}?${params}`;
}

async function fetchPage(bbox, page) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(pageUrl(bbox, page), { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.data)) throw new Error('réponse invalide');
    return data;
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? 'délai dépassé' : error.message);
  } finally { clearTimeout(timeout); }
}

const truthy = (value) => value === true || String(value).toLowerCase() === 'true';
// La puissance est en kW dans le schéma, mais certains déclarants saisissent des W.
const powerKw = (value) => { const n = Number(value) || 0; return n > 1000 ? n / 1000 : n; };

function toPost(row, geometry) {
  const lon = Number(row.consolidated_longitude), lat = Number(row.consolidated_latitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const position = positionOnRoute([lon, lat], geometry);
  if (position.offsetKm > CORRIDOR_KM) return null;
  const operator = row.nom_operateur || row.nom_amenageur || '';
  const commune = row.consolidated_commune || '';
  const address = [row.adresse_station, commune && !(row.adresse_station || '').toLowerCase().includes(commune.toLowerCase()) ? commune : ''].filter(Boolean).join(', ');
  return {
    id: `irve/${row.id_pdc_itinerance || `${row.id_station_itinerance}/${lat},${lon}`}`,
    siteId: row.id_station_itinerance || `${lat},${lon}`,
    name: row.nom_station || 'Recharge Lidl',
    address: address || 'Adresse non renseignée',
    lat, lon,
    powerKw: powerKw(row.puissance_nominale),
    status: 'active', occupancy: 'unknown', source: 'irve',
    fee: row.gratuit == null || row.gratuit === '' ? 'unknown' : truthy(row.gratuit) ? 'free' : 'paid',
    access: row.condition_acces || 'unknown',
    operator,
    connector: [truthy(row.prise_type_combo_ccs) && 'CCS', truthy(row.prise_type_chademo) && 'CHAdeMO', truthy(row.prise_type_2) && 'Type 2', truthy(row.prise_type_ef) && 'Prise E/F'].filter(Boolean).join(', '),
    sourceUrl: SOURCE_URL,
    association: /lidl/i.test(`${row.nom_operateur || ''} ${row.nom_amenageur || ''}`) ? 'Lidl identifié' : 'Sur site Lidl (enseigne déclarée)',
    updatedAt: row.date_maj || '',
    ...position
  };
}

// Retourne { stations, warnings } avec la même forme que chargerService (OpenStreetMap).
export async function getChargersAlongRoute(route, onProgress = () => {}) {
  const bbox = routeBbox(route.geometry);
  const first = await fetchPage(bbox, 1);
  const total = first.meta?.total ?? first.data.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  onProgress(`${total} point${total > 1 ? 's' : ''} de charge Lidl déclaré${total > 1 ? 's' : ''} dans la zone (data.gouv.fr). Filtrage sur le corridor…`);
  const rows = [...first.data];
  for (let page = 2; page <= pages; page += PARALLEL_PAGES) {
    const batch = await Promise.all(Array.from({ length: Math.min(PARALLEL_PAGES, pages - page + 1) }, (_, i) => fetchPage(bbox, page + i)));
    for (const chunk of batch) rows.push(...chunk.data);
  }
  const seen = new Set();
  const posts = rows.map((row) => toPost(row, route.geometry)).filter((post) => post && !seen.has(post.id) && seen.add(post.id));
  const stations = groupSites(posts, (site, post) => site.siteId === post.siteId).sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm);
  return { stations, warnings: [] };
}
