# Recharge EV Planner MVP

Application web statique (HTML/CSS/JS) pour calculer le prochain point de recharge rapide sur un trajet VE, avec deux modes:
- **Sécurisé**: réserve mini 15%
- **Avancé**: réserve mini 5%

## Lancer en local
```bash
python3 -m http.server 4173
# puis ouvrir http://localhost:4173
```

## Configurer l'API cartographie (optionnel)
Par défaut, l'app bascule sur un trajet mocké si aucune clé API n'est configurée.

Pour activer OpenRouteService:
1. Renseigner `ORS_API_KEY` dans `src/config.js`.
2. Vérifier `ORS_BASE_URL` (défaut: `https://api.openrouteservice.org`, alternative: `https://api.heigit.org`).
3. Recharger la page puis relancer un calcul.

Si le message de fallback apparaît encore, l'erreur HTTP est affichée (ex: `ROUTE_ERROR_401`, `GEOCODE_ERROR_403`) pour diagnostiquer clé invalide, restrictions ou quota.
2. Recharger la page.

## Données de test
- Batterie: `77`
- SOC: `62`
- Conso: `18`
- Origine: `Paris`
- Destination: `Lyon`

## Logique de calcul (résumé)
- Énergie disponible = capacité × SOC / 100
- Autonomie théorique = énergie disponible / conso × 100
- Mode sécurisé = réserve 15%
- Mode avancé = réserve 5%
- Filtrage bornes par puissance: >=100kW, sinon >=43kW, sinon >=20kW
- Recommandation: borne la plus lointaine atteignable, en privilégiant une arrivée dans la fenêtre SOC idéale.


## Déploiement Vercel (anti-404)
Si vous voyez `404: NOT_FOUND` sur `*.vercel.app`, le problème est généralement une mauvaise configuration de **Root Directory** ou l’absence de route de fallback.

1. Dans Vercel > Project > **Settings > General**:
   - **Root Directory** = `.` (racine du repo)
   - **Framework Preset** = `Other`
   - **Build Command** = *(vide)*
   - **Output Directory** = *(vide)*
2. Vérifier que `index.html` est bien à la racine du dépôt.
3. Le fichier `vercel.json` fourni dans ce repo force le fallback vers `index.html`.
4. Redéployer:
   - Vercel > **Deployments** > **Redeploy** (cocher *Use existing Build Cache* = off)
   - ou push d’un nouveau commit.

### Vérification rapide après redéploiement
- Ouvrir `https://votre-projet.vercel.app/`
- Ouvrir `https://votre-projet.vercel.app/index.html`
- Si `/index.html` marche mais `/` non: vérifier **Domains** et alias du dernier déploiement "Ready".


## Corriger depuis iPhone (Chrome)
Vous n'avez pas besoin de terminal sur iPhone. Faites uniquement ces actions dans les pages web GitHub + Vercel.

1. Ouvrez **GitHub** > votre repo > onglet **Branches**.
2. Vérifiez que la branche **main** contient les fichiers `index.html`, `styles.css`, `src/main.js` (pas seulement la branche `work`).
3. Si `main` n'a pas ces fichiers: sur GitHub, créez une Pull Request pour fusionner `work` -> `main`, puis **Merge**.
4. Ouvrez **Vercel** > Project > **Settings > Git**:
   - **Production Branch** = `main`
5. Ouvrez **Deployments** > dernier déploiement > vérifiez le commit:
   - il ne doit **pas** être `2399bb9`
6. Cliquez **Redeploy** (sans cache), puis testez:
   - `https://votre-projet.vercel.app/`
   - `https://votre-projet.vercel.app/index.html`

Si le log affiche encore `Commit: 2399bb9`, Vercel déploie toujours un ancien `main` (la fusion vers `main` n'est pas passée).
