// Estimation de l'état de charge (%) après `distanceKm`, à consommation moyenne constante.
export function estimateSocAtDistance({ batteryCapacity, availableEnergy, consumption, distanceKm }) {
  const consumedEnergy = (distanceKm * consumption) / 100;
  const remainingEnergy = availableEnergy - consumedEnergy;
  return (remainingEnergy / batteryCapacity) * 100;
}
