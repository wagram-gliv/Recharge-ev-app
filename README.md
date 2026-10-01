# Lidl en route

Find every **Lidl EV charging station** on a trip from A to B — on the route, or within **10 km / 15 min** of it.

**Live:** https://charge.gliv.fr · mirror: https://recharge-ev-app.vercel.app
*(The UI is in French.)*

## What it does

Enter a start and a destination. The app:

1. computes the driving route (OpenRouteService);
2. finds all Lidl charging sites in the corridor around it (official French IRVE data, OpenStreetMap as fallback);
3. computes the **real driving detour** from the route to each site and keeps those within **10 km or 15 min**;
4. shows them on a map and in a list, sorted by position along the trip.

| Feature | Details |
|---|---|
| On the route vs. detour | Sites within 1.5 km of the route get an "Sur l'itinéraire" badge, a larger map marker and their own filter; others show "X km · Y min" of detour |
| Charging speed filters | All · Fast ≥ 50 kW · Slow < 50 kW · On route · Free · Out of service |
| Status | "Déclarée en service (IRVE)" / "En service (OSM)" / "Hors service signalée" (OSM tags only) |
| Per-site info | Power, number of charge points, connectors (CCS / Type 2 / CHAdeMO…), operator, free/paid, address, last update, links to navigate and to the source |
| Battery estimate (optional) | Enter capacity, current charge and consumption to see the estimated charge on arrival at each site |
| Live occupancy | **Not available** — no free public source exposes it for Lidl chargers. The UI says "Occupation : non disponible"; the data model already has an `occupancy` field for a future live source |

## Quick start

No build step, no dependencies — it is a static site using ES modules, so it needs an HTTP server (opening `index.html` from disk will not work).

```bash
python3 -m http.server 4173      # or: npx serve . -l 4173
# open http://localhost:4173
```

Test trip pre-filled in the form: `Paris, France` → `Lyon, France`, battery 77 kWh, charge 62 %, 18 kWh/100 km.

## Configuration

`src/config.js`:

| Key | Purpose |
|---|---|
| `ORS_API_KEY` | OpenRouteService key (free at https://openrouteservice.org) — used for geocoding, routing and the detour matrix |
| `ORS_BASE_URL` | Defaults to `https://api.openrouteservice.org` |

> The app runs entirely in the browser, so the key is visible to anyone who opens the site. Use a key dedicated to this project and restrict it to your domains in the ORS dashboard. The free quota is ~40–50 requests/min; one search uses ~3 requests plus one per 25 sites.

## Architecture

```
index.html, styles.css          UI (Leaflet map from unpkg)
src/
  main.js                       form, orchestration, rendering, filters
  mapService.js                 ORS geocoding, routing, detour Matrix (batched, retry + split on failure)
  irveService.js                PRIMARY charger source: data.gouv.fr consolidated IRVE file
  chargerService.js             FALLBACK source: OpenStreetMap / Overpass; geometry helpers, site grouping
  calculations.js               battery estimate
  config.js                     ORS key / base URL
deploy/vps/                     docker-compose.yml, Caddyfile, deploy.sh for the VPS
vercel.json                     fallback rewrite to index.html
```

### Data flow

1. **Route** — geocode both places, then `directions/driving-car`.
2. **Candidates**
   - *Primary — IRVE.* `tabular-api.data.gouv.fr` (no key, CORS open, ≤ 200 rows per page, fetched 6 pages at a time) filtered on `nom_enseigne contains "Lidl"` inside the route's bounding box. Rows are charge points; they are grouped by `id_station_itinerance` into sites.
   - *Fallback — OpenStreetMap.* Only used if IRVE fails (a warning is shown). Two light Overpass queries: everything tagged Lidl in the bounding box, then chargers within 120 m of the Lidl shops found in the corridor. Four mirrors are tried in turn with retry on 429/504.
   - Either way, only sites within 15 km (straight line) of the route are kept as candidates.
3. **Detours** — each candidate is anchored to its closest point on the route; the ORS Matrix API gives the anchor → site driving distance/time (batches of 25; a failing batch is retried, then split down to single pairs).
4. **Selection** — keep detour ≤ 10 km **or** ≤ 15 min; ≤ 1.5 km means "on the route".

## Deployment

### VPS — https://charge.gliv.fr

A `charge` Docker stack on the VPS (`51.75.143.97`, user `deploy`, files in `deploy/vps/`):

- `docker-compose.yml` — a `charge-web` container (`caddy:2-alpine`) serving the repo mounted read-only, attached to the `app_default` network of the shared front Caddy (`~/max-platform/max-platform/Caddyfile`, compose project `app`).
- `Caddyfile` — serves only `index.html`, `styles.css` and `src/`; any other path returns `index.html`; `Cache-Control: no-cache`.
- `deploy.sh` — `git reset --hard origin/main` + `docker compose up -d`.
- The front Caddy has a `charge.gliv.fr { … reverse_proxy charge-web:80 }` block. DNS is **DNS-only** (no Cloudflare proxy); Caddy issues and renews the Let's Encrypt certificate itself (HTTP-01). If the domain is ever put behind the Cloudflare proxy, the HTTP challenge gets redirected — add `tls internal` (Full mode) or an Origin CA certificate, then `docker exec app-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.

Update after pushing to `main`:

```bash
ssh -i ~/.ssh/id_ed25519 deploy@51.75.143.97 ~/apps/charge/deploy/vps/deploy.sh
```

### Vercel — https://recharge-ev-app.vercel.app

Static site, auto-deployed from `main`: Framework Preset `Other`, Root Directory `.`, empty Build/Output. `vercel.json` rewrites everything to `index.html`.

- `404: NOT_FOUND` → check `index.html` is at the repo root and Production Branch (Settings → Git) is `main`, then Redeploy without cache.
- "Clé OpenRouteService manquante" → `ORS_API_KEY` is empty in `src/config.js` on `main`; fix, commit, Redeploy.

## Known limitations

- **No live occupancy** for Lidl chargers (no free public source).
- **IRVE** is declarative: it lists chargers as "declared in service" and does not report outages. Power is occasionally entered in W by operators; addresses vary in quality. "Hors service signalée" only appears in the OpenStreetMap fallback.
- **Overpass (fallback)** can be slow or saturated (up to ~40 s per mirror), and `overpass-api.de` answers HTTP 406 to some corporate networks.
- OpenStreetMap-sourced power/fee data is often missing → "Puissance inconnue" (excluded by the Fast/Slow filters, shown under "All").

## Data sources & licences

- Charging stations: [Fichier consolidé des bornes de recharge (IRVE)](https://transport.data.gouv.fr/datasets/fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques), data.gouv.fr, Licence Ouverte — fallback: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
- Routing & geocoding: [OpenRouteService](https://openrouteservice.org).
- Map tiles: OpenStreetMap; map library: [Leaflet](https://leafletjs.com).

See [PROGRESS.md](PROGRESS.md) for the project history, decisions and open items.
