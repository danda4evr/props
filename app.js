// Prop Check: pulls a player's game logs from ESPN in the browser and grades a prop line against them.
const API = "https://site.web.api.espn.com/apis/common/v3";
const SITE_API = "https://site.api.espn.com/apis/site/v2";
const LEAGUES = {
  nba: { sport: "basketball", label: "NBA", chartGames: 15 },
  wnba: { sport: "basketball", label: "WNBA", chartGames: 15 },
  nfl: { sport: "football", label: "NFL", chartGames: 10 },
};

// Stat label -> ESPN game-log columns summed for it (only stats the player's log has are offered)
const BASKETBALL = [
  ["Points", ["points"]],
  ["Rebounds", ["totalRebounds"]],
  ["Assists", ["assists"]],
  ["Threes made", ["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]],
  ["Pts + Reb + Ast", ["points", "totalRebounds", "assists"]],
  ["Pts + Reb", ["points", "totalRebounds"]],
  ["Pts + Ast", ["points", "assists"]],
  ["Reb + Ast", ["totalRebounds", "assists"]],
  ["Steals", ["steals"]],
  ["Blocks", ["blocks"]],
  ["Steals + Blocks", ["steals", "blocks"]],
  ["Turnovers", ["turnovers"]],
  ["Free throws made", ["freeThrowsMade-freeThrowsAttempted"]],
];
const STATS = {
  nba: BASKETBALL,
  wnba: BASKETBALL,
  nfl: [
    ["Passing yards", ["passingYards"]],
    ["Completions", ["completions"]],
    ["Pass attempts", ["passingAttempts"]],
    ["Passing TDs", ["passingTouchdowns"]],
    ["Interceptions thrown", ["interceptions"]],
    ["Longest completion", ["longPassing"]],
    ["Rushing yards", ["rushingYards"]],
    ["Rush attempts", ["rushingAttempts"]],
    ["Longest rush", ["longRushing"]],
    ["Receptions", ["receptions"]],
    ["Receiving yards", ["receivingYards"]],
    ["Targets", ["receivingTargets"]],
    ["Longest reception", ["longReception"]],
    ["Rush + rec yards", ["rushingYards", "receivingYards"]],
    ["Pass + rush yards", ["passingYards", "rushingYards"]],
    ["Sacks (defense)", ["sacks"]],
    ["Total tackles", ["totalTackles"]],
  ],
};
// Weights for the blended verdict; windows with no games drop out and the rest are rescaled.
const WEIGHTS = { l10: 0.35, season: 0.25, l5: 0.2, last: 0.1, opp: 0.1 };

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => `${Math.round(x * 100)}%`;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const cache = new Map();
async function get(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`ESPN returned ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}

let player = null; // { id, league, name, athlete, games, seasons, next }

/* ---------- Search ---------- */
const input = $("#player"), list = $("#suggest");
let searchTimer, results = [], active = -1;

input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = input.value.trim();
  if (player && q !== player.name) player = null;
  if (q.length < 2) return closeSuggest();
  searchTimer = setTimeout(() => search(q), 220);
});
input.addEventListener("keydown", (e) => {
  if (list.hidden) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    active = (active + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    paintSuggest();
  } else if (e.key === "Enter" && active >= 0) {
    e.preventDefault();
    choose(results[active]);
  } else if (e.key === "Escape") {
    closeSuggest();
  }
});
input.addEventListener("blur", () => setTimeout(closeSuggest, 150));

async function search(q) {
  try {
    const d = await get(`${API}/search?query=${encodeURIComponent(q)}&type=player&limit=20`);
    if (input.value.trim() !== q) return;
    results = (d.items || []).filter((i) => LEAGUES[i.league]).slice(0, 8);
    active = results.length ? 0 : -1;
    paintSuggest();
  } catch {
    setStatus("Search isn't responding. Try again in a moment.", true);
  }
}

function paintSuggest() {
  if (!results.length) {
    list.innerHTML = `<li aria-disabled="true"><span class="muted">No NBA, WNBA or NFL players match.</span></li>`;
  } else {
    list.innerHTML = results.map((r, i) => `
      <li role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}">
        <span>${esc(r.displayName)}</span><span class="lg">${esc(LEAGUES[r.league].label)}${r.subtitle ? ` · ${esc(r.subtitle)}` : ""}</span>
      </li>`).join("");
  }
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
  if (active >= 0) input.setAttribute("aria-activedescendant", `opt-${active}`);
}
list.addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-i]");
  if (li) { e.preventDefault(); choose(results[+li.dataset.i]); }
});
function closeSuggest() {
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

/* ---------- Loading a player ---------- */
async function choose(r, wanted = {}) {
  closeSuggest();
  input.value = r.displayName;
  setStatus(`Loading ${r.displayName}'s game logs…`);
  $("#stat").disabled = true;
  try {
    player = await loadPlayer(r.id, r.league);
  } catch {
    player = null;
    setStatus("Couldn't load that player's game logs from ESPN. Try again in a moment.", true);
    return;
  }
  if (!player.games.length) {
    setStatus(`No regular-season games on record for ${player.name} in the last two seasons.`, true);
    return;
  }
  fillStats(wanted.stat);
  if (wanted.line != null) $("#line").value = wanted.line;
  if (wanted.side) document.getElementById(wanted.side === "Under" ? "side-under" : "side-over").checked = true;
  setStatus("");
  if ($("#line").value !== "") run();
  else { $("#line").focus(); setStatus(`Got ${player.games.length} games for ${player.name}. Enter the line.`); }
}

async function loadPlayer(id, league) {
  const L = LEAGUES[league];
  const base = `${API}/sports/${L.sport}/${league}/athletes/${id}`;
  const [ath, cur] = await Promise.all([get(base).catch(() => ({})), get(`${base}/gamelog`)]);
  const seasonOpts = cur.filters?.find((f) => f.name === "season")?.options || [];
  const curSeason = cur.filters?.find((f) => f.name === "season")?.value;
  const prev = seasonOpts.find((o) => o.value !== curSeason && +o.value < +curSeason);
  const prevLog = prev ? await get(`${base}/gamelog?season=${prev.value}`).catch(() => null) : null;

  const games = [...parseLog(cur, "cur"), ...(prevLog ? parseLog(prevLog, "last") : [])]
    .sort((a, b) => b.date - a.date);
  const athlete = ath.athlete || {};
  const next = athlete.team?.id ? await nextGame(L.sport, league, athlete.team.id).catch(() => null) : null;
  return {
    id, league, athlete, games, next,
    name: athlete.displayName || input.value,
    seasons: {
      cur: seasonOpts.find((o) => o.value === curSeason)?.displayValue || "This season",
      last: prev?.displayValue || "Last season",
    },
    names: new Set([...(cur.names || []), ...(prevLog?.names || [])]),
  };
}

// Regular-season games only, most recent first. Basketball games with 0 minutes are DNPs and skipped.
function parseLog(d, season) {
  const names = d.names || [];
  const out = [];
  for (const st of d.seasonTypes || []) {
    if (!/Regular/i.test(st.displayName || "")) continue;
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const stats = {};
        names.forEach((n, i) => {
          const raw = ev.stats[i] ?? "";
          stats[n] = parseFloat(String(raw).split("-")[0]) || 0;
        });
        if ("minutes" in stats && stats.minutes === 0) continue;
        const meta = d.events?.[ev.eventId] || {};
        out.push({
          id: ev.eventId, season, stats,
          date: new Date(meta.gameDate || 0),
          opp: meta.opponent?.abbreviation || "?",
          oppId: meta.opponent?.id,
          home: meta.atVs !== "@",
          result: meta.gameResult || "",
          score: meta.score || "",
        });
      }
    }
  }
  return out;
}

async function nextGame(sport, league, teamId) {
  const d = await get(`${SITE_API}/sports/${sport}/${league}/teams/${teamId}/schedule`);
  const ev = (d.events || []).find((e) => e.competitions?.[0]?.status?.type?.state === "pre");
  if (!ev) return null;
  const comps = ev.competitions[0].competitors;
  const me = comps.find((c) => c.team?.id === String(teamId)) || comps[0];
  const them = comps.find((c) => c !== me);
  return { date: new Date(ev.date), home: me.homeAway === "home", opp: them.team.abbreviation, oppId: them.team.id, oppName: them.team.displayName };
}

function fillStats(wantedLabel) {
  const sel = $("#stat");
  const opts = STATS[player.league].filter(([, cols]) => cols.every((c) => player.names.has(c)));
  sel.innerHTML = opts.map(([label], i) => `<option value="${i}">${esc(label)}</option>`).join("");
  sel.dataset.league = player.league;
  sel.disabled = false;
  const keep = opts.findIndex(([label]) => label === wantedLabel);
  if (keep >= 0) sel.value = String(keep);
  player.stats = opts;
}

/* ---------- Grading ---------- */
function grade(games, cols, line, side) {
  let hit = 0, miss = 0, push = 0;
  for (const g of games) {
    const v = value(g, cols);
    if (v === line) push++;
    else if ((v > line) === (side === "Over")) hit++;
    else miss++;
  }
  const n = hit + miss;
  return { hit, miss, push, n, rate: n ? hit / n : null };
}
const value = (g, cols) => cols.reduce((s, c) => s + (g.stats[c] || 0), 0);

function run() {
  if (!player) return setStatus("Pick a player from the list first.", true);
  const line = parseFloat($("#line").value);
  if (!Number.isFinite(line)) return setStatus("Enter the prop line, like 24.5.", true);
  const [label, cols] = player.stats[+$("#stat").value];
  const side = document.querySelector('input[name="side"]:checked').value;
  setStatus("");

  const g = player.games;
  const cur = g.filter((x) => x.season === "cur");
  const last = g.filter((x) => x.season === "last");
  const opp = player.next ? g.filter((x) => x.oppId === player.next.oppId) : [];
  const venue = player.next ? g.filter((x) => x.home === player.next.home && x.season === "cur") : [];
  const windows = [
    ["l5", "Last 5", g.slice(0, 5)],
    ["l10", "Last 10", g.slice(0, 10)],
    ["season", player.seasons.cur, cur],
    ["last", player.seasons.last, last],
  ];
  if (player.next) {
    windows.push(["opp", `vs ${player.next.opp}`, opp]);
    windows.push(["venue", player.next.home ? "Home this year" : "Away this year", venue]);
  }
  const graded = windows.map(([key, name, games]) => ({ key, name, ...grade(games, cols, line, side) }));

  let wsum = 0, score = 0;
  for (const w of graded) {
    if (WEIGHTS[w.key] && w.rate !== null) { wsum += WEIGHTS[w.key]; score += WEIGHTS[w.key] * w.rate; }
  }
  score = wsum ? score / wsum : null;

  renderHead(label, line, side, score, graded);
  renderRates(graded);
  renderChart(cols, line, side);
  renderLog(cols, line, side, label);
  $("#result").hidden = false;
  const scroller = $(".chart-scroll");
  scroller.scrollLeft = scroller.scrollWidth; // newest games are on the right
  writeUrl(label, line, side);
}

/* ---------- Rendering ---------- */
function renderHead(label, line, side, score, graded) {
  const a = player.athlete;
  const img = $("#headshot");
  img.src = a.headshot?.href || "";
  img.alt = a.headshot?.href ? player.name : "";
  $("#r-name").textContent = player.name;
  const bits = [LEAGUES[player.league].label, a.team?.displayName, a.position?.abbreviation].filter(Boolean);
  if (player.next) {
    const when = player.next.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    bits.push(`Next: ${player.next.home ? "vs" : "@"} ${player.next.opp}, ${when}`);
  }
  $("#r-meta").textContent = bits.join(" · ");

  const v = $("#verdict");
  const thin = (graded.find((w) => w.key === "season")?.n || 0) < 5;
  if (score === null) {
    v.innerHTML = `<span class="word pass">No data</span><span class="why">No graded games for this line.</span>`;
    return;
  }
  const [cls, word] = score >= 0.65 ? ["good", "Good"] : score >= 0.55 ? ["lean", "Lean"] : ["pass", "Pass"];
  const other = side === "Over" ? "Under" : "Over";
  const notes = [`${side} ${fmt(line)} ${label.toLowerCase()} · blended ${pct(score)}`];
  if (score <= 0.35) notes.push(`The ${other} has hit ${pct(1 - score)} blended.`);
  if (thin) notes.push("Few games this season, so lean on last season with care.");
  v.innerHTML = `<span class="word ${cls}">${word}</span>${notes.map((n) => `<span class="why">${esc(n)}</span>`).join("")}`;
}

function renderRates(graded) {
  $("#rates").innerHTML = graded.map((w) => {
    const cls = w.rate === null ? "none" : w.rate >= 0.65 ? "hi" : w.rate >= 0.55 ? "mid" : "lo";
    return `<div class="rate ${cls}">
      <span class="k">${esc(w.name)}</span>
      <span class="v">${w.rate === null ? "–" : pct(w.rate)}</span>
      <span class="n">${w.n ? `${w.hit} of ${w.n}${w.push ? ` · ${w.push} push` : ""}` : "no games"}</span>
      <span class="meter"><span style="width:${w.rate === null ? 0 : w.rate * 100}%"></span></span>
    </div>`;
  }).join("");
}

function renderChart(cols, line, side) {
  const n = LEAGUES[player.league].chartGames;
  const games = player.games.slice(0, n).reverse();
  const vals = games.map((g) => value(g, cols));
  const top = Math.max(line, ...vals) * 1.15 || 1;
  const cls = (v) => (v === line ? "push" : (v > line) === (side === "Over") ? "hit" : "miss");
  const md = { month: "numeric", day: "numeric" };
  $("#chart-sub").textContent = `Last ${games.length} games · dashed line is ${fmt(line)}`;
  $(".chart-scroll").style.setProperty("--n", games.length);
  $("#chart").innerHTML = games.map((g, i) => `
    <div class="col" title="${esc(`${g.date.toLocaleDateString("en-US", md)} ${g.home ? "vs" : "@"} ${g.opp}: ${fmt(vals[i])}`)}">
      <span class="bar ${cls(vals[i])}" style="height:${(vals[i] / top) * 100}%"></span>
      <span class="val" style="bottom:${(vals[i] / top) * 100}%">${fmt(vals[i])}</span>
    </div>`).join("") +
    `<div class="threshold" style="bottom:${(line / top) * 100}%"><span>${fmt(line)}</span></div>`;
  const x = document.querySelector(".chart-x") || Object.assign(document.createElement("div"), { className: "chart-x" });
  x.innerHTML = games.map((g) => `<span>${g.home ? "" : "@"}${esc(g.opp)}<br>${g.date.toLocaleDateString("en-US", md)}</span>`).join("");
  $("#chart").after(x);
}

function renderLog(cols, line, side, label) {
  const rows = [];
  let lastSeason = null;
  const vals = player.games.map((g) => value(g, cols));
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const curVals = player.games.filter((g) => g.season === "cur").map((g) => value(g, cols));
  $("#avg").textContent = `Avg last 10: ${fmt(+avg(vals.slice(0, 10)).toFixed(1))} · ${player.seasons.cur}: ${curVals.length ? fmt(+avg(curVals).toFixed(1)) : "–"}`;
  player.games.forEach((g, i) => {
    if (g.season !== lastSeason) {
      rows.push(`<tr class="season"><td colspan="5">${esc(player.seasons[g.season])}</td></tr>`);
      lastSeason = g.season;
    }
    const v = vals[i];
    const res = v === line ? "push" : (v > line) === (side === "Over") ? "hit" : "miss";
    rows.push(`<tr>
      <td class="num">${g.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
      <td>${g.home ? "vs" : "@"} ${esc(g.opp)}</td>
      <td class="muted res-col">${esc(g.result)} ${esc(g.score)}</td>
      <td class="r num">${fmt(v)}</td>
      <td class="r"><span class="pill ${res}">${res}</span></td>
    </tr>`);
  });
  $("#log").innerHTML = `<thead><tr><th>Date</th><th>Opp</th><th class="res-col">Result</th><th class="r">${esc(label)}</th><th class="r">${side} ${fmt(line)}</th></tr></thead><tbody>${rows.join("")}</tbody>`;
}

function setStatus(msg, err = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("err", err);
}

/* ---------- Shareable links: ?p=<espn id>&l=nba&s=Points&line=24.5&side=Over ---------- */
function writeUrl(label, line, side) {
  const q = new URLSearchParams({ p: player.id, l: player.league, s: label, line, side });
  history.replaceState(null, "", `?${q}`);
}

async function readUrl() {
  const q = new URLSearchParams(location.search);
  const id = q.get("p"), league = q.get("l");
  if (!id || !LEAGUES[league]) return;
  const line = q.get("line");
  await choose({ id, league, displayName: "player" }, { stat: q.get("s"), line: line === null ? null : parseFloat(line), side: q.get("side") });
  if (player) input.value = player.name;
}

$("#form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!player && results.length) return choose(results[Math.max(active, 0)]);
  run();
});
$("#stat").addEventListener("change", () => { if ($("#line").value !== "" && !$("#result").hidden) run(); });
document.querySelectorAll('input[name="side"]').forEach((r) => r.addEventListener("change", () => { if (!$("#result").hidden) run(); }));

readUrl();
