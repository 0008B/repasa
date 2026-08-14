import { getStore } from "@netlify/blobs";

// Zugangscode: einfache Namensraum-Trennung, kein echtes Login.
// 3-32 Zeichen, nur Buchstaben/Zahlen/Bindestrich/Unterstrich.
function isValidCode(code) {
  return typeof code === "string" && /^[A-Za-z0-9_-]{3,32}$/.test(code);
}

// Stapel-ID: gleiche Regeln, etwas grosszuegiger (erlaubt z.B. "es", "secacr").
function isValidDeckId(deckId) {
  return typeof deckId === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(deckId);
}

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const deckId = url.searchParams.get("deck");

  if (!isValidCode(code)) {
    return new Response(JSON.stringify({ error: "invalid code" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  if (!isValidDeckId(deckId)) {
    return new Response(JSON.stringify({ error: "invalid deck id" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Ein eigener Blob-Schluessel PRO Code UND PRO Stapel - eine Session in
  // einem Stapel liest/schreibt nie Daten eines anderen Stapels mit.
  const key = `${code}__${deckId}`;

  // "strong" consistency: sofortiges Lesen nach Schreiben garantiert,
  // wichtig weil wir kurz nach jedem Speichern eventuell neu laden.
  const store = getStore({ name: "srs-progress", consistency: "strong" });

  if (req.method === "GET") {
    const value = await store.get(key);
    return new Response(value ?? "null", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const body = await req.text();

    // Einfache Groessenbremse gegen versehentlich riesige Payloads.
    // Da wir jetzt nur noch Fortschritt (keine Wortinhalte) speichern,
    // ist das reine Zahlenwerte pro Karte - selbst bei 10.000 Karten
    // bleiben wir weit darunter.
    if (body.length > 5_000_000) {
      return new Response(JSON.stringify({ error: "payload too large" }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }

    await store.set(key, body);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/progress" };
