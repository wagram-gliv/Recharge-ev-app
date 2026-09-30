import { getRoute, getDrivingDetours } from './mapService.js';
import { getChargersAlongRoute, distanceKm } from './chargerService.js';
import { estimateSocAtDistance } from './calculations.js';

// Critère de détour : une borne est retenue si le détour routier depuis l'itinéraire est ≤ 10 km OU ≤ 15 min.
const MAX_DETOUR_KM = 10;
const MAX_DETOUR_MIN = 15;
const ON_ROUTE_KM = 1.5; // en dessous, la borne est considérée "sur l'itinéraire"
const FAST_KW = 50;

const $ = (id) => document.getElementById(id);
const form = $('planner-form');
const message = $('messages');
const results = $('results');
const list = $('station-list');
const submit = $('submit-button');
let map, markers, routeLine, stations = [], activeFilter = 'all', currentRoute;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const fmt = (number, digits = 0) => Number(number).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits });

function setMessage(text, type = 'info') { message.innerHTML = text ? `<div class="message ${type}">${escapeHtml(text)}</div>` : ''; }
const isFast = (station) => station.powerKw >= FAST_KW;
const isSlow = (station) => station.powerKw > 0 && station.powerKw < FAST_KW;
const powerClass = (station) => station.status === 'out' ? 'offline' : isFast(station) ? 'fast' : isSlow(station) ? 'slow' : 'unknown';
const colors = { offline: '#e05454', fast: '#e8b425', slow: '#3f83e6', unknown: '#8b98a8' };
const detourLabel = (station) => station.onRoute ? 'Sur l’itinéraire' : `${fmt(station.detourKm, 1)} km · ${fmt(station.detourMinutes)} min`;
const statusLabel = (station) => station.status === 'out' ? 'Hors service signalée' : 'En service (OSM)';

function renderMap(route, visible) {
  if (!map) {
    map = L.map('map', { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  if (routeLine) map.removeLayer(routeLine);
  markers.clearLayers();
  // Le conteneur vient d'être affiché : recalculer sa taille et fixer la vue AVANT d'ajouter les tracés,
  // sinon le rendu vectoriel de Leaflet n'a pas de bornes et rien ne s'affiche.
  map.invalidateSize();
  routeLine = L.polyline(route.geometry.map(([lon, lat]) => [lat, lon]), { color: '#2864bc', weight: 5, opacity: .9 });
  map.fitBounds(routeLine.getBounds(), { padding: [34, 34], animate: false });
  routeLine.addTo(map);
  L.circleMarker([route.start[1], route.start[0]], { radius: 8, color: '#10223d', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(markers).bindPopup('Départ');
  L.circleMarker([route.end[1], route.end[0]], { radius: 8, color: '#10223d', fillColor: '#fff', fillOpacity: 1, weight: 3 }).addTo(markers).bindPopup('Arrivée');
  for (const station of visible) {
    // Les bornes sur l'itinéraire sont dessinées plus grandes avec un liseré sombre ; les détours restent plus discrets.
    const marker = L.circleMarker([station.lat, station.lon], {
      radius: station.onRoute ? 11 : 8, color: station.onRoute ? '#10223d' : '#fff', weight: 3,
      fillColor: colors[powerClass(station)], fillOpacity: station.onRoute ? 1 : .85
    }).addTo(markers);
    marker.bindPopup(`<b>${escapeHtml(station.name)}</b>${station.count > 1 ? ` · ${station.count} bornes` : ''}<br>${station.powerKw ? `${fmt(station.powerKw)} kW` : 'Puissance inconnue'} · ${statusLabel(station)}<br>${escapeHtml(detourLabel(station))}`);
    station.marker = marker;
  }
}

function stationCard(station, index) {
  const power = station.powerKw ? `${fmt(station.powerKw)} kW` : 'Puissance inconnue';
  const category = isFast(station) ? 'Recharge rapide' : isSlow(station) ? 'Recharge standard' : 'Puissance à vérifier';
  const fee = station.fee === 'free' ? 'Gratuite indiquée' : station.fee === 'paid' ? 'Payante indiquée' : station.fee === 'mixed' ? 'Tarif variable' : 'Tarif inconnu';
  const status = station.status === 'out' ? '<span class="bad">Hors service signalée</span>' : '<span class="ok">En service (OSM)</span>';
  const count = station.count > 1 ? `<span>${station.count} bornes</span>` : '';
  const soc = station.socAtArrival == null ? '' : `<span class="soc">${fmt(station.socAtArrival)} % estimés à l’arrivée${station.socAtArrival < 10 ? ' · charge faible' : ''}</span>`;
  return `<article class="station-card${station.onRoute ? ' on-route' : ''}" data-id="${escapeHtml(station.id)}">
    <div class="card-top"><span class="station-index">${String(index + 1).padStart(2, '0')}</span>${station.onRoute ? '<span class="route-pill">Sur l’itinéraire</span>' : ''}<span class="power-pill ${powerClass(station)}">${escapeHtml(power)}</span></div>
    <h4>${escapeHtml(station.name)}</h4><p class="address">${escapeHtml(station.address)}</p>
    <div class="card-badges">${count}<span>${category}</span>${status}<span>Occupation : non disponible</span><span>${fee}</span></div>
    <div class="card-metrics"><div><small>APRÈS LE DÉPART</small><b>${fmt(station.routeKm)} km</b></div><div><small>DÉTOUR DEPUIS LA ROUTE</small><b>${escapeHtml(detourLabel(station))}</b></div></div>${soc}
    <div class="card-links"><button type="button" class="locate" data-id="${escapeHtml(station.id)}">Voir sur la carte ↗</button><a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(station.lat + ',' + station.lon)}" target="_blank" rel="noopener noreferrer">Y aller ↗</a><a href="${station.sourceUrl}" target="_blank" rel="noopener noreferrer">Fiche OSM ↗</a></div>
    <p class="association">${escapeHtml(station.association)}${station.operator ? ` · Opérateur : ${escapeHtml(station.operator)}` : ''}${station.connector ? ` · ${escapeHtml(station.connector)}` : ''}</p>
  </article>`;
}

const FILTERS = {
  all: () => true,
  fast: isFast,
  slow: isSlow,
  onroute: (station) => station.onRoute,
  free: (station) => station.fee === 'free',
  out: (station) => station.status === 'out'
};
const visibleStations = () => stations.filter(FILTERS[activeFilter] || FILTERS.all);

function renderResults(route) {
  const visible = visibleStations();
  $('trip-distance').textContent = `${fmt(route.distanceKm)} km`;
  $('station-count').textContent = String(stations.length);
  $('onroute-count').textContent = String(stations.filter((s) => s.onRoute).length);
  $('visible-count').textContent = `${visible.length} affichée${visible.length > 1 ? 's' : ''}`;
  list.innerHTML = visible.length ? visible.map(stationCard).join('') : `<div class="empty-state"><span>⌁</span><h4>Aucune borne dans cette sélection</h4><p>${activeFilter === 'all' ? 'Aucune borne Lidl à moins de 10 km ou 15 min de ce trajet. Essayez un autre itinéraire.' : 'Essayez un autre filtre pour voir les bornes repérées.'}</p></div>`;
  results.classList.remove('hidden');
  renderMap(route, visible);
}

document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach((item) => item.classList.toggle('active', item === button));
  if (currentRoute) renderResults(currentRoute);
}));
list.addEventListener('click', (event) => {
  const button = event.target.closest('.locate');
  if (!button) return;
  const station = stations.find((item) => item.id === button.dataset.id);
  if (station?.marker) { map.setView([station.lat, station.lon], Math.max(map.getZoom(), 13)); station.marker.openPopup(); }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const origin = $('origin').value.trim(), destination = $('destination').value.trim();
  const batteryCapacity = Number($('batteryCapacity').value), soc = Number($('soc').value), consumption = Number($('consumption').value);
  if (!origin || !destination) return setMessage('Renseignez un départ et une arrivée.', 'error');
  if (origin.toLowerCase() === destination.toLowerCase()) return setMessage('Le départ et l’arrivée doivent être différents.', 'error');
  if (!(batteryCapacity > 0 && soc >= 0 && soc <= 100 && consumption > 0)) return setMessage('Vérifiez les informations du véhicule.', 'error');
  submit.disabled = true; submit.innerHTML = 'Recherche en cours…';
  results.classList.add('hidden');
  setMessage('Calcul de l’itinéraire…');
  try {
    const route = await getRoute(origin, destination);
    if (!route.geometry?.length) throw new Error('Aucun itinéraire trouvé.');
    setMessage(`Itinéraire de ${fmt(route.distanceKm)} km calculé. Recherche des bornes Lidl dans OpenStreetMap (jusqu’à 40 s)…`);
    const { stations: candidates, warnings } = await getChargersAlongRoute(route, setMessage);
    setMessage(`${candidates.length} borne${candidates.length > 1 ? 's' : ''} Lidl repérée${candidates.length > 1 ? 's' : ''} à proximité. Vérification des détours routiers…`);
    const detours = await getDrivingDetours(candidates);
    const geometryKm = route.geometry.slice(1).reduce((sum, point, index) => sum + distanceKm(route.geometry[index], point), 0);
    let unverified = 0;
    stations = candidates.map((station, index) => {
      const detour = detours[index];
      if (!detour) { unverified++; return null; }
      if (!(detour.detourKm <= MAX_DETOUR_KM || detour.detourMinutes <= MAX_DETOUR_MIN)) return null;
      const routeKm = geometryKm ? station.distanceFromStartKm / geometryKm * route.distanceKm : 0;
      return {
        ...station, ...detour, routeKm,
        onRoute: detour.detourKm <= ON_ROUTE_KM,
        socAtArrival: estimateSocAtDistance({ batteryCapacity, availableEnergy: batteryCapacity * soc / 100, consumption, distanceKm: routeKm + detour.detourKm })
      };
    }).filter(Boolean).sort((a, b) => a.routeKm - b.routeKm);
    currentRoute = route;
    renderResults(route);
    const notes = [...warnings];
    if (candidates.length && !stations.length) notes.push(unverified ? 'Des bornes Lidl ont été repérées mais leur détour routier n’a pas pu être vérifié (quota cartographie). Réessayez dans une minute.' : 'Des bornes Lidl ont été repérées, mais aucune ne respecte le détour de 10 km ou 15 min.');
    else if (unverified) notes.push(`${unverified} site${unverified > 1 ? 's' : ''} ignoré${unverified > 1 ? 's' : ''} : détour routier non vérifiable pour le moment.`);
    setMessage(notes.join(' '), warnings.length ? 'warn' : 'info');
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    const text = error.message === 'NO_ORS_KEY' ? 'Clé OpenRouteService manquante dans src/config.js.' : /^(GEOCODE|ROUTE)_/.test(error.message) ? `Itinéraire indisponible (${error.message}). Vérifiez les adresses ou réessayez.` : error.message;
    setMessage(text || 'Une erreur est survenue. Réessayez.', 'error');
  } finally { submit.disabled = false; submit.innerHTML = 'Trouver les bornes <span>↗</span>'; }
});
