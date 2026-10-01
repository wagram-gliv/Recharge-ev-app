# Progress log — Lidl en route

Status as of **2026-10-01**: working and deployed on the VPS (https://charge.gliv.fr) and on Vercel (https://recharge-ev-app.vercel.app). Tip of `main`: `af04dc2`.

## Goal

Identify and show all Lidl EV charging stations on a trip A → B; highlight stations on the route and those within 10 km / 15 min of it; show whether each is active, out of service or busy; let the user show fast, slow or both.

| Requirement | Status |
|---|---|
| All Lidl chargers on a trip A → B | ✅ IRVE official data (primary), OpenStreetMap (fallback) |
| On the route vs. within 10 km / 15 min | ✅ real driving detour via ORS Matrix; ≤ 1.5 km = "on the route" |
| Active / out of service | ⚠️ partial — IRVE has no outage info ("declared in service"); "out of service" only from OSM tags in fallback mode |
| Busy (live occupancy) | ❌ not possible — no free public source; UI says "non disponible", data model has an `occupancy` field ready |
| Fast / slow / both | ✅ filters: All · ≥ 50 kW · < 50 kW (+ on route, free, out of service) |

## Timeline

### Starting point (before 2026-10-01)
`Recharge-ev-app` was an EV trip planner MVP ("next fast charger" with safe/advanced battery-reserve modes) using mocked chargers and OpenRouteService. Uncommitted work in progress had already begun the pivot to a Lidl-only tool (new UI, Overpass-based `chargerService.js`, ORS Directions detours).

### 1. Review and pivot completion — commit `e3d5956`
- Reviewed the uncommitted changes; syntax-checked all modules.
- **Overpass test showed the first design was broken**: `overpass-api.de` answered HTTP 406, other mirrors timed out or returned 429/504.
- Isolated the cause: regex tag filters (`~"lidl",i`) and `around:` on a 108-point route polyline were too expensive and rejected under load. Indexed equality filters (`brand=Lidl`, `brand:wikidata=Q151954`, …) in the route bounding box work (~10 s for Paris–Lyon).
- Rewrote `chargerService.js` as two light queries (Lidl-tagged objects in the bbox, then chargers within 120 m of corridor shops), 4 mirrors, retry on 429/504, degraded mode if step 2 fails.
- **Detours**: switched from one ORS Directions call per charger (would blow the ~40/min free quota and silently drop stations) to the ORS Matrix API, 25 pairs per request.
- Added: site grouping (OSM maps each post separately — one car park showed as 4–5 rows), operator, "on the route" badge/marker/filter, fast/slow filters, status badges, progress messages, warning banner.
- **Map bug fixed**: nothing rendered because layers were added before the map had a view/size (`Cannot read properties of undefined (reading 'parentNode')`). Fix: `invalidateSize()` + `fitBounds` before adding layers.
- Removed dead code (`mockChargers.js`, `computeAutonomy`); rewrote the README.

### 2. First deployment — Vercel
Pushed to `main`; Vercel auto-deployed to https://recharge-ev-app.vercel.app (verified the new JS was served).

### 3. User report: "OpenStreetMap momentarily unavailable" — commit `0c698f7`
From the user's browser, `overpass-api.de` failed to fetch and the other mirrors timed out. Relying on Overpass alone was too fragile.
- Evaluated alternatives: a guessed Opendatasoft dataset (`bornes-irve`) did not exist; the **data.gouv.fr tabular API** over the consolidated IRVE file worked (no key, CORS open, ~0.7 s per 200-row page, `nom_enseigne contains Lidl` → 10 722 Lidl charge points France-wide, 1 674 in the Paris–Lyon bbox).
- New `src/irveService.js` as **primary source**; Overpass kept as automatic fallback with a warning. Posts grouped by `id_station_itinerance`.
- Fixed a bug seen in the first IRVE browser run: one failed Matrix batch dropped 25 sites ("25 sites ignorés"). Batches are now retried once, then split down to single pairs.
- Result, Paris → Lyon, real browser, production: ~4–9 s total, 35 sites kept (vs 24 with OSM), 76/76 detours verified, power known for almost all sites (22–360 kW).

### 4. VPS deployment — https://charge.gliv.fr — commits `510a246` … `af04dc2`
- Inventory of the VPS (`51.75.143.97`, user `deploy`): shared front Caddy (`app-caddy-1`, project `app`, `~/max-platform/max-platform/Caddyfile`) already serving `max.`, `dmav.` and `golf.gliv.fr` as separate Docker stacks on the `app_default` network.
- Added `deploy/vps/` (`docker-compose.yml`, `Caddyfile`, `deploy.sh`): a `charge-web` container (`caddy:2-alpine`, repo mounted read-only) serving only `index.html`, `styles.css`, `src/`; repo cloned to `~/apps/charge`.
- Added a `charge.gliv.fr` block to the front Caddyfile (backups: `Caddyfile.bak-*`), validated and hot-reloaded. Sibling sites re-checked after the reload (max 303, dmav 200, golf 200).
- **TLS detour**: from the corporate network, DNS lookups returned Cloudflare edge IPs and HTTPS gave HTTP 525, so I wrongly concluded the domain was Cloudflare-proxied and configured `tls internal`. A real browser then showed a certificate warning. Checking DNS **from the VPS** (`1.1.1.1`, `8.8.8.8`) showed the domain is actually DNS-only → removed `tls internal`, Caddy obtained a Let's Encrypt certificate in 5 s (HTTP-01).
- `deploy.sh` initially lost its executable bit (committed from Windows); fixed in git (`100755`).
- Final verification in a real browser against https://charge.gliv.fr: 9 s, 35 sites, map, all filters, popup — OK.

## Key decisions and findings

- **IRVE over OSM as primary source**: faster, stable, not blocked by corporate networks, much richer (power, operator, free/paid, connectors, number of charge points). Downside: no outage information.
- **Matrix over Directions** for detours: one request per 25 sites instead of one per site.
- **Detour criterion** is *driving* distance/time from the closest route point, not straight-line distance; straight-line (15 km) is only a pre-filter.
- **Overpass query design**: indexed equality filters in the bbox; avoid `around:` on a long polyline and case-insensitive regexes.
- **Corporate network quirks** (this workstation): `overpass-api.de` returns 406 to non-browser User-Agents; local DNS lookups can return stale Cloudflare answers — trust `dig @1.1.1.1` run on the VPS.

## Testing approach

No npm/npx on this machine, so no test framework. Instead:
- Node scripts running the real pipeline (route → chargers → Matrix) against live APIs.
- A dependency-free headless Edge driver using the DevTools protocol: fills the form, waits for results, checks cards/markers/filters/popup, takes a screenshot, captures the console, and can intercept requests (mock Overpass with saved data, or block data.gouv.fr to exercise the fallback).
- Runs covered: IRVE primary (live), OSM fallback (IRVE blocked), production on Vercel and on https://charge.gliv.fr.
- These scripts live outside the repo (session scratchpad) and are not committed.

## Open items

1. **Security — ORS API key is public.** It is hardcoded in `src/config.js` and also present in `.env.example`, both in git history on a GitHub remote and visible to anyone loading either site. Rotate it and restrict the new key to `charge.gliv.fr` and `recharge-ev-app.vercel.app` in the ORS dashboard (or move routing behind a small server-side proxy).
2. **Live occupancy ("busy")** — needs a paid or partner API (e.g. an operator or aggregator feed); the `occupancy` field and the UI placeholder are ready.
3. **Outage information** — only available in the OSM fallback; could be complemented by an operator/aggregator source.
4. **Automatic deploy to the VPS** — currently manual (`ssh deploy@51.75.143.97 ~/apps/charge/deploy/vps/deploy.sh` after a push). A GitHub Action or webhook could automate it.
5. **Tests** — add automated tests (pure functions: `positionOnRoute`, `groupSites`, IRVE row mapping) and keep the browser driver as a smoke test in the repo.
6. Optional: results are not cached — a short cache of the IRVE bbox response and ORS routes would cut latency and ORS quota use on repeated searches.
