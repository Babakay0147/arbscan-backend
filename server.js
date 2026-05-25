const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.ODDSPAPI_KEY || "b8556587-8ef8-4025-adf5-6d730b50265e";
const BASE = "https://api.oddspapi.io/v4";

let cache = { data: [], timestamp: 0 };
const CACHE_TTL = 60 * 1000;

// ─── BOOKMAKERS TO COMPARE ───────────────────────────────────────────────────
// These are bookmakers available on OddsPapi - we compare across them for arb
const BOOKMAKERS = ["pinnacle","bet365","unibet","bwin","williamhill","betway","1xbet","betfair","sbobet","marathonbet"];

// ─── SPORT IDs on OddsPapi ───────────────────────────────────────────────────
// 10 = Football, 12 = Basketball, 13 = Tennis, 9 = Cricket
const SPORTS = [
  { id: 10, name: "Football", threeWay: true },
  { id: 12, name: "Basketball", threeWay: false },
  { id: 13, name: "Tennis", threeWay: false },
  { id: 9,  name: "Cricket", threeWay: false },
];

// Market IDs: 101=1X2 home, 102=draw, 103=away, 104=over, 105=under
const MARKET_1X2 = "101";
const MARKET_OU  = "104";

// ─── FETCH TOURNAMENTS ───────────────────────────────────────────────────────
async function getTournaments(sportId) {
  try {
    const res = await axios.get(`${BASE}/tournaments`, {
      params: { sportId, apiKey: API_KEY },
      timeout: 12000,
    });
    // Return top tournaments that have upcoming fixtures
    return (res.data || [])
      .filter(t => (t.upcomingFixtures > 0 || t.futureFixtures > 0))
      .slice(0, 6)
      .map(t => t.tournamentId);
  } catch (e) {
    console.error(`Tournaments sport ${sportId}:`, e.response?.status || e.message);
    return [];
  }
}

// ─── FETCH ODDS FOR MULTIPLE BOOKMAKERS ──────────────────────────────────────
async function getOddsForTournaments(tournamentIds, bookmaker) {
  if (!tournamentIds.length) return [];
  try {
    const res = await axios.get(`${BASE}/odds-by-tournaments`, {
      params: {
        bookmaker,
        tournamentIds: tournamentIds.join(","),
        apiKey: API_KEY,
        oddsFormat: "decimal",
      },
      timeout: 15000,
    });
    return res.data || [];
  } catch (e) {
    console.error(`Odds [${bookmaker}]:`, e.response?.status || e.message);
    return [];
  }
}

// ─── FETCH PARTICIPANTS (team names) ─────────────────────────────────────────
let participantCache = {};
async function getParticipantName(participantId) {
  if (participantCache[participantId]) return participantCache[participantId];
  try {
    const res = await axios.get(`${BASE}/participants`, {
      params: { participantIds: participantId, apiKey: API_KEY },
      timeout: 8000,
    });
    const p = (res.data || [])[0];
    if (p?.participantName) {
      participantCache[participantId] = p.participantName;
      return p.participantName;
    }
  } catch (e) {}
  return `Team ${participantId}`;
}

// ─── PARSE ODDS FROM FIXTURE ──────────────────────────────────────────────────
function parseFixtureOdds(fixture, bookmaker, sportName) {
  try {
    const bookOdds = fixture.bookmakerOdds?.[bookmaker];
    if (!bookOdds?.bookmakerIsActive) return null;

    const markets = bookOdds.markets || {};
    const result = { h2h: null, ou: null };

    // 1X2 market (101=home, 102=draw, 103=away)
    if (markets["101"]) {
      const h2h = {};
      const outcomes = markets["101"].outcomes || {};
      h2h.home = parseFloat(outcomes["101"]?.players?.["0"]?.price) || null;
      h2h.draw = parseFloat(outcomes["102"]?.players?.["0"]?.price) || null;
      h2h.away = parseFloat(outcomes["103"]?.players?.["0"]?.price) || null;
      if (h2h.home && h2h.away) result.h2h = h2h;
    }

    // Over/Under market (104=over, 105=under)
    if (markets["104"]) {
      const ou = {};
      const outcomes = markets["104"].outcomes || {};
      ou.over  = parseFloat(outcomes["104"]?.players?.["0"]?.price) || null;
      ou.under = parseFloat(outcomes["105"]?.players?.["0"]?.price) || null;
      if (ou.over && ou.under) result.ou = ou;
    }

    return result;
  } catch (e) {
    return null;
  }
}

// ─── TEAM NAME NORMALIZER ─────────────────────────────────────────────────────
function normalize(name = "") {
  return name.toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|united|utd|city|town|athletic|atletico|sporting|real|club)\b/gi, "")
    .replace(/[^a-z0-9]/g, "").trim();
}

// ─── ARB FINDER ───────────────────────────────────────────────────────────────
function findArb(allOdds) {
  // Group by fixtureId across bookmakers
  const byFixture = {};
  for (const odd of allOdds) {
    const key = odd.fixtureId;
    if (!byFixture[key]) byFixture[key] = { ...odd, bookOdds: {}, ouOdds: {} };
    if (odd.h2h) byFixture[key].bookOdds[odd.bookie] = odd.h2h;
    if (odd.ou)  byFixture[key].ouOdds[odd.bookie] = odd.ou;
  }

  const results = [];
  for (const [, ev] of Object.entries(byFixture)) {
    if (Object.keys(ev.bookOdds).length < 2) continue;

    const isThreeWay = ev.sport === "Football";
    let bestHome = { odds: 0, bookie: "" };
    let bestDraw = { odds: 0, bookie: "" };
    let bestAway = { odds: 0, bookie: "" };

    for (const [bookie, odds] of Object.entries(ev.bookOdds)) {
      if (odds.home > bestHome.odds) bestHome = { odds: odds.home, bookie };
      if (odds.away > bestAway.odds) bestAway = { odds: odds.away, bookie };
      if (isThreeWay && odds.draw && odds.draw > bestDraw.odds) bestDraw = { odds: odds.draw, bookie };
    }

    const sumInverse = isThreeWay && bestDraw.odds > 0
      ? 1/bestHome.odds + 1/bestDraw.odds + 1/bestAway.odds
      : 1/bestHome.odds + 1/bestAway.odds;
    const profitPct = ((1 - sumInverse) / sumInverse) * 100;

    // O/U arb
    let ouArb = null;
    if (Object.keys(ev.ouOdds).length >= 2) {
      let bOver = { odds: 0, bookie: "" }, bUnder = { odds: 0, bookie: "" };
      for (const [bookie, odds] of Object.entries(ev.ouOdds)) {
        if (odds.over  > bOver.odds)  bOver  = { odds: odds.over,  bookie };
        if (odds.under > bUnder.odds) bUnder = { odds: odds.under, bookie };
      }
      const ouSum = 1/bOver.odds + 1/bUnder.odds;
      if (ouSum < 1) ouArb = { bestOver: bOver, bestUnder: bUnder, sumInverse: ouSum, profitPct: ((1-ouSum)/ouSum)*100 };
    }

    results.push({
      id: ev.fixtureId,
      sport: ev.sport,
      home: ev.home,
      away: ev.away,
      isThreeWay,
      bookOdds: ev.bookOdds,
      bestHome, bestDraw, bestAway,
      sumInverse, profitPct,
      isArb: sumInverse < 1,
      ouArb,
      bookmakers: [...new Set(Object.keys(ev.bookOdds))],
      lastUpdated: new Date().toISOString(),
    });
  }
  return results.sort((a, b) => b.profitPct - a.profitPct);
}

// ─── MAIN SCRAPE ──────────────────────────────────────────────────────────────
async function scrapeAll() {
  console.log("\n🔍 Fetching from OddsPapi...");
  const allOdds = [];

  for (const sport of SPORTS) {
    try {
      // Get top tournaments for this sport
      const tournamentIds = await getTournaments(sport.id);
      if (!tournamentIds.length) { console.log(`  ${sport.name}: no tournaments`); continue; }
      console.log(`  ${sport.name}: ${tournamentIds.length} tournaments`);

      // Fetch odds from each bookmaker in parallel
      const bookieResults = await Promise.allSettled(
        BOOKMAKERS.map(bk => getOddsForTournaments(tournamentIds, bk))
      );

      for (let i = 0; i < BOOKMAKERS.length; i++) {
        const bookie = BOOKMAKERS[i];
        const fixtures = bookieResults[i].status === "fulfilled" ? bookieResults[i].value : [];

        for (const fixture of fixtures) {
          const parsed = parseFixtureOdds(fixture, bookie, sport.name);
          if (!parsed?.h2h) continue;

          // Get team names (use cache to avoid repeated calls)
          const home = await getParticipantName(fixture.participant1Id);
          const away = await getParticipantName(fixture.participant2Id);

          allOdds.push({
            fixtureId: fixture.fixtureId,
            bookie,
            sport: sport.name,
            home,
            away,
            h2h: parsed.h2h,
            ou: parsed.ou,
          });
        }
      }
    } catch (e) {
      console.error(`Sport ${sport.name}:`, e.message);
    }
  }

  const bookiesFound = [...new Set(allOdds.map(o => o.bookie))];
  console.log(`✅ ${allOdds.length} odds entries from: ${bookiesFound.join(", ") || "none"}`);

  const result = findArb(allOdds);
  console.log(`⚡ ${result.length} markets | ${result.filter(o=>o.isArb).length} 1X2 arb | ${result.filter(o=>o.ouArb).length} O/U arb\n`);
  return result;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString(), version: "4.0" }));

app.get("/odds", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL)
      return res.json({ success: true, data: cache.data, cached: true, age: Math.round((now-cache.timestamp)/1000)+"s" });
    const data = await scrapeAll();
    cache = { data, timestamp: now };
    res.json({ success: true, data, cached: false, count: data.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/arb", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL)
      return res.json({ success: true, data: cache.data.filter(o=>o.isArb), cached: true });
    const data = await scrapeAll();
    cache = { data, timestamp: now };
    res.json({ success: true, data: data.filter(o=>o.isArb), count: data.filter(o=>o.isArb).length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 ARBSCAN v4.0 — OddsPapi powered`);
  console.log(`   300+ bookmakers | Football, Basketball, Tennis, Cricket\n`);
});
