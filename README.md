# Lidl en route · Bornes de recharge Lidl sur votre trajet

Application web statique (HTML/CSS/JS, sans build) qui, pour un trajet A → B :
- calcule l'itinéraire routier (OpenRouteService) ;
- repère **toutes les bornes de recharge Lidl** le long du parcours dans OpenStreetMap ;
- distingue les bornes **sur l'itinéraire** de celles à **≤ 10 km ou ≤ 15 min de détour** (détour routier réel, pas à vol d'oiseau) ;
- affiche l'**état** de chaque borne (en service / hors service signalée) et sa **puissance** ;
- permet de filtrer **rapides (≥ 50 kW)**, **lentes (< 50 kW)**, ou toutes, plus « sur l'itinéraire », « gratuites » et « hors service » ;
- optionnellement, estime la batterie restante à l'arrivée sur chaque borne.

## Lancer en local
```bash
npx serve . -l 4173      # ou : python3 -m http.server 4173
# puis ouvrir http://localhost:4173
```
Les modules ES exigent un serveur HTTP : ouvrir `index.html` directement depuis le disque ne fonctionne pas.

## Configuration
`src/config.js` :
- `ORS_API_KEY` : clé OpenRouteService (gratuite sur https://openrouteservice.org). Utilisée pour le géocodage, l'itinéraire et la matrice de détours.
- `ORS_BASE_URL` : `https://api.openrouteservice.org` par défaut.

L'application étant 100 % côté client, la clé est visible dans le navigateur : utilisez une clé dédiée au projet et surveillez le quota.

Les bornes proviennent de l'API Overpass (OpenStreetMap). Quatre miroirs sont essayés à tour de rôle (`src/chargerService.js` → `OVERPASS_URLS`).

## Comment ça marche
1. **Itinéraire** — géocodage des deux adresses puis `directions/driving-car` (ORS).
2. **Candidates** — deux requêtes Overpass légères :
   - tout ce qui est tagué Lidl (`brand=Lidl`, `brand:wikidata=Q151954`, `name=Lidl`, `operator=Lidl`) dans la boîte englobante du trajet — filtres par égalité, donc indexés et rapides ; côté client on ne garde que les magasins à ≤ 15 km de la route ;
   - toute borne à moins de 120 m de ces magasins (« Sur site Lidl (à confirmer) »), par lots de 100 magasins.
   Un `around` sur la polyligne du trajet ou une regex `~"lidl"` sont 10× plus coûteux et rejetés par Overpass dès que le serveur est chargé.
3. **Détours** — pour chaque candidate, le point de l'itinéraire le plus proche sert d'ancrage ; l'API Matrix d'ORS calcule le trajet ancrage → borne par lots de 25 (1 requête par lot).
4. **Sélection** — gardées si détour ≤ 10 km **ou** ≤ 15 min. Détour ≤ 1,5 km ⇒ « Sur l'itinéraire ».
5. **État** — `operational_status`, `disused*` etc. ⇒ « Hors service signalée », sinon « En service (OSM) ».

### Limites connues
- **Occupation en temps réel** : aucune source publique gratuite ne l'expose pour les bornes Lidl. Le champ `occupancy` est prévu dans le modèle (`'unknown'`) pour brancher une source live plus tard ; l'interface affiche « Occupation : non disponible ».
- Puissance, tarif et état dépendent de la qualité des données OpenStreetMap et peuvent manquer.
- Overpass peut être lent ou saturé (jusqu'à 40 s par miroir). Certains réseaux d'entreprise sont refusés par `overpass-api.de` (HTTP 406) ; les autres miroirs prennent le relais.
- Quota ORS gratuit ≈ 40–50 requêtes/min : une recherche consomme 3 requêtes + 1 par lot de 25 bornes.

## Données de test
- Départ `Paris, France` → Arrivée `Lyon, France`
- Véhicule : batterie `77` kWh, charge `62` %, conso `18` kWh/100 km

## Déploiement Vercel
Site statique : **Framework Preset** = `Other`, **Root Directory** = `.`, Build/Output vides. `vercel.json` force le fallback vers `index.html`.

En cas de `404: NOT_FOUND` : vérifier que `index.html` est à la racine du dépôt et que la **Production Branch** (Settings > Git) est bien `main`, puis **Redeploy** sans cache.

### Message « Clé OpenRouteService manquante »
La version déployée ne contient pas de clé : vérifier `src/config.js` sur la branche `main` dans GitHub (`ORS_API_KEY: '…'` non vide), committer, puis **Redeploy** sans cache. Dans le log Vercel, la ligne **Commit** doit correspondre au dernier commit GitHub.
