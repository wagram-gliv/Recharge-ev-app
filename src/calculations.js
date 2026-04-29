export function computeAutonomy({ batteryCapacity, soc, consumption }) {
  const availableEnergy = (batteryCapacity * soc) / 100;
  const theoreticalRangeKm = (availableEnergy / consumption) * 100;

  const usableSafe = (batteryCapacity * (soc - 15)) / 100;
  const safeRangeKm = Math.max(0, (usableSafe / consumption) * 100);

  const usableAdvanced = (batteryCapacity * (soc - 5)) / 100;
  const advancedRangeKm = Math.max(0, (usableAdvanced / consumption) * 100);

  return { availableEnergy, theoreticalRangeKm, safeRangeKm, advancedRangeKm };
}

export function estimateSocAtDistance({ batteryCapacity, availableEnergy, consumption, distanceKm }) {
  const consumedEnergy = (distanceKm * consumption) / 100;
  const remainingEnergy = availableEnergy - consumedEnergy;
  return (remainingEnergy / batteryCapacity) * 100;
}
