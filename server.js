const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

let cache = { data: [], timestamp: 0 };
const CACHE_TTL = 60 * 1000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

// ─── SPORTYBET ───────────────────────────────────────────────────────────────
async function fetchSportybet() {
  const results = [];
  const sports = [
    { id: "sr:sport:1", name: "Football", threeWay: true },
    { id: "sr:sport:2", name: "Basketball", threeWay: false },
    { id: "sr:sport:5", name: "Tennis", threeWay: false },
  ];
  for (const sport of sports) {
    try {
      const res = await axios.get(
        `https://www.sportybet.com/api/ng/factsCenter/pcEvents`,
        {
          params: { sportId: sport.id, marketId: "1,18", pageSize: 20, pageNum: 1, option: 1 },
          headers: { ...HEADERS, Referer: "https://www.sportybet.com/ng/" },
          timeout: 12000,
        }
      );
      const events = res.data?.data?.events || [];
      for (const ev of events) {
        const markets = {};
        for (const mkt of (ev.markets || [])) {
          if (mkt.id === "1") {
            const h2h = {};
            for (const o of (mkt.outcomes || [])) {
              if (["1","Home","W1"].includes(o.desc)) h2h.home = parseFloat(o.odds);
              if (["X","Draw"].includes(o.desc)) h2h.draw = parseFloat(o.odds);
              if (["2","Away","W2"].includes(o.desc)) h2h.away = parseFloat(o.odds);
            }
            if (h2h.home) markets.h2h = h2h;
          }
          if (mkt.id === "18") {
            const ou = {};
            for (const o of (mkt.outcomes || [])) {
              if (o.desc?.toLowerCase().includes("over")) ou.over = parseFloat(o.odds);
              if (o.desc?.toLowerCase().includes("under")) ou.under = parseFloat(o.odds);
            }
            if (ou.over) markets.ou = ou;
          }
        }
        if (markets.h2h?.home) {
          results.push({
            bookie: "SportyBet",
            sport: sport.name,
            home: ev.homeTeamName || ev.rivals?.[0]?.name || "Home",
            away: ev.awayTeamName || ev.rivals?.[1]?.name || "Away",
            eventId: String(ev.eventId || ev.id || Math.random()),
            markets,
          });
        }
      }
    } catch (e) {
      console.error(`SportyBet [${sport.name}]:`, e.response?.status || e.message);
    }
  }
  console.log(`SportyBet: ${results.length} events`);
  return results;
}

// ─── 1XBET ───────────────────────────────────────────────────────────────────
async function fetch1xbet() {
  const results = [];
  const sports = [
    { id: 1, name: "Football" },
    { id: 2, name: "Basketball" },
    { id: 5, name: "Tennis" },
  ];
  for (const sport of sports) {
    try {
      const res = await axios.get(
        `https://1xbet.ng/LineFeed/GetCupsList`,
        {
          params: { sport: sport.id, count: 50, cnt: 10, lng: "en", tf: 2200000, tz: 1, mode: 4, country: 168, getEmpty: true },
          headers: { ...HEADERS, Referer: "https://1xbet.ng/" },
          timeout: 12000,
        }
      );
      const leagues = res.data?.Value || [];
      for (const league of leagues) {
        for (const ev of (league.Events || [])) {
          if (!ev.T1 || !ev.T2) continue;
          const markets = {};
          if (ev.E?.length >= 2) {
            const isThree = sport.id === 1;
            markets.h2h = {
              home: parseFloat(ev.E[0]?.C) || null,
              draw: isThree && ev.E[1] ? parseFloat(ev.E[1]?.C) : null,
              away: parseFloat(ev.E[isThree ? 2 : 1]?.C) || null,
            };
          }
          if (markets.h2h?.home && markets.h2h?.away) {
            results.push({
              bookie: "1xBet",
              sport: sport.name,
              home: ev.T1,
              away: ev.T2,
              eventId: String(ev.I || Math.random()),
              markets,
            });
          }
        }
      }
    } catch (e) {
      console.error(`1xBet [${sport.name}]:`, e.response?.status || e.message);
    }
  }
  console.log(`1xBet: ${results.length} events`);
  return results;
}

// ─── BETWAY ───────────────────────────────────────────────────────────────────
async function fetchBetway() {
  const results = [];
  const sportIds = [
    { id: 1, name: "Football" },
    { id: 18, name: "Basketball" },
    { id: 45, name: "Tennis" },
  ];
  for (const sport of sportIds) {
    try {
      const res = await axios.get(
        `https://sports.betway.com.ng/api/widget/sport`,
        {
          params: { sport: sport.id, lang: "en", limit: 20 },
          headers: {
            ...HEADERS,
            Referer: "https://sports.betway.com.ng/",
            Origin: "https://sports.betway.com.ng",
          },
          timeout: 12000,
        }
      );
      const events = res.data?.events || res.data?.result || [];
      for (const ev of (Array.isArray(events) ? events : [])) {
        const markets = {};
        const mkt = (ev.markets || []).find(m =>
          ["Match Result","1X2","Match Winner","Full Time Result"].includes(m.name)
        );
        if (mkt) {
          const sel = mkt.selections || mkt.outcomes || [];
          const h = sel.find(s => ["Home","1","W1"].includes(s.name));
          const d = sel.find(s => ["Draw","X"].includes(s.name));
          const a = sel.find(s => ["Away","2","W2"].includes(s.name));
          if (h && a) {
            markets.h2h = {
              home: parseFloat(h.price?.decimal || h.odds || h.price),
              draw: d ? parseFloat(d.price?.decimal || d.odds || d.price) : null,
              away: parseFloat(a.price?.decimal || a.odds || a.price),
            };
          }
        }
        const ouMkt = (ev.markets || []).find(m => m.name?.includes("Over/Under") || m.name?.includes("Goals"));
        if (ouMkt) {
          const sel = ouMkt.selections || ouMkt.outcomes || [];
          const ov = sel.find(s => s.name?.toLowerCase().includes("over"));
          const un = sel.find(s => s.name?.toLowerCase().includes("under"));
          if (ov && un) markets.ou = { over: parseFloat(ov.price?.decimal || ov.odds), under: parseFloat(un.price?.decimal || un.odds) };
        }
        if (markets.h2h?.home) {
          results.push({
            bookie: "Betway",
            sport: sport.name,
            home: ev.homeTeam || ev.home?.name || ev.teamA || "Home",
            away: ev.awayTeam || ev.away?.name || ev.teamB || "Away",
            eventId: String(ev.id || ev.eventId || Math.random()),
            markets,
          });
        }
      }
    } catch (e) {
      console.error(`Betway [${sport.name}]:`, e.response?.status || e.message);
    }
  }
  console.log(`Betway: ${results.length} events`);
  return results;
}

// ─── BETKING ──────────────────────────────────────────────────────────────────
async function fetchBetking() {
  const results = [];
  try {
    const res = await axios.get(
      "https://www.betking.com/sports/api/highlights",
      {
        params: { sport_id: 1, market: "1x2", page: 1, limit: 30 },
        headers: { ...HEADERS, Referer: "https://www.betking.com/", Origin: "https://www.betking.com" },
        timeout: 12000,
      }
    );
    const events = res.data?.data?.events || res.data?.events || [];
    for (const ev of events) {
      const markets = {};
      const outcomes = ev.odds || ev.markets?.[0]?.selections || [];
      if (outcomes.length >= 2) {
        markets.h2h = {
          home: parseFloat(outcomes[0]?.price || outcomes[0]?.odds || outcomes[0]?.value),
          draw: outcomes[2] ? parseFloat(outcomes[1]?.price || outcomes[1]?.odds) : null,
          away: parseFloat(outcomes[outcomes.length - 1]?.price || outcomes[outcomes.length - 1]?.odds),
        };
      }
      if (markets.h2h?.home && markets.h2h?.away) {
        results.push({
          bookie: "BetKing",
          sport: "Football",
          home: ev.home_team || ev.homeTeam || ev.team1 || "Home",
          away: ev.away_team || ev.awayTeam || ev.team2 || "Away",
          eventId: String(ev.event_id || ev.id || Math.random()),
          markets,
        });
      }
    }
  } catch (e) {
    console.error("BetKing:", e.response?.status || e.message);
  }
  console.log(`BetKing: ${results.length} events`);
  return results;
}

// ─── MERRYBET ─────────────────────────────────────────────────────────────────
async function fetchMerrybet() {
  const results = [];
  try {
    const res = await axios.get(
      "https://www.merrybet.com/api/v1/sport/1/highlights",
      {
        headers: { ...HEADERS, Referer: "https://www.merrybet.com/", Origin: "https://www.merrybet.com" },
        timeout: 12000,
      }
    );
    const events = res.data?.events || res.data?.data || [];
    for (const ev of events) {
      const markets = {};
      const odds = ev.odds || ev.outcomes || [];
      const h = odds.find(o => o.name === "1" || o.label === "Home" || o.outcome_name === "1");
      const d = odds.find(o => o.name === "X" || o.label === "Draw" || o.outcome_name === "X");
      const a = odds.find(o => o.name === "2" || o.label === "Away" || o.outcome_name === "2");
      if (h && a) {
        markets.h2h = {
          home: parseFloat(h.odd || h.price || h.value),
          draw: d ? parseFloat(d.odd || d.price || d.value) : null,
          away: parseFloat(a.odd || a.price || a.value),
        };
      }
      if (markets.h2h?.home && markets.h2h?.away) {
        results.push({
          bookie: "MerryBet",
          sport: "Football",
          home: ev.home_team || ev.home || "Home",
          away: ev.away_team || ev.away || "Away",
          eventId: String(ev.id || Math.random()),
          markets,
        });
      }
    }
  } catch (e) {
    console.error("MerryBet:", e.response?.status || e.message);
  }
  console.log(`MerryBet: ${results.length} events`);
  return results;
}

// ─── TEAM MATCHER ─────────────────────────────────────────────────────────────
function normalize(name = "") {
  return name.toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|united|utd|city|town|athletic|atletico|sporting|real|club|de|the)\b/gi, "")
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
  // Group matching events across bookies
  const groups = [];
  for (const odd of allOdds) {
    let placed = false;
    for (const group of groups) {
      const ref = group[0];
      if (ref.sport === odd.sport && ref.bookie !== odd.bookie && teamsMatch(ref.home, ref.away, odd.home, odd.away)) {
        if (!group.find(g => g.bookie === odd.bookie)) group.push(odd);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([odd]);
  }

  const results = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const ref = group[0];
    const isThreeWay = ref.sport === "Football";

    // Build bookOdds map
    const bookOdds = {};
    for (const g of group) {
      if (g.markets?.h2h?.home && g.markets?.h2h?.away) {
        bookOdds[g.bookie] = {
          home: g.markets.h2h.home,
          draw: g.markets.h2h.draw || null,
          away: g.markets.h2h.away,
        };
      }
    }
    if (Object.keys(bookOdds).length < 2) continue;

    // Find best odds
    let bestHome = { odds: 0, bookie: "" };
    let bestDraw = { odds: 0, bookie: "" };
    let bestAway = { odds: 0, bookie: "" };
    for (const [bookie, odds] of Object.entries(bookOdds)) {
      if (odds.home > bestHome.odds) bestHome = { odds: odds.home, bookie };
      if (odds.away > bestAway.odds) bestAway = { odds: odds.away, bookie };
      if (isThreeWay && odds.draw && odds.draw > bestDraw.odds) bestDraw = { odds: odds.draw, bookie };
    }

    const sumInverse = isThreeWay && bestDraw.odds > 0
      ? 1 / bestHome.odds + 1 / bestDraw.odds + 1 / bestAway.odds
      : 1 / bestHome.odds + 1 / bestAway.odds;
    const profitPct = ((1 - sumInverse) / sumInverse) * 100;

    // O/U arb
    let ouArb = null;
    const ouMap = {};
    for (const g of group) {
      if (g.markets?.ou?.over && g.markets?.ou?.under) ouMap[g.bookie] = g.markets.ou;
    }
    if (Object.keys(ouMap).length >= 2) {
      let bestOver = { odds: 0, bookie: "" }, bestUnder = { odds: 0, bookie: "" };
      for (const [bookie, odds] of Object.entries(ouMap)) {
        if (odds.over > bestOver.odds) bestOver = { odds: odds.over, bookie };
        if (odds.under > bestUnder.odds) bestUnder = { odds: odds.under, bookie };
      }
      const ouSum = 1 / bestOver.odds + 1 / bestUnder.odds;
      if (ouSum < 1) ouArb = { bestOver, bestUnder, sumInverse: ouSum, profitPct: ((1 - ouSum) / ouSum) * 100 };
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

// ─── SCRAPE ALL ───────────────────────────────────────────────────────────────
async function scrapeAll() {
  console.log("\n🔍 Scraping bookmakers...");
  const [a, b, c, d, e] = await Promise.allSettled([
    fetchSportybet(),
    fetch1xbet(),
    fetchBetway(),
    fetchBetking(),
    fetchMerrybet(),
  ]);

  const all = [
    ...(a.status === "fulfilled" ? a.value : []),
    ...(b.status === "fulfilled" ? b.value : []),
    ...(c.status === "fulfilled" ? c.value : []),
    ...(d.status === "fulfilled" ? d.value : []),
    ...(e.status === "fulfilled" ? e.value : []),
  ];

  const bookies = [...new Set(all.map(o => o.bookie))];
  console.log(`✅ ${all.length} total odds from: ${bookies.join(", ") || "none"}`);

  const result = findArb(all);
  const arbCount = result.filter(o => o.isArb).length;
  const ouCount = result.filter(o => o.ouArb).length;
  console.log(`⚡ ${result.length} matched markets | ${arbCount} 1X2 arb | ${ouCount} O/U arb\n`);
  return result;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), version: "2.0" });
});

app.get("/odds", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL) {
      return res.json({ success: true, data: cache.data, cached: true, age: Math.round((now - cache.timestamp) / 1000) + "s" });
    }
    const data = await scrapeAll();
    cache = { data, timestamp: now };
    res.json({ success: true, data, cached: false, count: data.length });
  } catch (e) {
    console.error("Error:", e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get("/arb", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL) {
      return res.json({ success: true, data: cache.data.filter(o => o.isArb), cached: true });
    }
    const data = await scrapeAll();
    cache = { data, timestamp: now };
    res.json({ success: true, data: data.filter(o => o.isArb), count: data.filter(o => o.isArb).length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 ARBSCAN Backend v2.0 on port ${PORT}`);
  console.log(`   Scraping: SportyBet | 1xBet | Betway | BetKing | MerryBet\n`);
});
