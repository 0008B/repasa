# Repaso — Vokabeltrainer

Spaced-Repetition-App (SM-2) mit zwei Stapeln (Spanisch, IT-Englisch),
Fortschritt gespeichert über Netlify Blobs, getrennt nach Zugangscode.

## Lokal testen

```bash
npm install
npm run dev
```

Netlify Blobs braucht entweder das `@netlify/vite-plugin` (bereits in
`vite.config.js` eingebunden) oder alternativ `netlify dev` statt `npm run dev`,
falls das Plugin lokal Probleme macht:

```bash
npm install -g netlify-cli
netlify dev
```

## Deployen

### Option A: Netlify CLI (schnellster Weg)

```bash
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```

### Option B: Git-Repo verbinden (empfohlen für spätere Updates)

1. Neues Git-Repo anlegen und dieses Projekt pushen (z.B. auf GitHub)
2. In Netlify: "Add new site" → "Import an existing project" → Repo auswählen
3. Build-Einstellungen werden automatisch aus `netlify.toml` übernommen
   (Build command: `npm run build`, Publish directory: `dist`)
4. Deploy — fertig

## Neue Wörter hinzufügen

Wörter stehen in `src/App.jsx` in den Arrays `SPANISH_PAIRS` bzw. `IT_PAIRS`.
Neue Einträge mit **eindeutiger, neuer ID** ergänzen, dann:

```bash
git add -A && git commit -m "Neue Wörter" && git push
```

(oder `netlify deploy --prod`, falls ohne Git-Verbindung deployed wird)

Netlify baut automatisch neu. Der gespeicherte Fortschritt bleibt erhalten,
weil er über die Wort-ID verknüpft ist, nicht über den Code selbst.

## Zugangscode

Beim ersten Öffnen fragt die App nach einem selbst ausgedachten Code
(3-32 Zeichen). Der wird lokal im Browser gemerkt. Auf einem neuen Gerät
denselben Code eingeben, um an den gleichen Fortschritt zu kommen.

**Wichtig:** Das ist kein echtes Login/Sicherheitssystem — nur ein einfacher
Namensraum, damit zufällige Besucher nicht denselben Speicher wie du benutzen.
