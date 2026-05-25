const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

let cache = { data: [], timestamp: 0 };
const CACHE_TTL = 60 * 1000;

const RAPIDAPI_KEY = "6999ccd785msh5ef122139a44f02p165db7jsn03f3aca1e727";
const RAPIDAPI_HOST = "odds-feed.p.rapidapi.com";

const RAPID_HEADERS = {
  "x-rapidapi-key": RAPIDAPI_KEY,
  "x-rapidapi-host": RAPIDAPI_HOST,
  "Accept": "application/json",
};

// ─── FETCH ALL SPORTS ODDS ───────────────────────────────────────────────────
async function fetchOddsFeed() {
  const results = [];

  const sports = [
    { key: "soccer", name: "Football", threeWay: true },
    { key: "basketball", name: "Basketball", threeWay: false },
    { key: "tennis", name: "Tennis", threeWay: false },
    { key: "cricket", name: "Cricket", threeWay: false },
  ];

  for (const sport of sports) {
    try {
      console.log(`Fetching ${sport.name}...`);

      // Try to get events/odds
      const res = await axios.get(
        `https://${RAPIDAPI_HOST}/odds`,
        {
          params: { sport: sport.key, markets: "h2h,totals", regions: "eu,uk,us", oddsFormat: "decimal" },
          headers: RAPID_HEADERS,
          timeout: 15000,
        }
      );

      const events = res.data?.data || res.data?.events || res.data || [];
      const eventList = Array.isArray(events) ? events : [];

      for (const ev of eventList) {
        const bookmakers = ev.bookmakers || ev.sites || [];
        for (const bookie of bookmakers) {
          const bookieName = bookie.title || bookie.key || bookie.name || "Unknown";
          const markets = {};

          for (const mkt of (bookie.markets || bookie.odds || [])) {
            const mktKey = mkt.key || mkt.market || mkt.name || "";

            if (["h2h","1x2","match_winner","moneyline"].includes(mktKey.toLowerCase())) {
              const outcomes = mkt.outcomes || mkt.selections || [];
              const h2h = {};
              for (const o of outcomes) {
                const name = (o.name || o.description || "").toLowerCase();
                const price = parseFloat(o.price || o.odds || o.value);
                if (!price || isNaN(price)) continue;
                const homeTeam = (ev.home_team || ev.homeTeam || "").toLowerCase();
                const awayTeam = (ev.away_team || ev.awayTeam || "").toLowerCase();
                if (name === homeTeam || name === "home" || name === "1") h2h.home = price;
                else if (name === "draw" || name === "x" || name === "tie") h2h.draw = price;
                else if (name === awayTeam || name === "away" || name === "2") h2h.away = price;
                else {
                  // fallback by position
                  if (!h2h.home) h2h.home = price;
                  else if (outcomes.length > 2 && !h2h.draw) h2h.draw = price;
                  else if (!h2h.away) h2h.away = price;
                }
              }
              if (h2h.home && h2h.away) markets.h2h = h2h;
            }

            if (["totals","over_under","goals"].includes(mktKey.toLowerCase())) {
              const outcomes = mkt.outcomes || mkt.selections || [];
              const ou = {};
              for (const o of outcomes) {
                const name = (o.name || o.description || "").toLowerCase();
                const price = parseFloat(o.price || o.odds || o.value);
                if (!price || isNaN(price)) continue;
                if (name.includes("over")) ou.over = price;
                else if (name.includes("under")) ou.under = price;
              }
              if (ou.over && ou.under) markets.ou = ou;
            }
          }

          if (markets.h2h?.home && markets.h2h?.away) {
            results.push({
              bookie: bookieName,
              sport: sport.name,
              home: ev.home_team || ev.homeTeam || ev.team1 || "Home",
              away: ev.away_team || ev.awayTeam || ev.team2 || "Away",
              eventId: String(ev.id || ev.event_id || Math.random()),
              markets,
            });
          }
        }
      }
      console.log(`${sport.name}: fetched ${eventList.length} events`);
    } catch (e) {
      console.error(`${sport.name} error:`, e.response?.status, e.response?.data?.message || e.message);
    }
  }
  return results;
}

// ─── FALLBACK: try different endpoint structures ──────────────────────────────
async function fetchOddsFeedAlt() {
  const results = [];
  try {
    // Try listing available sports first
    const sportsRes = await axios.get(`https://${RAPIDAPI_HOST}/sports`, {
      headers: RAPID_HEADERS, timeout: 10000,
    });
    console.log("Available sports:", JSON.stringify(sportsRes.data).slice(0, 500));

    const sportsList = sportsRes.data?.data || sportsRes.data || [];
    const targetSports = Array.isArray(sportsList)
      ? sportsList.slice(0, 5)
      : [{ key: "soccer_epl" }, { key: "basketball_nba" }];

    for (const sport of targetSports) {
      const sportKey = sport.key || sport.sport_key || sport.id || sport;
      try {
        const res = await axios.get(`https://${RAPIDAPI_HOST}/odds`, {
          params: { sport: sportKey, regions: "eu,uk", markets: "h2h", oddsFormat: "decimal" },
          headers: RAPID_HEADERS, timeout: 12000,
        });
        const events = res.data?.data || res.data || [];
        if (Array.isArray(events)) {
          for (const ev of events.slice(0, 10)) {
            for (const bookie of (ev.bookmakers || [])) {
              const mkt = bookie.markets?.find(m => m.key === "h2h");
              if (!mkt) continue;
              const outcomes = mkt.outcomes || [];
              const h2h = {};
              outcomes.forEach((o, i) => {
                const price = parseFloat(o.price);
                if (i === 0) h2h.home = price;
                else if (outcomes.length === 3 && i === 1) h2h.draw = price;
                else h2h.away = price;
              });
              if (h2h.home && h2h.away) {
                results.push({
                  bookie: bookie.title || bookie.key,
                  sport: sportKey.includes("soccer") ? "Football" : sportKey.includes("basketball") ? "Basketball" : "Other",
                  home: ev.home_team || "Home",
                  away: ev.away_team || "Away",
                  eventId: String(ev.id || Math.random()),
                  markets: { h2h },
                });
              }
            }
          }
        }
      } catch (e) {
        console.error(`Sport ${sportKey}:`, e.response?.status || e.message);
      }
    }
  } catch (e) {
    console.error("Alt fetch error:", e.response?.status || e.message);
  }
  return results;
}

// ─── TEAM MATCHER ─────────────────────────────────────────────────────────────
function normalize(name = "") {
  return name.toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|united|utd|city|town|athletic|atletico|sporting|real|club)\b/gi, "")
    .replace(/[^a-z0-9]/g, "").trim();
}
function teamsMatch(a1, a2, b1, b2) {
  const [na1, na2, nb1, nb2] = [a1, a2, b1, b2].map(normalize);
  if (na1.length < 3 || nb1.length < 3) return false;
  const fwd = (na1.includes(nb1) || nb1.includes(na1)) && (na2.includes(nb2) || nb2.includes(na2));
  const rev = (na1.includes(nb2) || nb2.includes(na1)) && (na2.includes(nb1) || nb1.includes(na2));
  return fwd || rev;
}

// ─── ARB FINDER ───────────────────────────────────────────────────────────────
function findArb(allOdds) {
  const groups = [];
  for (const odd of allOdds) {
    let placed = false;
    for (const group of groups) {
      const ref = group[0];
      if (ref.sport === odd.sport && ref.bookie !== odd.bookie && teamsMatch(ref.home, ref.away, odd.home, odd.away)) {
        if (!group.find(g => g.bookie === odd.bookie)) group.push(odd);
        placed = true; break;
      }
    }
    if (!placed) groups.push([odd]);
  }

  const results = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const ref = group[0];
    const isThreeWay = ref.sport === "Football";
    const bookOdds = {};
    for (const g of group) {
      if (g.markets?.h2h?.home && g.markets?.h2h?.away)
        bookOdds[g.bookie] = { home: g.markets.h2h.home, draw: g.markets.h2h.draw || null, away: g.markets.h2h.away };
    }
    if (Object.keys(bookOdds).length < 2) continue;

    let bestHome = { odds: 0, bookie: "" }, bestDraw = { odds: 0, bookie: "" }, bestAway = { odds: 0, bookie: "" };
    for (const [bookie, odds] of Object.entries(bookOdds)) {
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
    const ouMap = {};
    for (const g of group) {
      if (g.markets?.ou?.over && g.markets?.ou?.under) ouMap[g.bookie] = g.markets.ou;
    }
    if (Object.keys(ouMap).length >= 2) {
      let bOver = { odds: 0, bookie: "" }, bUnder = { odds: 0, bookie: "" };
      for (const [bookie, odds] of Object.entries(ouMap)) {
        if (odds.over > bOver.odds) bOver = { odds: odds.over, bookie };
        if (odds.under > bUnder.odds) bUnder = { odds: odds.under, bookie };
      }
      const ouSum = 1/bOver.odds + 1/bUnder.odds;
      if (ouSum < 1) ouArb = { bestOver: bOver, bestUnder: bUnder, sumInverse: ouSum, profitPct: ((1-ouSum)/ouSum)*100 };
    }

    results.push({
      id: `${ref.sport}-${normalize(ref.home)}-${normalize(ref.away)}`,
      sport: ref.sport, home: ref.home, away: ref.away, isThreeWay,
      bookOdds, bestHome, bestDraw, bestAway,
      sumInverse, profitPct, isArb: sumInverse < 1,
      ouArb, bookmakers: [...new Set(group.map(g => g.bookie))],
      lastUpdated: new Date().toISOString(),
    });
  }
  return results.sort((a, b) => b.profitPct - a.profitPct);
}

// ─── SCRAPE ───────────────────────────────────────────────────────────────────
async function scrapeAll() {
  console.log("\n🔍 Fetching from Odds Feed API...");
  let all = await fetchOddsFeed();
  if (all.length === 0) {
    console.log("Primary fetch empty, trying alt endpoint...");
    all = await fetchOddsFeedAlt();
  }
  console.log(`✅ ${all.length} total odds entries from ${[...new Set(all.map(o=>o.bookie))].length} bookmakers`);
  const result = findArb(all);
  console.log(`⚡ ${result.length} matched markets | ${result.filter(o=>o.isArb).length} arb | ${result.filter(o=>o.ouArb).length} O/U arb\n`);
  return result;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString(), version: "3.0" }));

app.get("/debug", async (req, res) => {
  // Shows raw API response so we can see exact structure
  try {
    const r1 = await axios.get(`https://${RAPIDAPI_HOST}/sports`, { headers: RAPID_HEADERS, timeout: 10000 });
    res.json({ sports: r1.data });
  } catch (e) {
    try {
      const r2 = await axios.get(`https://${RAPIDAPI_HOST}/odds`, {
        params: { sport: "soccer", regions: "eu", markets: "h2h", oddsFormat: "decimal" },
        headers: RAPID_HEADERS, timeout: 10000,
      });
      res.json({ sample: JSON.stringify(r2.data).slice(0, 2000) });
    } catch (e2) {
      res.json({ error: e.message, error2: e2.message, status: e.response?.status, status2: e2.response?.status });
    }
  }
});

app.get("/odds", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL)
      return res.json({ success: true, data: cache.data, cached: true });
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
    res.json({ success: true, data: data.filter(o=>o.isArb) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 ARBSCAN Backend v3.0 on port ${PORT}`);
  console.log(`   Using Odds Feed API via RapidAPI\n`);
});
