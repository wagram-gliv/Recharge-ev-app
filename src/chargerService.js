import { APP_CONFIG } from './config.js';
import { MOCK_CHARGERS } from './mockChargers.js';

function enrich(chargers, tripDistanceKm) {
  return chargers.map((c) => ({ ...c, distanceToDestinationKm: Math.max(0, tripDistanceKm - c.distanceFromStartKm) }));
}

export async function getChargersAlongRoute({ tripDistanceKm, minPowerKw }) {
  // MVP: couche mockée remplaçable par une API réelle.
  const filtered = MOCK_CHARGERS.filter((c) => c.powerKw >= minPowerKw && c.distanceFromStartKm <= tripDistanceKm + APP_CONFIG.ROUTE_BUFFER_KM);
  return enrich(filtered, tripDistanceKm);
}

export function chooseRecommendation(chargers, minSoc, maxSoc, reachableDistanceKm, estimateSocFn) {
  const reachable = chargers
    .filter((c) => c.distanceFromStartKm <= reachableDistanceKm)
    .map((c) => ({ ...c, socAtArrival: estimateSocFn(c.distanceFromStartKm) }));

  if (!reachable.length) return null;

  const inWindow = reachable.filter((c) => c.socAtArrival >= minSoc && c.socAtArrival <= maxSoc);
  const candidates = inWindow.length ? inWindow : reachable.filter((c) => c.socAtArrival >= minSoc);
  if (!candidates.length) return null;

  candidates.sort((a, b) => b.distanceFromStartKm - a.distanceFromStartKm);
  return candidates[0];
}
