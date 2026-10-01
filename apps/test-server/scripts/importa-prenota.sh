#!/bin/sh
# Copia il frontend di Prenota (apps/prenota/public nel sito completo) in public/prenota, servito su /prenota.
# Nel sito completo Prenota usa già percorsi relativi; i sed restano per sorgenti più vecchie
# (/api/..., /health, /client-config, /styles.css, /app.js diventano relativi), così l'app funziona
# sotto /prenota/ con le API di src/routes/prenota.js. Rieseguire dopo ogni modifica di apps/prenota/public.
set -e
SORGENTE="${1:-$(dirname "$0")/../../prenota/public}"
DEST="$(dirname "$0")/../public/prenota"
mkdir -p "$DEST"
for f in index.html app.js styles.css; do
  sed -e "s#\([\"'\`(]\)/api/#\1api/#g" \
      -e "s#\([\"'(]\)/health\([\"')]\)#\1health\2#g" \
      -e "s#\([\"'(]\)/client-config\([\"')]\)#\1client-config\2#g" \
      -e "s#href=\"/styles.css\"#href=\"styles.css\"#g" \
      -e "s#src=\"/app.js\"#src=\"app.js\"#g" \
      -e "s#class=\"brand\" href=\"/\"#class=\"brand\" href=\"./\"#g" \
      "$SORGENTE/$f" > "$DEST/$f"
done
cp "$SORGENTE/favicon.svg" "$DEST/favicon.svg"
echo "Frontend Prenota copiato in $DEST da $SORGENTE ($(git -C "$SORGENTE/.." log -1 --format='%h %s' 2>/dev/null))"
