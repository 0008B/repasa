#!/usr/bin/env python3
"""
check_duplicates.py — Duplikat-Checker fuer SRS-Deck-Dateien
(src/decks/*.js).

Prueft ein Feld (z.B. "de", "es", "en") eines Decks auf doppelte
Eintraege, mit optionalem Artikel-Stripping fuer Deutsch und Spanisch.
Kann zusaetzlich gegen ein zweites Deck (z.B. den alten Stand vor einem
neuen Wort-Batch) pruefen.

Benoetigt: Node.js im PATH (wird nur benutzt, um die JS-Datei sicher als
echtes Array einzulesen, kein regex-Gefrickel).

Verwendung
----------
Nur interne Duplikate in einer Datei pruefen:
    python3 check_duplicates.py src/decks/germanEnglish.js --field de --lang de

Neue Datei gegen eine "alte" Version (z.B. vor dem Hochladen) pruefen:
    python3 check_duplicates.py src/decks/germanEnglish.js --field de --lang de \\
        --against old_germanEnglish.js

Spanisch mit Artikel-Stripping (el/la/los/las):
    python3 check_duplicates.py src/decks/spanish.js --field es --lang es

Ohne Artikel-Stripping (z.B. Englisch, Akronyme):
    python3 check_duplicates.py src/decks/english.js --field en

Optionen
--------
--field FIELD     Pflichtangabe: welches Feld im PAIRS-Array geprueft wird
                   (z.B. "de", "es", "en", "acr").
--lang {de,es}    Optional: aktiviert Artikel-Stripping fuer die jeweilige
                   Sprache (de: der/die/das, es: el/la/los/las/un/una).
                   Weglassen = kein Stripping, nur lowercase+trim.
--against FILE    Optional: zweite Deck-Datei, gegen deren gleiches Feld
                   zusaetzlich auf Ueberschneidungen geprueft wird.
--export NAME     Name des exportierten Arrays (Default: PAIRS).
--ids             Zusaetzlich: prueft doppelte "id"-Werte und Luecken in
                   der Nummerierung (setzt numerische IDs wie "g12" voraus).

Exit-Code ist 1, wenn Duplikate gefunden wurden (praktisch fuer CI/Skripte),
sonst 0.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ARTICLE_PATTERNS = {
    "de": re.compile(r"^(der|die|das)\s+", re.IGNORECASE),
    "es": re.compile(r"^(el|la|los|las|un|una)\s+", re.IGNORECASE),
}


def load_pairs(js_path: Path, export_name: str):
    """Liest ein 'export const NAME = [...]' Array aus einer .js-Datei,
    indem Node die Datei tatsaechlich auswertet (robust gegen Kommentare,
    Zeilenumbrueche, Sonderzeichen - kein Regex-Parsing des Arrays selbst)."""
    if not js_path.exists():
        sys.exit(f"Datei nicht gefunden: {js_path}")

    script = f"""
    const mod = {{}};
    const exports = mod;
    const content = require('fs').readFileSync('{js_path.as_posix()}', 'utf8');
    const wrapped = content.replace(/export\\s+const\\s+/g, 'exports.');
    eval(wrapped);
    if (!exports.{export_name}) {{
      console.error('Export "{export_name}" nicht gefunden in {js_path.name}');
      process.exit(2);
    }}
    console.log(JSON.stringify(exports.{export_name}));
    """
    result = subprocess.run(["node", "-e", script], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"Fehler beim Einlesen von {js_path}:\n{result.stderr}")
    return json.loads(result.stdout)


def normalize(word: str, lang: str | None) -> str:
    w = word.strip()
    if lang and lang in ARTICLE_PATTERNS:
        w = ARTICLE_PATTERNS[lang].sub("", w)
    return w.strip().lower()


def find_internal_duplicates(pairs, field, lang):
    seen = {}
    dupes = []
    missing_field = []
    for p in pairs:
        raw = p.get(field)
        if not raw:
            missing_field.append(p.get("id", "?"))
            continue
        key = normalize(raw, lang)
        if key in seen:
            dupes.append((p.get("id", "?"), raw, seen[key][0], seen[key][1]))
        else:
            seen[key] = (p.get("id", "?"), raw)
    return dupes, missing_field, seen


def find_cross_duplicates(seen_a, pairs_b, field, lang):
    dupes = []
    for p in pairs_b:
        raw = p.get(field)
        if not raw:
            continue
        key = normalize(raw, lang)
        if key in seen_a:
            dupes.append((p.get("id", "?"), raw, seen_a[key][0], seen_a[key][1]))
    return dupes


def check_id_sequence(pairs):
    ids = [p.get("id", "") for p in pairs]
    dupes = [i for i in set(ids) if ids.count(i) > 1]

    nums = []
    prefix = None
    for i in ids:
        m = re.match(r"^([a-zA-Z]+)(\d+)$", i)
        if m:
            if prefix is None:
                prefix = m.group(1)
            nums.append(int(m.group(2)))
    gaps = []
    if nums:
        nums_sorted = sorted(nums)
        expected = set(range(1, max(nums_sorted) + 1))
        gaps = sorted(expected - set(nums_sorted))
    return dupes, gaps, prefix


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path, help="Pfad zur Deck-Datei (.js)")
    ap.add_argument("--field", required=True, help='Feld, das geprueft wird (z.B. "de", "es", "en")')
    ap.add_argument("--lang", choices=["de", "es"], default=None, help="Artikel-Stripping aktivieren")
    ap.add_argument("--against", type=Path, default=None, help="Zweite Deck-Datei fuer Cross-Check")
    ap.add_argument("--export", default="PAIRS", help="Name des exportierten Arrays (Default: PAIRS)")
    ap.add_argument("--ids", action="store_true", help="Zusaetzlich ID-Duplikate/-Luecken pruefen")
    args = ap.parse_args()

    pairs = load_pairs(args.file, args.export)
    print(f"Geladen: {len(pairs)} Eintraege aus {args.file.name} (Feld: '{args.field}'"
          + (f", Artikel-Stripping: {args.lang}" if args.lang else "") + ")")

    dupes, missing, seen = find_internal_duplicates(pairs, args.field, args.lang)
    has_problems = False

    if missing:
        print(f"\n⚠ Eintraege ohne Wert im Feld '{args.field}': {missing}")

    if dupes:
        has_problems = True
        print(f"\n✗ {len(dupes)} interne Duplikat(e) in {args.file.name}:")
        for id_b, raw_b, id_a, raw_a in dupes:
            print(f"    {id_a} \"{raw_a}\"  ==  {id_b} \"{raw_b}\"")
    else:
        print(f"\n✓ Keine internen Duplikate in {args.file.name}.")

    if args.against:
        other_pairs = load_pairs(args.against, args.export)
        cross = find_cross_duplicates(seen, other_pairs, args.field, args.lang)
        if cross:
            has_problems = True
            print(f"\n✗ {len(cross)} Ueberschneidung(en) mit {args.against.name}:")
            for id_b, raw_b, id_a, raw_a in cross:
                print(f"    {args.file.name}:{id_a} \"{raw_a}\"  ==  {args.against.name}:{id_b} \"{raw_b}\"")
        else:
            print(f"\n✓ Keine Ueberschneidungen mit {args.against.name}.")

    if args.ids:
        id_dupes, gaps, prefix = check_id_sequence(pairs)
        if id_dupes:
            has_problems = True
            print(f"\n✗ Doppelte IDs: {id_dupes}")
        else:
            print("\n✓ Keine doppelten IDs.")
        if gaps:
            print(f"⚠ Luecken in der ID-Nummerierung (Prefix '{prefix}'): {gaps}")
        else:
            print(f"✓ ID-Nummerierung lueckenlos (Prefix '{prefix}').")

    print()
    sys.exit(1 if has_problems else 0)


if __name__ == "__main__":
    main()
