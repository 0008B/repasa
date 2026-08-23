import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { RotateCw, Check, X, Clock, Flame, BookOpen, Sparkles, ArrowRight, Plus, Layers, KeyRound, Sun, Moon } from "lucide-react";

/* ============================================================
   STAPEL 1: SPANISCH — Wortschatz (Standard-/Lehrbuch-Spanisch)
   ============================================================ */
const DECKS = [
  {
    id: "es",
    name: "Spanisch",
    subtitle: "Wortschatz & Grundgrammatik",
    directions: [
      { id: "es-de", label: "Spanisch → Deutsch", frontField: "es", backField: "de", ipaFrontField: "ipaEs", ipaBackField: "ipaDe" },
      { id: "de-es", label: "Deutsch → Spanisch", frontField: "de", backField: "es", ipaFrontField: "ipaDe", ipaBackField: "ipaEs" },
    ],
    loader: () => import("./decks/spanish.js"),
  },
  {
    id: "it",
    name: "Englisch",
    subtitle: "Wortschatz B1-C1 & Security+",
    directions: [
      { id: "en-de", label: "Englisch → Deutsch", frontField: "en", backField: "de", ipaFrontField: "ipaEn", ipaBackField: "ipaDe" },
    ],
    loader: () => import("./decks/english.js"),
  },
  {
    id: "secacr",
    name: "Security+ Akronyme",
    subtitle: "SY0-701 Referenz",
    dailyNewLimit: 20,
    directions: [
      { id: "acr-exp", label: "Akronym → Bedeutung", frontField: "acr", backField: "exp" },
    ],
    loader: () => import("./decks/secAcronyms.js"),
  },
  {
    id: "gde",
    name: "Deutsch-Englisch (M)",
    subtitle: "LanGeek B1 Wortschatz",
    directions: [
      { id: "gde-de-en", label: "Deutsch → Englisch", frontField: "de", backField: "en", ipaFrontField: "ipaDe", ipaBackField: "ipaEn" },
      { id: "gde-en-de", label: "Englisch → Deutsch", frontField: "en", backField: "de", ipaFrontField: "ipaEn", ipaBackField: "ipaDe" },
    ],
    loader: () => import("./decks/germanEnglish.js"),
  },
];

function getDeck(deckId) {
  return DECKS.find((d) => d.id === deckId) || null;
}

function buildCardsForDeck(deck, pairs) {
  const cards = [];
  for (const pair of pairs) {
    for (const dir of deck.directions) {
      cards.push(
        initCard({
          id: `${deck.id}-${pair.id}-${dir.id}`,
          deckId: deck.id,
          pairId: pair.id,
          direction: dir.id,
          front: pair[dir.frontField],
          back: pair[dir.backField],
          ipaFront: dir.ipaFrontField ? pair[dir.ipaFrontField] : null,
          ipaBack: dir.ipaBackField ? pair[dir.ipaBackField] : null,
          hint: pair.hint,
          def: pair.def,
          example: pair.example,
          exampleDe: pair.exampleDe,
        })
      );
    }
  }
  return cards;
}

// storedProgress: { [cardId]: { ease, interval, repetitions, due, introduced, lastReviewed } }
// Nur dynamische Felder werden gespeichert/gemergt - Wortinhalte kommen
// immer frisch aus den Pairs, nie aus dem Storage.
function mergeDeckCards(freshCards, storedProgress) {
  if (!storedProgress) return freshCards;
  return freshCards.map((fresh) => {
    const stored = storedProgress[fresh.id];
    if (!stored) return fresh;
    return {
      ...fresh,
      ease: stored.ease ?? 2.5,
      interval: stored.interval ?? 0,
      repetitions: stored.repetitions ?? 0,
      due: stored.due ?? Date.now(),
      lastReviewed: stored.lastReviewed ?? null,
      introduced: stored.introduced !== undefined ? stored.introduced : true,
    };
  });
}

// Wandelt Karten in die schlanke Storage-Form um: nur die Felder, die sich
// durchs Lernen ändern, keine Wortinhalte (die stehen ja schon im Code).
function slimProgress(cards) {
  const out = {};
  for (const c of cards) {
    out[c.id] = {
      ease: c.ease,
      interval: c.interval,
      repetitions: c.repetitions,
      due: c.due,
      introduced: c.introduced,
      lastReviewed: c.lastReviewed,
    };
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_NEW_LIMIT = 10; // Fallback, falls ein Stapel kein eigenes Limit setzt
const DEFAULT_DAILY_REVIEW_LIMIT = 200; // Anki-Standard: Sicherheitsventil, kein Alltags-Limit

function dailyLimitFor(deck) {
  return deck?.dailyNewLimit ?? DEFAULT_DAILY_NEW_LIMIT;
}

function reviewLimitFor(deck) {
  return deck?.dailyReviewLimit ?? DEFAULT_DAILY_REVIEW_LIMIT;
}
const ACCESS_CODE_KEY = "srs-access-code";
const API_ENDPOINT = "/api/progress";

function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/* ---- Remote-Storage über die Netlify Function - PRO STAPEL, nicht mehr
   alles in einem gemeinsamen Blob ---- */
async function loadRemoteDeckProgress(code, deckId) {
  const res = await fetch(
    `${API_ENDPOINT}?code=${encodeURIComponent(code)}&deck=${encodeURIComponent(deckId)}`
  );
  if (!res.ok) throw new Error("Laden fehlgeschlagen: " + res.status);
  const text = await res.text();
  return text && text !== "null" ? JSON.parse(text) : null;
}

async function saveRemoteDeckProgress(code, deckId, data) {
  const res = await fetch(
    `${API_ENDPOINT}?code=${encodeURIComponent(code)}&deck=${encodeURIComponent(deckId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) throw new Error("Speichern fehlgeschlagen: " + res.status);
}

function scheduleSM2(card, rating) {
  let { ease = 2.5, interval = 0, repetitions = 0 } = card;
  if (rating === 1) {
    repetitions = 0;
    interval = 1 / 1440;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = Math.round(interval * ease);
    if (rating === 2) ease = Math.max(1.3, ease - 0.15);
    if (rating === 4) ease = ease + 0.15;
    const fuzz = 1 + (Math.random() * 0.1 - 0.05);
    interval = Math.max(1, Math.round(interval * fuzz));
  }
  const due = Date.now() + interval * DAY_MS;
  return { ...card, ease, interval, repetitions, due, lastReviewed: Date.now() };
}

// Fisher-Yates: mischt die Anzeige-Reihenfolge innerhalb einer Session,
// damit man nicht die Position im Array lernt statt den Karteninhalt.
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function initCard(base) {
  return { ...base, ease: 2.5, interval: 0, repetitions: 0, due: null, introduced: false, lastReviewed: null };
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });
  const themeOverridden = useRef(false);

  // ---- iOS-Systemeinstellung live verfolgen, solange kein manueller Override ----
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e) => {
      if (!themeOverridden.current) {
        setTheme(e.matches ? "dark" : "light");
      }
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    themeOverridden.current = true;
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);
  const [accessCode, setAccessCode] = useState(undefined); // undefined = noch nicht geprüft
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState("");

  const [decksState, setDecksState] = useState({}); // wird pro Stapel befüllt, nicht alles auf einmal
  const [loadingDeckId, setLoadingDeckId] = useState(null);
  const [deckLoadError, setDeckLoadError] = useState(false);
  const [selectedDeckId, setSelectedDeckId] = useState(null);
  const [mode, setMode] = useState(null);
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [reviewedToday, setReviewedToday] = useState(0);
  const [sessionStartCount, setSessionStartCount] = useState(null);

  // ---- Zugangscode aus localStorage lesen (einmalig pro Gerät/Browser) ----
  useEffect(() => {
    const stored = localStorage.getItem(ACCESS_CODE_KEY);
    setAccessCode(stored || null);
  }, []);

  const submitCode = useCallback((rawCode) => {
    const code = rawCode.trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) {
      setCodeError("3-32 Zeichen: Buchstaben, Zahlen, - oder _");
      return;
    }
    localStorage.setItem(ACCESS_CODE_KEY, code);
    setAccessCode(code);
    setCodeError("");
  }, []);

  const changeCode = useCallback(() => {
    localStorage.removeItem(ACCESS_CODE_KEY);
    setAccessCode(null);
    setDecksState({});
    setSelectedDeckId(null);
    setMode(null);
    setQueue([]);
    setCurrent(null);
  }, []);

  // ---- Stapel laden: Inhalt (dynamic import) + Fortschritt (eigener
  //      Storage-Schlüssel), erst wenn der Stapel tatsächlich geöffnet
  //      wird - nicht alles beim Start ----
  const loadDeck = useCallback(
    async (deckId) => {
      if (decksState[deckId]) return; // diese Sitzung schon geladen

      setLoadingDeckId(deckId);
      setDeckLoadError(false);
      const deck = getDeck(deckId);

      try {
        const module = await deck.loader();
        const freshCards = buildCardsForDeck(deck, module.PAIRS);

        let progressData = null;
        try {
          progressData = await loadRemoteDeckProgress(accessCode, deckId);
        } catch (e) {
          console.error(e);
          setDeckLoadError(true);
        }

        const cards = mergeDeckCards(freshCards, progressData?.progress);
        const newCounter =
          progressData?.newCounter && typeof progressData.newCounter === "object"
            ? progressData.newCounter
            : { date: todayString(), counts: {}, reviewCounts: {} };

        setDecksState((prev) => ({ ...prev, [deckId]: { cards, newCounter } }));
      } catch (e) {
        console.error(e);
        setDeckLoadError(true);
      } finally {
        setLoadingDeckId(null);
      }
    },
    [decksState, accessCode]
  );

  // ---- Bei jeder Änderung NUR den aktuell gewählten Stapel speichern,
  //      und nur die schlanken Fortschritts-Felder, keine Wortinhalte ----
  useEffect(() => {
    if (!accessCode || !selectedDeckId) return;
    const deckData = decksState[selectedDeckId];
    if (!deckData) return;
    (async () => {
      try {
        await saveRemoteDeckProgress(accessCode, selectedDeckId, {
          progress: slimProgress(deckData.cards),
          newCounter: deckData.newCounter,
        });
      } catch (e) {
        console.error("Speichern fehlgeschlagen:", e);
      }
    })();
  }, [decksState, selectedDeckId, accessCode]);

  const currentDeck = selectedDeckId ? getDeck(selectedDeckId) : null;
  const deckCards = selectedDeckId ? decksState[selectedDeckId]?.cards : null;
  const deckCounter = selectedDeckId ? decksState[selectedDeckId]?.newCounter : null;

  useEffect(() => {
    if (!deckCards || !mode || !deckCounter) return;
    if (queue.length !== 0 || current) return;

    const today = todayString();
    const counter =
      deckCounter.date === today ? deckCounter : { date: today, counts: {}, reviewCounts: {} };
    const now = Date.now();
    const allDueReviews = deckCards.filter((c) => c.direction === mode && c.introduced && c.due <= now);
    const newPool = deckCards.filter((c) => c.direction === mode && !c.introduced);

    const usedNewToday = counter.counts[mode] || 0;
    const usedReviewsToday = (counter.reviewCounts && counter.reviewCounts[mode]) || 0;
    const newBudget = Math.max(0, dailyLimitFor(currentDeck) - usedNewToday);
    const reviewBudget = Math.max(0, reviewLimitFor(currentDeck) - usedReviewsToday);

    const toIntroduce = newPool.slice(0, newBudget);
    const reviewsToShow = allDueReviews.slice(0, reviewBudget);
    // Überzählige fällige Karten bleiben einfach fällig (ihr "due"-Wert
    // ändert sich nicht) und tauchen morgen (oder bei erneutem Öffnen mit
    // frischem Tages-Budget) automatisch wieder auf - kein manuelles
    // Rückstau-Tracking nötig.

    if (
      toIntroduce.length > 0 ||
      reviewsToShow.length < allDueReviews.length ||
      counter.date !== deckCounter.date
    ) {
      const introducedIds = new Set(toIntroduce.map((c) => c.id));
      const updatedCards = deckCards.map((c) => (introducedIds.has(c.id) ? { ...c, introduced: true, due: now } : c));
      const updatedCounter = {
        date: today,
        counts: { ...counter.counts, [mode]: usedNewToday + toIntroduce.length },
        reviewCounts: { ...counter.reviewCounts, [mode]: usedReviewsToday + reviewsToShow.length },
      };
      const newlyIntroduced = toIntroduce.map((c) => ({ ...c, introduced: true, due: now }));
      setDecksState((prev) => ({ ...prev, [selectedDeckId]: { cards: updatedCards, newCounter: updatedCounter } }));
      setQueue(shuffle([...reviewsToShow, ...newlyIntroduced]));
    } else {
      setQueue(shuffle(reviewsToShow));
    }
  }, [deckCards, deckCounter, mode, selectedDeckId, queue.length, current]);

  const chooseDeck = useCallback(
    (deckId) => {
      const deck = getDeck(deckId);
      setSelectedDeckId(deckId);
      setMode(deck.directions.length === 1 ? deck.directions[0].id : null);
      setQueue([]);
      setCurrent(null);
      setFlipped(false);
      setReviewedToday(0);
      setSessionStartCount(null);
      loadDeck(deckId);
    },
    [loadDeck]
  );

  const goToDeckPicker = useCallback(() => {
    setSelectedDeckId(null);
    setMode(null);
    setQueue([]);
    setCurrent(null);
    setFlipped(false);
    setReviewedToday(0);
    setSessionStartCount(null);
  }, []);

  const chooseDirection = useCallback((dirId) => {
    setMode(dirId);
    setQueue([]);
    setCurrent(null);
    setFlipped(false);
    setReviewedToday(0);
    setSessionStartCount(null);
  }, []);

  const goToDirectionPicker = useCallback(() => {
    setMode(null);
    setQueue([]);
    setCurrent(null);
    setFlipped(false);
    setReviewedToday(0);
    setSessionStartCount(null);
  }, []);

  // ---- Session-Fortschrittsbalken: Größe der heutigen Session einmalig
  //      festhalten, wenn sie zum ersten Mal befüllt wird ----
  useEffect(() => {
    if (sessionStartCount === null && queue.length > 0) {
      setSessionStartCount(queue.length);
    }
  }, [queue.length, sessionStartCount]);

  useEffect(() => {
    if (!current && queue.length > 0) {
      setCurrent(queue[0]);
      setFlipped(false);
    }
  }, [queue, current]);

  const handleRate = useCallback(
    (rating) => {
      if (!current || !selectedDeckId) return;
      const updated = scheduleSM2(current, rating);
      setDecksState((prev) => ({
        ...prev,
        [selectedDeckId]: {
          ...prev[selectedDeckId],
          cards: prev[selectedDeckId].cards.map((c) => (c.id === updated.id ? updated : c)),
        },
      }));
      setReviewedToday((n) => n + 1);
      const restOfQueue = queue.slice(1);
      if (rating === 1) setQueue([...restOfQueue, updated]);
      else setQueue(restOfQueue);
      setCurrent(null);
      setFlipped(false);
    },
    [current, queue, selectedDeckId]
  );

  const stats = useMemo(() => {
    if (!deckCards || !mode) return { dueNow: 0, learned: 0, total: 0 };
    const now = Date.now();
    const scoped = deckCards.filter((c) => c.direction === mode);
    return {
      dueNow: scoped.filter((c) => c.introduced && c.due <= now).length,
      learned: scoped.filter((c) => c.repetitions > 0).length,
      total: scoped.length,
    };
  }, [deckCards, mode]);

  const newUsedToday = useMemo(() => {
    if (!deckCounter || !mode) return 0;
    if (deckCounter.date !== todayString()) return 0;
    return deckCounter.counts[mode] || 0;
  }, [deckCounter, mode]);

  const nextDueLabel = useMemo(() => {
    if (!deckCards || !mode) return null;
    const future = deckCards.filter((c) => c.direction === mode && c.introduced && c.due > Date.now());
    if (future.length === 0) return null;
    const soonest = Math.min(...future.map((c) => c.due));
    const days = Math.max(1, Math.round((soonest - Date.now()) / DAY_MS));
    return days === 1 ? "morgen" : `in ${days} Tagen`;
  }, [deckCards, mode]);

  const sessionProgress = useMemo(() => {
    if (!sessionStartCount) return queue.length === 0 && !current ? 100 : 0;
    const done = sessionStartCount - queue.length;
    return Math.min(100, Math.max(0, Math.round((done / sessionStartCount) * 100)));
  }, [sessionStartCount, queue.length, current]);

  // ---- Bildschirm 0: Zugangscode ----
  if (accessCode === undefined) {
    return (
      <div className={`srs-page theme-${theme}`}>
        <div className="srs-loading">Lade…</div>
        <GlobalStyle />
      </div>
    );
  }

  if (!accessCode) {
    return (
      <div className={`srs-page theme-${theme}`}>
        <div className="srs-shell">
          <div className="srs-top-bar">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="srs-mode-screen">
            <KeyRound size={26} color="var(--accent)" style={{ marginBottom: 12 }} />
            <div className="srs-mode-title">Zugangscode</div>
            <div className="srs-mode-sub">
              Denk dir einen Code aus (z.B. 4 Zeichen). Gleicher Code auf jedem Gerät = gleicher
              Fortschritt. Wird lokal gemerkt, du tippst ihn nur einmal pro Gerät ein.
            </div>
            <form
              className="srs-code-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitCode(codeInput);
              }}
            >
              <input
                className="srs-code-input"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="z.B. 1234"
                autoFocus
              />
              <button className="srs-mode-btn" type="submit">
                Loslegen
              </button>
            </form>
            {codeError && <div className="srs-code-error">{codeError}</div>}
          </div>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  if (!selectedDeckId) {
    return (
      <div className={`srs-page theme-${theme}`}>
        <div className="srs-shell">
          <div className="srs-top-bar">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="srs-mode-screen">
            <Layers size={26} color="var(--ink)" style={{ marginBottom: 12 }} />
            <div className="srs-mode-title">Welchen Stapel willst du üben?</div>
            <div className="srs-mode-sub">Jeder Stapel speichert seinen Fortschritt getrennt.</div>
            <div className="srs-mode-buttons">
              {DECKS.map((deck) => (
                <button key={deck.id} className="srs-deck-btn" onClick={() => chooseDeck(deck.id)}>
                  <span className="srs-deck-btn-name">{deck.name}</span>
                  <span className="srs-deck-btn-sub">{deck.subtitle}</span>
                </button>
              ))}
            </div>
            <button className="srs-switch-btn" style={{ marginTop: 22 }} onClick={changeCode}>
              Code ändern
            </button>
          </div>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  // ---- Stapel wurde gewählt, aber Inhalt + Fortschritt sind noch nicht da
  //      (dynamic import + Netzwerk-Ladevorgang laufen gerade) ----
  if (!decksState[selectedDeckId]) {
    return (
      <div className={`srs-page theme-${theme}`}>
        <div className="srs-shell">
          <div className="srs-top-bar">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="srs-mode-screen">
            <div className="srs-loading">Lade {currentDeck?.name}…</div>
            {deckLoadError && (
              <div className="srs-code-error" style={{ marginTop: 16 }}>
                Laden vom Server ist fehlgeschlagen — du siehst evtl. einen leeren Stand.
                <button
                  className="srs-switch-btn"
                  style={{ display: "block", marginTop: 10 }}
                  onClick={() => loadDeck(selectedDeckId)}
                >
                  Erneut versuchen
                </button>
              </div>
            )}
            <button className="srs-switch-btn" style={{ marginTop: 22 }} onClick={goToDeckPicker}>
              ← anderen Stapel wählen
            </button>
          </div>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  if (!mode) {
    return (
      <div className={`srs-page theme-${theme}`}>
        <div className="srs-shell">
          <div className="srs-top-bar">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
          <div className="srs-mode-screen">
            <BookOpen size={26} color="var(--ink)" style={{ marginBottom: 12 }} />
            <div className="srs-mode-title">Welche Richtung willst du üben?</div>
            <div className="srs-mode-sub">
              Fortschritt wird pro Richtung getrennt gespeichert — du kannst später wechseln.
            </div>
            <div className="srs-mode-buttons">
              {currentDeck.directions.map((dir) => (
                <button key={dir.id} className="srs-mode-btn" onClick={() => chooseDirection(dir.id)}>
                  <span>{dir.label.split(" → ")[0]}</span>
                  <ArrowRight size={18} />
                  <span>{dir.label.split(" → ")[1]}</span>
                </button>
              ))}
            </div>
            <button className="srs-switch-btn" style={{ marginTop: 22 }} onClick={goToDeckPicker}>
              ← anderen Stapel wählen
            </button>
          </div>
        </div>
        <GlobalStyle />
      </div>
    );
  }

  const sessionDone = queue.length === 0 && !current;
  const directionLabel = currentDeck.directions.find((d) => d.id === mode)?.label || "";

  return (
    <div className={`srs-page theme-${theme}`}>
      <div className="srs-shell">
        <header className="srs-header">
          <div className="srs-header-left">
            <BookOpen size={22} color="var(--ink)" />
            <div>
              <div className="srs-header-title">{currentDeck.name}</div>
              <div className="srs-switch-row">
                <span className="srs-direction-label">{directionLabel}</span>
                {currentDeck.directions.length > 1 && (
                  <button className="srs-switch-btn" onClick={goToDirectionPicker}>
                    Richtung wechseln
                  </button>
                )}
                <button className="srs-switch-btn" onClick={goToDeckPicker}>
                  Stapel wechseln
                </button>
              </div>
            </div>
          </div>
          <div className="srs-header-stats">
            <StatPill
              icon={<Flame size={15} />}
              label={`${reviewedToday} geübt`}
              tone={reviewedToday > 0 ? "accent" : "neutral"}
            />
            <StatPill
              icon={<Clock size={15} />}
              label={`${stats.dueNow} fällig`}
              tone={stats.dueNow > 0 ? "attention" : "neutral"}
            />
            <StatPill
              icon={<Plus size={15} />}
              label={`${newUsedToday}/${dailyLimitFor(currentDeck)} neu`}
              tone={newUsedToday > 0 ? "accent" : "neutral"}
            />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </header>

        <div className="srs-progress-track">
          <div className="srs-progress-fill" style={{ width: `${sessionProgress}%` }} />
        </div>


        <main className="srs-main">
          {sessionDone ? (
            <div className="srs-done-card">
              <Sparkles size={32} color="var(--accent)" style={{ marginBottom: 14 }} />
              <div className="srs-done-title">Alles erledigt</div>
              <div className="srs-done-sub">
                {stats.learned}/{stats.total} Karten begonnen · neu heute {newUsedToday}/{dailyLimitFor(currentDeck)}
                {nextDueLabel ? ` · nächste Wiederholung ${nextDueLabel}` : ""}
              </div>
              <div className="srs-done-hint">
                Karten kommen erst wieder, wenn ihr Intervall abgelaufen ist oder das Tageslimit für
                neue Wörter zurückgesetzt wurde.
              </div>
            </div>
          ) : current ? (
            <div className="srs-card-wrap">
              <div className={`srs-card ${flipped ? "is-flipped" : ""}`} onClick={() => !flipped && setFlipped(true)}>
                {!flipped ? (
                  <>
                    <div className="srs-eyebrow">Vorderseite</div>
                    <div className="srs-front">{current.front}</div>
                    {current.ipaFront && <div className="srs-ipa">{current.ipaFront}</div>}
                    {current.hint && <div className="srs-hint">{current.hint}</div>}
                    <div className="srs-tap-hint">
                      <RotateCw size={15} /> tippen, um aufzudecken
                    </div>
                  </>
                ) : (
                  <>
                    <div className="srs-eyebrow">Vorderseite</div>
                    <div className="srs-front-small">{current.front}</div>
                    <div className="srs-divider" />
                    <div className="srs-eyebrow">Rückseite</div>
                    <div className="srs-back">{current.back}</div>
                    {current.ipaBack && <div className="srs-ipa">{current.ipaBack}</div>}
                    {current.def && <div className="srs-def">{current.def}</div>}
                    {current.example && (
                      <div className="srs-example">
                        <div className="srs-example-es">{current.example}</div>
                        {current.exampleDe && <div className="srs-example-de">{current.exampleDe}</div>}
                      </div>
                    )}
                  </>
                )}
              </div>

              {flipped && (
                <div className="srs-rating-row">
                  <RatingButton label="Again" sub="vergessen" color="var(--again)" icon={<X size={17} />} onClick={() => handleRate(1)} />
                  <RatingButton label="Hard" sub="schwer gefallen" color="var(--hard)" onClick={() => handleRate(2)} />
                  <RatingButton label="Good" sub="erinnert" color="var(--good)" onClick={() => handleRate(3)} />
                  <RatingButton label="Easy" sub="sofort gewusst" color="var(--easy)" icon={<Check size={17} />} onClick={() => handleRate(4)} />
                </div>
              )}
            </div>
          ) : null}
        </main>

        <footer className="srs-footer">
          <div className="srs-footer-note">
            {currentDeck.name} · {stats.total} Wortpaare · {dailyLimitFor(currentDeck)} neue Wörter/Tag
          </div>
        </footer>
      </div>

      <GlobalStyle />
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="srs-theme-toggle"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Zu hellem Design wechseln" : "Zu dunklem Design wechseln"}
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function StatPill({ icon, label, tone = "neutral" }) {
  return (
    <div className={`srs-stat-pill srs-stat-pill--${tone}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function RatingButton({ label, sub, color, icon, onClick }) {
  return (
    <button className="srs-rating-btn" onClick={onClick} style={{ borderColor: color, "--btn-color": color }}>
      <span className="srs-rating-label" style={{ color }}>
        {icon}
        {label}
      </span>
      <span className="srs-rating-sub">{sub}</span>
    </button>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

      html, body {
        margin: 0;
        padding: 0;
      }
      * { box-sizing: border-box; }

      .theme-dark {
        --bg: #0b0f17;
        --surface: #141a24;
        --surface-raised: #1b2330;
        --accent: #9FEF00;
        --accent-text: #9FEF00;
        --accent-ink: #0b0f17;
        --line: rgba(159,239,0,0.16);
        --line-strong: rgba(159,239,0,0.32);
        --ink: #f4f7fa;
        --muted: #94a3b8;
        --again: #ff6b6b;
        --hard: #ffb020;
        --good: #9FEF00;
        --easy: #4ea8ff;
      }

      .theme-light {
        --bg: #eef1ee;
        --surface: #ffffff;
        --surface-raised: #ffffff;
        --accent: #0aa83c;
        --accent-text: #078a32;
        --accent-ink: #ffffff;
        --line: rgba(0,0,0,0.13);
        --line-strong: rgba(0,0,0,0.24);
        --ink: #101210;
        --muted: #5f645f;
        --again: #c93b3b;
        --hard: #a86a1a;
        --good: #078a32;
        --easy: #1763c9;
      }

      .srs-page {
        min-height: 100vh;
        background: var(--bg);
        display: flex;
        justify-content: center;
        padding: 32px 20px;
        font-family: 'Inter', system-ui, sans-serif;
        color: var(--ink);
        transition: background 0.2s ease, color 0.2s ease;
      }

      .srs-loading { font-family: 'Inter', sans-serif; color: var(--muted); font-size: 17px; padding-top: 40px; }
      .srs-shell { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 26px; }
      .srs-top-bar { display: flex; justify-content: flex-end; }
      .srs-theme-toggle { background: var(--surface); border: 1px solid var(--line); color: var(--ink); border-radius: 20px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
      .srs-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
      .srs-header-left { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
      .srs-header-title { font-family: 'Space Grotesk', sans-serif; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
      .srs-switch-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 4px; }
      .srs-direction-label { font-family: 'Inter', sans-serif; font-size: 14px; color: var(--muted); }
      .srs-switch-btn { background: none; border: none; padding: 0; font-family: 'Inter', sans-serif; font-size: 14px; color: var(--accent-text); cursor: pointer; text-decoration: underline; text-decoration-color: var(--line-strong); white-space: nowrap; }
      .srs-header-stats { display: flex; gap: 8px; font-family: 'Inter', sans-serif; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
      .srs-stat-pill { display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 22px; padding: 7px 14px; font-size: 15px; color: var(--muted); white-space: nowrap; transition: border-color 0.2s ease, color 0.2s ease; }
      .srs-stat-pill--accent { border-color: var(--accent); color: var(--accent-text); }
      .srs-stat-pill--attention { border-color: var(--hard); color: var(--hard); }
      .srs-progress-track { width: 100%; height: 4px; border-radius: 4px; background: var(--line); overflow: hidden; }
      .srs-progress-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s ease; }
      .srs-main { display: flex; flex-direction: column; align-items: center; min-height: 350px; justify-content: center; }
      .srs-card-wrap { width: 100%; display: flex; flex-direction: column; gap: 20px; }
      .srs-card { background: var(--surface); border: 1px solid var(--line); border-top: 3px solid var(--line-strong); border-radius: 18px; padding: 52px 34px; min-height: 260px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; cursor: pointer; transition: border-color 0.15s ease; }
      .srs-card.is-flipped { border-top-color: var(--accent); cursor: default; }
      .srs-card:hover { border-color: var(--line-strong); }
      .srs-eyebrow { font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent-text); margin-bottom: 14px; }
      .srs-front { font-family: 'Space Grotesk', sans-serif; font-size: 42px; font-weight: 700; margin-bottom: 12px; line-height: 1.2; color: var(--ink); }
      .srs-front-small { font-family: 'Space Grotesk', sans-serif; font-size: 23px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
      .srs-hint { font-family: 'Inter', sans-serif; font-size: 16px; color: var(--muted); font-style: italic; }
      .srs-ipa { font-family: 'Inter', system-ui, sans-serif; font-size: 15px; color: var(--accent-text); margin-top: 4px; margin-bottom: 4px; letter-spacing: 0.01em; }
      .srs-def { font-family: 'Inter', sans-serif; font-size: 15px; color: var(--ink); font-style: italic; max-width: 340px; margin-top: 8px; line-height: 1.4; }
      .srs-divider { width: 48px; height: 1px; background: var(--line); margin: 22px 0; }
      .srs-back { font-family: 'Space Grotesk', sans-serif; font-size: 34px; font-weight: 700; line-height: 1.2; color: var(--accent-text); }
      .srs-example { margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); font-family: 'Inter', sans-serif; max-width: 340px; }
      .srs-example-es { font-size: 16px; font-style: italic; color: var(--ink); margin-bottom: 5px; }
      .srs-example-de { font-size: 14px; color: var(--muted); }
      .srs-tap-hint { font-family: 'Inter', sans-serif; font-size: 15px; color: var(--muted); display: flex; align-items: center; gap: 7px; margin-top: 24px; }
      .srs-rating-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .srs-rating-btn { background: color-mix(in srgb, var(--btn-color) 7%, var(--surface)); border: 1.5px solid color-mix(in srgb, var(--btn-color) 35%, var(--line)); border-radius: 12px; padding: 15px 8px; min-height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; cursor: pointer; font-family: 'Inter', sans-serif; transition: background 0.15s ease, border-color 0.15s ease; }
      .srs-rating-btn:hover { background: color-mix(in srgb, var(--btn-color) 12%, var(--surface)); border-color: var(--btn-color); }
      .srs-rating-btn:active { background: color-mix(in srgb, var(--btn-color) 22%, transparent); border-color: var(--btn-color); }
      .srs-rating-label { font-weight: 600; font-size: 17px; display: flex; align-items: center; gap: 6px; }
      .srs-rating-sub { font-size: 13px; color: var(--muted); }
      .srs-done-card { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 22px; }
      .srs-done-title { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700; margin-bottom: 10px; }
      .srs-done-sub { font-family: 'Inter', sans-serif; font-size: 16px; color: var(--muted); margin-bottom: 18px; }
      .srs-done-hint { font-family: 'Inter', sans-serif; font-size: 15px; color: var(--muted); max-width: 310px; line-height: 1.6; }
      .srs-footer { text-align: center; }
      .srs-footer-note { font-family: 'Inter', sans-serif; font-size: 14px; color: var(--muted); }
      .srs-mode-screen { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 30px 18px 64px; }
      .srs-mode-title { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700; margin-bottom: 10px; }
      .srs-mode-sub { font-family: 'Inter', sans-serif; font-size: 15px; color: var(--muted); max-width: 290px; line-height: 1.6; margin-bottom: 32px; }
      .srs-mode-buttons { display: flex; flex-direction: column; gap: 13px; width: 100%; max-width: 300px; }
      .srs-mode-btn { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 12px; padding: 18px 20px; min-height: 58px; display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 18px; font-weight: 600; cursor: pointer; font-family: 'Space Grotesk', sans-serif; color: var(--ink); transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease; }
      .srs-mode-btn:hover { border-color: var(--accent); background: var(--accent); color: var(--accent-ink); }
      .srs-deck-btn { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 12px; padding: 17px 20px; min-height: 58px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; cursor: pointer; font-family: 'Space Grotesk', sans-serif; transition: border-color 0.15s ease, background 0.15s ease; }
      .srs-deck-btn:hover { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, var(--surface)); }
      .srs-deck-btn-name { font-size: 18px; font-weight: 700; color: var(--ink); }
      .srs-deck-btn-sub { font-family: 'Inter', sans-serif; font-size: 13px; color: var(--muted); }
      .srs-code-form { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 240px; }
      .srs-code-input { font-family: 'Inter', sans-serif; font-size: 18px; padding: 14px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); text-align: center; letter-spacing: 0.05em; }
      .srs-code-error { font-family: 'Inter', sans-serif; font-size: 14px; color: var(--again); margin-top: 12px; }

      @media (max-width: 480px) {
        .srs-page { padding: 20px 14px; }
        .srs-shell { max-width: 100%; gap: 20px; }
        .srs-header { flex-wrap: wrap; }
        .srs-header-stats { width: 100%; justify-content: flex-start; }
        .srs-card { padding: 36px 20px; min-height: 220px; border-radius: 16px; }
        .srs-front { font-size: 32px; }
        .srs-back { font-size: 27px; }
        .srs-rating-row { grid-template-columns: repeat(2, 1fr); }
        .srs-rating-btn { min-height: 54px; }
        .srs-mode-screen { padding: 16px 10px 40px; }
        .srs-mode-title { font-size: 23px; }
      }
      @media (max-width: 360px) {
        .srs-front { font-size: 27px; }
        .srs-back { font-size: 23px; }
        .srs-rating-label { font-size: 15px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .srs-card, .srs-rating-btn, .srs-mode-btn, .srs-deck-btn { transition: none; }
      }
    `}</style>
  );
}
