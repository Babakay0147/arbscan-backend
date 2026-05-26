const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const ODDS_API_KEY = process.env.ODDS_API_KEY || "0b5c91e63d26cb27f6884afdd1df0e86";
const ODDS_BASE = "https://api.the-odds-api.com/v4";

let cache = { data: [], timestamp: 0 };
const CACHE_TTL = 120 * 1000; // 2 min cache to save requests

// Sports to scan
const SPORTS = [
  { key: "soccer_epl",              name: "Football",   threeWay: true },
  { key: "soccer_spain_la_liga",    name: "Football",   threeWay: true },
  { key: "soccer_italy_serie_a",    name: "Football",   threeWay: true },
  { key: "soccer_germany_bundesliga", name: "Football", threeWay: true },
  { key: "soccer_uefa_champs_league", name: "Football", threeWay: true },
  { key: "soccer_africa_cup_of_nations", name: "Football", threeWay: true },
  { key: "basketball_nba",          name: "Basketball", threeWay: false },
  { key: "tennis_atp_french_open",  name: "Tennis",     threeWay: false },
  { key: "cricket_icc_world_cup",   name: "Cricket",    threeWay: false },
];

// Bookmakers to compare
const BOOKMAKERS = "bet365,pinnacle,williamhill,unibet,betway,betfair,1xbet,marathonbet,bwin,unibet";

// ─── FETCH ODDS FOR ONE SPORT ─────────────────────────────────────────────────
async function fetchSportOdds(sport) {
  const results = [];
  try {
    const res = await axios.get(`${ODDS_BASE}/sports/${sport.key}/odds`, {
      params: {
        apiKey: ODDS_API_KEY,
        regions: "eu,uk",
        markets: "h2h,totals",
        oddsFormat: "decimal",
        bookmakers: BOOKMAKERS,
      },
      timeout: 15000,
    });

    const events = res.data || [];
    console.log(`  ${sport.key}: ${events.length} events`);

    for (const ev of events) {
      for (const bookie of (ev.bookmakers || [])) {
        const bookieName = bookie.title || bookie.key;
        const markets = {};

        for (const mkt of (bookie.markets || [])) {
          if (mkt.key === "h2h") {
            const outcomes = mkt.outcomes || [];
            const h2h = {};
            for (const o of outcomes) {
              const name = o.name?.toLowerCase();
              if (name === ev.home_team?.toLowerCase() || name === "home") h2h.home = parseFloat(o.price);
              else if (name === "draw") h2h.draw = parseFloat(o.price);
              else if (name === ev.away_team?.toLowerCase() || name === "away") h2h.away = parseFloat(o.price);
            }
            // fallback by position
            if (!h2h.home && outcomes[0]) h2h.home = parseFloat(outcomes[0].price);
            if (!h2h.draw && outcomes.length === 3 && outcomes[1]) h2h.draw = parseFloat(outcomes[1].price);
            if (!h2h.away && outcomes[outcomes.length-1]) h2h.away = parseFloat(outcomes[outcomes.length-1].price);
            if (h2h.home && h2h.away) markets.h2h = h2h;
          }
          if (mkt.key === "totals") {
            const outcomes = mkt.outcomes || [];
            const ou = {};
            for (const o of outcomes) {
              if (o.name?.toLowerCase().includes("over"))  ou.over  = parseFloat(o.price);
              if (o.name?.toLowerCase().includes("under")) ou.under = parseFloat(o.price);
            }
            if (ou.over && ou.under) markets.ou = ou;
          }
        }

        if (markets.h2h?.home && markets.h2h?.away) {
          results.push({
            fixtureId: ev.id,
            bookie: bookieName,
            sport: sport.name,
            home: ev.home_team,
            away: ev.away_team,
            commenceTime: ev.commence_time,
            h2h: markets.h2h,
            ou: markets.ou || null,
          });
        }
      }
    }
  } catch (e) {
    if (e.response?.status === 422) {
      console.log(`  ${sport.key}: not available right now`);
    } else {
      console.error(`  ${sport.key} error:`, e.response?.status || e.message);
    }
  }
  return results;
}

// ─── ARB FINDER ───────────────────────────────────────────────────────────────
function findArb(allOdds) {
  // Group by fixtureId
  const byFixture = {};
  for (const odd of allOdds) {
    if (!byFixture[odd.fixtureId]) {
      byFixture[odd.fixtureId] = {
        fixtureId: odd.fixtureId,
        sport: odd.sport,
        home: odd.home,
        away: odd.away,
        commenceTime: odd.commenceTime,
        bookOdds: {},
        ouOdds: {},
      };
    }
    if (odd.h2h) byFixture[odd.fixtureId].bookOdds[odd.bookie] = odd.h2h;
    if (odd.ou)  byFixture[odd.fixtureId].ouOdds[odd.bookie]   = odd.ou;
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
      if (ouSum < 1) ouArb = {
        bestOver: bOver, bestUnder: bUnder,
        sumInverse: ouSum, profitPct: ((1-ouSum)/ouSum)*100,
      };
    }

    results.push({
      id: ev.fixtureId,
      sport: ev.sport,
      home: ev.home,
      away: ev.away,
      commenceTime: ev.commenceTime,
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

// ─── MAIN FETCH ───────────────────────────────────────────────────────────────
async function fetchAll() {
  console.log("\n🔍 Fetching from The Odds API...");
  const allOdds = [];

  // Fetch sports in batches to save API requests
  for (const sport of SPORTS) {
    const odds = await fetchSportOdds(sport);
    allOdds.push(...odds);
    // small delay between requests
    await new Promise(r => setTimeout(r, 300));
  }

  const bookiesFound = [...new Set(allOdds.map(o => o.bookie))];
  console.log(`✅ ${allOdds.length} odds from: ${bookiesFound.join(", ") || "none"}`);

  const result = findArb(allOdds);
  console.log(`⚡ ${result.length} markets | ${result.filter(o=>o.isArb).length} 1X2 arb | ${result.filter(o=>o.ouArb).length} O/U arb\n`);
  return result;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({
  status: "ok",
  time: new Date().toISOString(),
  version: "5.0",
  provider: "The Odds API",
}));

app.get("/odds", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL)
      return res.json({ success: true, data: cache.data, cached: true, age: Math.round((now-cache.timestamp)/1000)+"s" });
    const data = await fetchAll();
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
    const data = await fetchAll();
    cache = { data, timestamp: now };
    res.json({ success: true, data: data.filter(o=>o.isArb), count: data.filter(o=>o.isArb).length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 ARBSCAN v5.0 — The Odds API powered`);
  console.log(`   Bet365 | Pinnacle | William Hill | Unibet | Betway | 1xBet\n`);
});
