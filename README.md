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

## Sources de bornes
1. **Primaire — fichier consolidé IRVE (data.gouv.fr)** (`src/irveService.js`) : toutes les bornes publiques déclarées en France, via l'API tabulaire `tabular-api.data.gouv.fr` (sans clé, CORS ouvert, ~0,7 s par page de 200 lignes). Filtre `nom_enseigne contains "Lidl"` (insensible à la casse, couvre aussi les lignes opérateur/aménageur Lidl) sur la boîte englobante du trajet, pages chargées 6 par 6, puis regroupement par `id_station_itinerance`. Fournit puissance, opérateur, gratuité, connecteurs, date de mise à jour. Pas d'état hors service : les bornes sont « déclarées en service ».
2. **Secours — OpenStreetMap / Overpass** (`src/chargerService.js`), utilisé seulement si data.gouv.fr échoue : deux requêtes légères (tout ce qui est tagué Lidl dans la boîte englobante — filtres par égalité indexés — puis les bornes à ≤ 120 m des magasins du corridor). Quatre miroirs à tour de rôle (`OVERPASS_URLS`), retry sur 429/504. Certains réseaux d'entreprise sont bloqués par `overpass-api.de` (HTTP 406) et les autres miroirs sont souvent saturés le soir : c'est pourquoi ce n'est plus la source primaire.

## Comment ça marche
1. **Itinéraire** — géocodage des deux adresses puis `directions/driving-car` (ORS).
2. **Candidates** — source IRVE (ou OSM en secours), voir ci-dessus ; côté client, seules les bornes à ≤ 15 km à vol d'oiseau de la route sont conservées.
3. **Détours** — pour chaque candidate, le point de l'itinéraire le plus proche sert d'ancrage ; l'API Matrix d'ORS calcule le trajet ancrage → borne par lots de 25 (1 requête par lot).
4. **Sélection** — gardées si détour ≤ 10 km **ou** ≤ 15 min. Détour ≤ 1,5 km ⇒ « Sur l'itinéraire ».
5. **État** — IRVE : « Déclarée en service (IRVE) ». OSM : `operational_status`, `disused*` etc. ⇒ « Hors service signalée », sinon « En service (OSM) ».

### Limites connues
- **Occupation en temps réel** : aucune source publique gratuite ne l'expose pour les bornes Lidl. Le champ `occupancy` est prévu dans le modèle (`'unknown'`) pour brancher une source live plus tard ; l'interface affiche « Occupation : non disponible ».
- Le fichier IRVE dépend des déclarations des opérateurs (puissance parfois saisie en W, adresses inégales). Il n'indique pas les pannes.
- En secours, Overpass peut être lent ou saturé (jusqu'à 40 s par miroir).
- Quota ORS gratuit ≈ 40–50 requêtes/min : une recherche consomme 3 requêtes + 1 par lot de 25 sites.

## Données de test
- Départ `Paris, France` → Arrivée `Lyon, France`
- Véhicule : batterie `77` kWh, charge `62` %, conso `18` kWh/100 km

## Déploiement VPS — https://charge.gliv.fr
Pile Docker `charge` sur le VPS (`51.75.143.97`, utilisateur `deploy`), fichiers dans `deploy/vps/` :
- `docker-compose.yml` : un conteneur `charge-web` (`caddy:2-alpine`) qui sert le dépôt monté en lecture seule, joint au réseau `app_default` du Caddy frontal partagé (`~/max-platform/max-platform/Caddyfile`, projet `app`).
- `Caddyfile` : ne sert que `index.html`, `styles.css`, `src/` ; tout autre chemin renvoie `index.html` ; `Cache-Control: no-cache`.
- `deploy.sh` : `git reset --hard origin/main` + `docker compose up -d`.

Mise à jour après un push sur `main` :
```bash
ssh deploy@51.75.143.97 ~/apps/charge/deploy/vps/deploy.sh
```
Le bloc `charge.gliv.fr { … reverse_proxy charge-web:80 }` est dans le Caddyfile frontal ; le DNS est en « DNS only » (pas de proxy Cloudflare), Caddy obtient et renouvelle le certificat Let's Encrypt automatiquement (défi HTTP-01). Si un jour le domaine passe derrière le proxy Cloudflare, le défi HTTP sera redirigé : ajouter `tls internal` (mode Full) ou un certificat Origin CA, puis `docker exec app-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.

## Déploiement Vercel
Site statique : **Framework Preset** = `Other`, **Root Directory** = `.`, Build/Output vides. `vercel.json` force le fallback vers `index.html`.

En cas de `404: NOT_FOUND` : vérifier que `index.html` est à la racine du dépôt et que la **Production Branch** (Settings > Git) est bien `main`, puis **Redeploy** sans cache.

### Message « Clé OpenRouteService manquante »
La version déployée ne contient pas de clé : vérifier `src/config.js` sur la branche `main` dans GitHub (`ORS_API_KEY: '…'` non vide), committer, puis **Redeploy** sans cache. Dans le log Vercel, la ligne **Commit** doit correspondre au dernier commit GitHub.
