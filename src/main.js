import { computeAutonomy, estimateSocAtDistance } from './calculations.js';
import { getRoute } from './mapService.js';
import { getChargersAlongRoute, chooseRecommendation } from './chargerService.js';
import { APP_CONFIG } from './config.js';

const form = document.getElementById('planner-form');
const messagesEl = document.getElementById('messages');
const resultsEl = document.getElementById('results');
const mapEl = document.getElementById('map');
let map;

function msg(text, type = 'warn') { return `<div class="msg ${type}">${text}</div>`; }
function clearUI() { messagesEl.innerHTML = ''; resultsEl.classList.add('hidden'); mapEl.classList.add('hidden'); }
function num(v) { return Number.parseFloat(v); }
function km(v) { return `${v.toFixed(1)} km`; }
function pct(v) { return `${v.toFixed(1)}%`; }

function validate(input) {
  const errors = [];
  if (!(input.batteryCapacity > 0)) errors.push('La capacité batterie doit être supérieure à 0.');
  if (!(input.soc >= 0 && input.soc <= 100)) errors.push('Le pourcentage batterie doit être entre 0 et 100.');
  if (!(input.consumption > 0)) errors.push('La consommation moyenne doit être supérieure à 0.');
  if (!input.origin.trim()) errors.push('L’origine ne doit pas être vide.');
  if (!input.destination.trim()) errors.push('La destination ne doit pas être vide.');
  return errors;
}

function renderMap(route, chargers, secure, advanced) {
  const toLatLon = ([lon, lat]) => [lat, lon];
  mapEl.classList.remove('hidden');
  if (map) map.remove();
  map = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

  const line = L.polyline(route.geometry.map(toLatLon), { color: '#0077ff', weight: 5 }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [20, 20] });

  L.marker(toLatLon(route.start)).addTo(map).bindPopup('Origine');
  L.marker(toLatLon(route.end)).addTo(map).bindPopup('Destination');

  chargers.forEach((c) => L.circleMarker([c.lat, c.lon], { radius: 6, color: '#00b36f' }).addTo(map).bindPopup(`${c.name} (${c.powerKw} kW)`));
  if (secure) L.circle([secure.lat, secure.lon], { radius: 3000, color: '#ff9800' }).addTo(map).bindPopup('Recommandation sécurisé');
  if (advanced) L.circle([advanced.lat, advanced.lon], { radius: 3000, color: '#7e57c2' }).addTo(map).bindPopup('Recommandation avancé');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearUI();

  const input = {
    batteryCapacity: num(document.getElementById('batteryCapacity').value),
    soc: num(document.getElementById('soc').value),
    consumption: num(document.getElementById('consumption').value),
    origin: document.getElementById('origin').value,
    destination: document.getElementById('destination').value
  };

  const errors = validate(input);
  if (errors.length) {
    messagesEl.innerHTML = errors.map((e) => msg(e, 'error')).join('');
    return;
  }

  const auto = computeAutonomy(input);
  if (input.soc <= 15) messagesEl.innerHTML += msg('Avertissement: SOC <= 15%, mode sécurisé critique.', 'warn');
  if (input.soc <= 5) messagesEl.innerHTML += msg('Avertissement: SOC <= 5%, mode avancé critique.', 'warn');

  try {
    let route;
    try {
      route = await getRoute(input.origin, input.destination);
    } catch (routeErr) {
      route = { distanceKm: 320, start: [2.3522, 48.8566], end: [4.8357, 45.764], geometry: [[2.3522,48.8566],[3.1,47.9],[4.1,46.7],[4.8357,45.764]] };
      messagesEl.innerHTML += msg(`API cartographie indisponible (${routeErr.message}): route mockée utilisée.`, 'warn');
    }

    let chosenChargers = [];
    let usedThreshold = null;
    for (const threshold of APP_CONFIG.CHARGER_POWER_STEPS_KW) {
      const candidates = await getChargersAlongRoute({ tripDistanceKm: route.distanceKm, minPowerKw: threshold });
      if (candidates.length) { chosenChargers = candidates; usedThreshold = threshold; break; }
    }

    if (!chosenChargers.length) {
      messagesEl.innerHTML += msg('Aucune borne >100kW, >43kW ou >20kW trouvée. Rechargez avant départ ou élargissez les critères.', 'error');
      return;
    }

    const estimateSoc = (distanceKm) => estimateSocAtDistance({
      batteryCapacity: input.batteryCapacity,
      availableEnergy: auto.availableEnergy,
      consumption: input.consumption,
      distanceKm
    });

    const secure = chooseRecommendation(chosenChargers, 15, 25, auto.safeRangeKm, estimateSoc);
    const advanced = chooseRecommendation(chosenChargers, 5, 15, auto.advancedRangeKm, estimateSoc);

    const block = (title, data) => data ? `<div class="card"><h3>${title}</h3><p><b>${data.name}</b><br>${data.address}<br>Puissance: ${data.powerKw} kW<br>Distance origine: ${km(data.distanceFromStartKm)}<br>Restant: ${km(data.distanceToDestinationKm)}<br>SOC estimé: ${pct(data.socAtArrival)}</p></div>` : `<div class="card"><h3>${title}</h3><p>Aucune borne atteignable.</p></div>`;

    resultsEl.innerHTML = `
      <h2>Résultats</h2>
      <p>Distance trajet: <b>${km(route.distanceKm)}</b> | Seuil utilisé: <b>>= ${usedThreshold} kW</b></p>
      <p>Autonomie théorique: <b>${km(auto.theoreticalRangeKm)}</b> - Sécurisé: <b>${km(auto.safeRangeKm)}</b> - Avancé: <b>${km(auto.advancedRangeKm)}</b></p>
      <div class="cards">
        ${block('Proposition mode sécurisé (15%)', secure)}
        ${block('Proposition mode avancé (5%)', advanced)}
      </div>
    `;
    resultsEl.classList.remove('hidden');
    renderMap(route, chosenChargers, secure, advanced);
  } catch (err) {
    messagesEl.innerHTML += msg(`Erreur inattendue: ${err.message}`, 'error');
  }
});
