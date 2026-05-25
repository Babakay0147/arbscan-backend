const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

let cache = { data: [], timestamp: 0 };
const CACHE_TTL = 60 * 1000;

// ─── SPORTYBET ───────────────────────────────────────────────────────────────
async function fetchSportybet() {
  const results = [];
  try {
    const sportIds = [
      { id: "sr:sport:1", name: "Football", threeWay: true },
      { id: "sr:sport:2", name: "Basketball", threeWay: false },
      { id: "sr:sport:5", name: "Tennis", threeWay: false },
      { id: "sr:sport:21", name: "Cricket", threeWay: false },
    ];
    for (const sport of sportIds) {
      try {
        const res = await axios.get(
          `https://www.sportybet.com/api/ng/factsCenter/pcEvents?sportId=${sport.id}&marketId=1,18&pageSize=20&pageNum=1&option=1`,
          { headers: HEADERS, timeout: 10000 }
        );
        const events = res.data?.data?.events || [];
        for (const ev of events) {
          const markets = {};
          for (const mkt of (ev.markets || [])) {
            if (mkt.id === "1") {
              const outcomes = {};
              for (const o of (mkt.outcomes || [])) {
                if (o.desc === "1" || o.desc === "Home") outcomes.home = parseFloat(o.odds);
                if (o.desc === "X" || o.desc === "Draw") outcomes.draw = parseFloat(o.odds);
                if (o.desc === "2" || o.desc === "Away") outcomes.away = parseFloat(o.odds);
              }
              markets.h2h = outcomes;
            }
            if (mkt.id === "18") {
              const outcomes = {};
              for (const o of (mkt.outcomes || [])) {
                if (o.desc?.includes("Over")) outcomes.over = parseFloat(o.odds);
                if (o.desc?.includes("Under")) outcomes.under = parseFloat(o.odds);
              }
              if (outcomes.over) markets.ou = outcomes;
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
      } catch (e) {}
    }
  } catch (e) { console.error("SportyBet:", e.message); }
  return results;
}

// ─── 1XBET ───────────────────────────────────────────────────────────────────
async function fetch1xbet() {
  const results = [];
  const sportConfigs = [
    { id: 1, name: "Football", threeWay: true },
    { id: 2, name: "Basketball", threeWay: false },
    { id: 5, name: "Tennis", threeWay: false },
  ];
  for (const sport of sportConfigs) {
    try {
      const res = await axios.get(
        `https://1xbet.ng/LineFeed/GetCupsList?sport=${sport.id}&count=30&cnt=10&lng=en&tf=2200000&tz=1&mode=4&country=168&getEmpty=true`,
        { headers: HEADERS, timeout: 10000 }
      );
      const leagues = res.data?.Value || [];
      for (const league of leagues) {
        for (const ev of (league.Events || [])) {
          if (!ev.T1 || !ev.T2) continue;
          const markets = {};
          if (ev.E && ev.E.length >= 2) {
            markets.h2h = {
              home: parseFloat(ev.E[0]?.C) || null,
              draw: ev.E[2] ? parseFloat(ev.E[1]?.C) : null,
              away: parseFloat(ev.E[ev.E.length > 2 ? 2 : 1]?.C) || null,
            };
          }
          if (markets.h2h?.home) {
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
    } catch (e) { console.error("1xBet sport", sport.name, e.message); }
  }
  return results;
}

// ─── BETKING ─────────────────────────────────────────────────────────────────
async function fetchBetking() {
  const results = [];
  try {
    const res = await axios.get(
      "https://www.betking.com/sports/api/events?sport=1&category=1&tournament=&page=1&per_page=20&lang=en",
      { headers: { ...HEADERS, Origin: "https://www.betking.com" }, timeout: 10000 }
    );
    const events = res.data?.events || res.data?.data || [];
    for (const ev of events) {
      const markets = {};
      const mkt = ev.markets?.find(m => ["1x2","match_winner","1X2"].includes(m.name?.toLowerCase() || m.key));
      if (mkt) {
        const h = mkt.outcomes?.find(o => ["1","home","w1"].includes(o.name?.toLowerCase()));
        const d = mkt.outcomes?.find(o => ["x","draw"].includes(o.name?.toLowerCase()));
        const a = mkt.outcomes?.find(o => ["2","away","w2"].includes(o.name?.toLowerCase()));
        if (h && a) markets.h2h = { home: parseFloat(h.odds||h.price), draw: d ? parseFloat(d.odds||d.price) : null, away: parseFloat(a.odds||a.price) };
      }
      const ouMkt = ev.markets?.find(m => m.name?.toLowerCase().includes("over") || m.name?.toLowerCase().includes("under"));
      if (ouMkt) {
        const ov = ouMkt.outcomes?.find(o => o.name?.toLowerCase().includes("over"));
        const un = ouMkt.outcomes?.find(o => o.name?.toLowerCase().includes("under"));
        if (ov && un) markets.ou = { over: parseFloat(ov.odds||ov.price), under: parseFloat(un.odds||un.price) };
      }
      if (markets.h2h?.home) {
        results.push({
          bookie: "BetKing",
          sport: "Football",
          home: ev.home_team || ev.homeTeam || ev.home?.name || "Home",
          away: ev.away_team || ev.awayTeam || ev.away?.name || "Away",
          eventId: String(ev.id || ev.event_id || Math.random()),
          markets,
        });
      }
    }
  } catch (e) { console.error("BetKing:", e.message); }
  return results;
}

// ─── BET9JA ───────────────────────────────────────────────────────────────────
async function fetchBet9ja() {
  const results = [];
  try {
    const res = await axios.get(
      "https://sports.bet9ja.com/api/v2/landing/top-events?sport_id=1&lang=en",
      { headers: { ...HEADERS, Origin: "https://sports.bet9ja.com" }, timeout: 10000 }
    );
    const events = res.data?.events || res.data?.data?.events || [];
    for (const ev of events) {
      const markets = {};
      const mkt = ev.markets?.find(m => m.market_id === 1 || ["Match Winner","1X2","1x2"].includes(m.name));
      if (mkt?.outcomes) {
        const h = mkt.outcomes.find(o => ["1","Home"].includes(o.name));
        const d = mkt.outcomes.find(o => ["X","Draw"].includes(o.name));
        const a = mkt.outcomes.find(o => ["2","Away"].includes(o.name));
        if (h && a) markets.h2h = { home: parseFloat(h.odds), draw: d ? parseFloat(d.odds) : null, away: parseFloat(a.odds) };
      }
      const ouMkt = ev.markets?.find(m => m.name?.includes("Over/Under") || m.name?.includes("Goals"));
      if (ouMkt?.outcomes) {
        const ov = ouMkt.outcomes.find(o => o.name?.includes("Over"));
        const un = ouMkt.outcomes.find(o => o.name?.includes("Under"));
        if (ov && un) markets.ou = { over: parseFloat(ov.odds), under: parseFloat(un.odds) };
      }
      if (markets.h2h?.home) {
        results.push({
          bookie: "Bet9ja",
          sport: "Football",
          home: ev.home_team || ev.home?.name || "Home",
          away: ev.away_team || ev.away?.name || "Away",
          eventId: String(ev.event_id || ev.id || Math.random()),
          markets,
        });
      }
    }
  } catch (e) { console.error("Bet9ja:", e.message); }
  return results;
}

// ─── BETWAY ───────────────────────────────────────────────────────────────────
async function fetchBetway() {
  const results = [];
  try {
    const res = await axios.get(
      "https://www.betway.com.ng/api/awk/event-selection/EventSelections?sportName=Football&eventCount=20&marketCount=3&lang=en-gb",
      { headers: { ...HEADERS, Origin: "https://www.betway.com.ng" }, timeout: 10000 }
    );
    const events = res.data?.events || res.data?.result?.events || [];
    for (const ev of events) {
      const markets = {};
      const mkt = ev.markets?.find(m => m.name === "Match Result" || m.name === "1X2" || m.marketType === "MatchResult");
      if (mkt?.selections || mkt?.outcomes) {
        const opts = mkt.selections || mkt.outcomes;
        const h = opts.find(o => o.name === "Home" || o.name === "1");
        const d = opts.find(o => o.name === "Draw" || o.name === "X");
        const a = opts.find(o => o.name === "Away" || o.name === "2");
        if (h && a) {
          markets.h2h = {
            home: parseFloat(h.price?.decimal || h.odds || h.price),
            draw: d ? parseFloat(d.price?.decimal || d.odds || d.price) : null,
            away: parseFloat(a.price?.decimal || a.odds || a.price),
          };
        }
      }
      if (markets.h2h?.home) {
        results.push({
          bookie: "Betway",
          sport: "Football",
          home: ev.homeTeam || ev.home?.name || "Home",
          away: ev.awayTeam || ev.away?.name || "Away",
          eventId: String(ev.id || ev.eventId || Math.random()),
          markets,
        });
      }
    }
  } catch (e) { console.error("Betway:", e.message); }
  return results;
}

// ─── TEAM NAME NORMALIZER ─────────────────────────────────────────────────────
function normalize(name) {
  return name.toLowerCase()
    .replace(/\b(fc|cf|sc|ac|afc|united|utd|city|town|athletic|atletico|sporting|real|club)\b/gi, "")
    .replace(/[^a-z0-9]/g, "").trim();
}

function teamsMatch(a1, a2, b1, b2) {
  const [na1,na2,nb1,nb2] = [a1,a2,b1,b2].map(normalize);
  const fwd = (na1.includes(nb1)||nb1.includes(na1)) && (na2.includes(nb2)||nb2.includes(na2));
  const rev = (na1.includes(nb2)||nb2.includes(na1)) && (na2.includes(nb1)||nb1.includes(na2));
  return (fwd||rev) && na1.length > 2 && nb1.length > 2;
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

    // H2H odds
    const bookOdds = {};
    for (const g of group) {
      if (g.markets?.h2h?.home && g.markets?.h2h?.away) {
        bookOdds[g.bookie] = { home: g.markets.h2h.home, draw: g.markets.h2h.draw || null, away: g.markets.h2h.away };
      }
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
    const profitPct = ((1-sumInverse)/sumInverse)*100;

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
      const ouSum = 1/bestOver.odds + 1/bestUnder.odds;
      if (ouSum < 1) ouArb = { bestOver, bestUnder, sumInverse: ouSum, profitPct: ((1-ouSum)/ouSum)*100 };
    }

    results.push({
      id: `${ref.sport}-${ref.home}-${ref.away}`.replace(/\s/g,"-").toLowerCase(),
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
  console.log("🔍 Scraping bookmakers...");
  const [a,b,c,d,e] = await Promise.allSettled([fetchSportybet(), fetch1xbet(), fetchBetking(), fetchBet9ja(), fetchBetway()]);
  const all = [
    ...(a.status==="fulfilled"?a.value:[]),
    ...(b.status==="fulfilled"?b.value:[]),
    ...(c.status==="fulfilled"?c.value:[]),
    ...(d.status==="fulfilled"?d.value:[]),
    ...(e.status==="fulfilled"?e.value:[]),
  ];
  const bookies = [...new Set(all.map(o=>o.bookie))];
  console.log(`✅ ${all.length} odds from: ${bookies.join(", ")}`);
  const result = findArb(all);
  console.log(`⚡ ${result.filter(o=>o.isArb).length} arb opportunities found`);
  return result;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.get("/odds", async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data.length && now - cache.timestamp < CACHE_TTL) {
      return res.json({ success: true, data: cache.data, cached: true, age: Math.round((now-cache.timestamp)/1000)+"s" });
    }
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
    if (cache.data.length && now - cache.timestamp < CACHE_TTL) {
      return res.json({ success: true, data: cache.data.filter(o=>o.isArb), cached: true });
    }
    const data = await scrapeAll();
    cache = { data, timestamp: now };
    res.json({ success: true, data: data.filter(o=>o.isArb), count: data.filter(o=>o.isArb).length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 ARBSCAN Backend on port ${PORT}`);
  console.log(`   /health  /odds  /arb\n`);
});
