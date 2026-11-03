// Lig sekmesi: lig ve takım seç, fikstür kurulsun, hafta hafta oyna; puan durumu, haftalık fikstür, devam.
// Lig verisi league.js'te (saf mantık), maçlar script.js motorunda oynanır. Kart ve ortak parçalar tournament-ui.js'te.

const LEAGUE_KEY = "rotascore-league";

let league = null;                                        // aktif sezon (localStorage'da saklanır)
let leagueSetup = { competition: "super-lig", team: null };
let leagueMatch = null;                                   // canlı oynanan lig maçı: { label }
let leagueWeekView = 0;                                   // fikstür bölümünde gösterilen hafta (0 tabanlı)
let leagueAbandonArmed = 0;

function leagueCompetition() {
    const id = league ? league.competition : leagueSetup.competition;
    return competitions.find(c => c.id === id);
}

function loadLeague() {
    try {
        league = JSON.parse(localStorage.getItem(LEAGUE_KEY));
    } catch (error) {
        league = null;
    }
    if (league && league.version !== 1) league = null;
    if (league) leagueWeekView = Math.min(league.played, league.weeks.length - 1);
    if (leagueActive()) {
        selection.mode = league.mode;
        saveSelection();
    }
}

function saveLeague() {
    try {
        if (league) localStorage.setItem(LEAGUE_KEY, JSON.stringify(league));
        else localStorage.removeItem(LEAGUE_KEY);
    } catch (error) {
        // yoksay
    }
}

function leagueActive() {
    return !!league && league.stage !== "done";
}

// ---------- Kurulum ----------

function renderLeagueSetup() {
    const select = $("league-select");
    if (!select.options.length) {
        for (const c of competitions.filter(x => x.type === "league")) select.appendChild(new Option(c.name, c.id));
    }
    select.value = leagueSetup.competition;
    const button = $("pick-league-team");
    button.innerHTML = "";
    const id = leagueSetup.team;
    if (id && leagueCompetition().teams.includes(id)) {
        button.appendChild(teamBadge(id, "badge-md"));
        const text = document.createElement("span");
        text.className = "pick-text";
        const rating = selection.mode === "realistic" && teamRating(id);
        text.innerHTML = `<small>Your team${rating ? ` · Elo ${rating.elo}` : ""}</small>`;
        const name = document.createElement("strong");
        name.textContent = teamData(id).name;
        text.appendChild(name);
        button.appendChild(text);
    } else {
        leagueSetup.team = null;
        button.innerHTML = `<span class="pick-text"><small>Your team</small><strong>Choose a club</strong></span>`;
    }
    $("league-start").disabled = !leagueSetup.team;
    const c = leagueCompetition();
    $("league-setup-note").textContent = `${c.name} · ${c.teams.length} clubs · single round, ${c.teams.length - 1} matches · ${selection.mode === "realistic" ? "Realistic" : "Classic"} mode, locked once the season starts.`;
}

function startLeague() {
    if (!leagueSetup.team) return;
    const c = leagueCompetition();
    const clubRatings = {};
    for (const id of c.teams) {
        const rating = teamRating(id);
        clubRatings[id] = rating ? rating.elo : null;
    }
    try {
        league = createLeague(c.id, leagueSetup.team, { teams: c.teams, ratings: clubRatings, mode: selection.mode });
    } catch (error) {
        $("league-setup-note").textContent = `Could not build the season: ${error.message}`;
        return;
    }
    leagueWeekView = 0;
    saveLeague();
    renderMode();
    renderLeague();
    $("league-fixtures-section").open = true;
    $("league-table-section").open = false;
}

function abandonLeague() {
    if (Date.now() - leagueAbandonArmed > 4000) {
        leagueAbandonArmed = Date.now();
        $("league-quit").textContent = "Tap again to abandon";
        setTimeout(() => { $("league-quit").textContent = "Abandon season"; }, 4000);
        return;
    }
    league = null;
    leagueMatch = null;
    saveLeague();
    renderMode();
    renderLeague();
}

// ---------- Aktif sezon ----------

function renderLeague() {
    const setup = $("league-setup");
    const live = $("league-live");
    setup.hidden = !!league;
    live.hidden = !league;
    if (!league) {
        renderLeagueSetup();
        return;
    }
    const l = league;
    const c = leagueCompetition();
    const total = l.weeks.length;

    $("league-badge").src = `./img/${c.badge}`;
    $("league-name").textContent = `${c.name} · ${l.mode === "realistic" ? "Realistic" : "Classic"}`;
    $("league-team").textContent = teamData(l.team).name;
    const rank = leagueRank(l, l.team);
    const pos = $("league-pos");
    pos.textContent = l.played ? ordinal(rank) : "–";
    pos.className = `cup-pos ${leagueZone(l, rank)}`;
    $("league-stage").textContent = l.stage === "done"
        ? (l.champion === l.team ? "Champions!" : `Season over · ${teamData(l.champion).name} are champions`)
        : `Week ${Math.min(l.played + 1, total)} of ${total}`;

    const next = leagueNext(l);
    const nextBox = $("league-next");
    const play = $("league-play");
    nextBox.innerHTML = "";
    const busy = gameState !== "idle" && gameState !== "ended";
    play.disabled = busy;
    if (next) {
        nextBox.hidden = false;
        nextBox.appendChild(leagueNextRow(next));
        play.textContent = busy ? "Live" : `Play · Week ${next.week}`;
    } else if (l.stage === "done") {
        nextBox.hidden = true;
        play.textContent = "New season";
    } else {
        nextBox.hidden = false;
        nextBox.innerHTML = `<p class="cup-note">No match for you this week. Simulate the round to move on.</p>`;
        play.textContent = `Simulate · Week ${l.played + 1}`;
    }
    $("league-share-row").hidden = l.stage !== "done";
    $("league-share-btn").hidden = !canShareFiles();

    renderLeagueWeek();
    renderLeagueTable();
    renderMode();
}

// Üst 4 yeşil, son 3 kırmızı (kaba bir Avrupa / küme hattı)
function leagueZone(l, rank) {
    if (rank <= 4) return "zone-direct";
    if (rank > l.teams.length - 3) return "zone-out";
    return "";
}

function leagueNextRow(next) {
    const row = document.createElement("div");
    row.className = "cup-match";
    const home = next.home === league.team;
    const opponent = home ? next.away : next.home;
    row.innerHTML = `<span class="cup-match-label">Next · Week ${next.week}</span>`;
    const teams = document.createElement("div");
    teams.className = "cup-match-teams";
    for (const [id, isHome] of [[next.home, true], [next.away, false]]) {
        const side = document.createElement("span");
        side.className = `cup-side ${id === league.team ? "me" : ""}`;
        side.appendChild(teamBadge(id, "badge-sm"));
        const name = document.createElement("span");
        name.textContent = teamData(id).name;
        side.appendChild(name);
        teams.appendChild(side);
        if (isHome) {
            const vs = document.createElement("span");
            vs.className = "vs";
            vs.textContent = "vs";
            teams.appendChild(vs);
        }
    }
    row.appendChild(teams);
    const info = document.createElement("span");
    info.className = "cup-match-meta";
    const rating = league.mode === "realistic" && teamRating(opponent);
    info.textContent = `${home ? "Home" : "Away"}${rating ? ` · Elo ${rating.elo}` : ""}`;
    row.appendChild(info);
    return row;
}

// Haftalık fikstür: ‹ Week 8 › ; sonuçlar ya da "vs", kullanıcının maçı vurgulu
function renderLeagueWeek() {
    const l = league;
    leagueWeekView = Math.max(0, Math.min(l.weeks.length - 1, leagueWeekView));
    $("league-week-label").textContent = `Week ${leagueWeekView + 1}${leagueWeekView === l.played && l.stage !== "done" ? " · now" : ""}`;
    $("league-week-prev").disabled = leagueWeekView === 0;
    $("league-week-next").disabled = leagueWeekView === l.weeks.length - 1;
    const box = $("league-week");
    box.innerHTML = "";
    for (const m of l.weeks[leagueWeekView]) {
        const row = document.createElement("div");
        row.className = `week-match${m.home === l.team || m.away === l.team ? " me" : ""}`;
        const home = document.createElement("span");
        home.className = "week-side";
        home.appendChild(teamBadge(m.home, "badge-xxs"));
        const homeName = document.createElement("span");
        homeName.className = "cup-name";
        homeName.textContent = teamData(m.home).name;
        home.appendChild(homeName);
        const score = document.createElement("span");
        score.className = `week-score${m.score ? "" : " pending"}`;
        score.textContent = m.score ? `${m.score[0]} - ${m.score[1]}` : "vs";
        const away = document.createElement("span");
        away.className = "week-side away";
        const awayName = document.createElement("span");
        awayName.className = "cup-name";
        awayName.textContent = teamData(m.away).name;
        away.appendChild(awayName);
        away.appendChild(teamBadge(m.away, "badge-xxs"));
        row.append(home, score, away);
        box.appendChild(row);
    }
}

function renderLeagueTable() {
    const l = league;
    const table = $("league-table");
    table.innerHTML = `<div class="cup-row cup-row-head"><span></span><span></span><span class="cup-name">Club</span><span class="cup-num">P</span><span class="cup-num">GD</span><span class="cup-num">Pts</span></div>`;
    leagueTable(l).forEach((row, i) => {
        const rank = i + 1;
        const line = document.createElement("div");
        line.className = `cup-row ${leagueZone(l, rank)}${row.id === l.team ? " me" : ""}`;
        const number = document.createElement("span");
        number.className = "cup-rank";
        number.textContent = rank;
        line.appendChild(number);
        line.appendChild(teamBadge(row.id, "badge-xxs"));
        const name = document.createElement("span");
        name.className = "cup-name";
        name.textContent = teamData(row.id).name;
        line.appendChild(name);
        for (const value of [row.played, row.gd > 0 ? `+${row.gd}` : row.gd, row.points]) {
            const cell = document.createElement("span");
            cell.className = "cup-num";
            cell.textContent = value;
            line.appendChild(cell);
        }
        table.appendChild(line);
    });
    $("league-table-count").textContent = l.played ? `Week ${l.played}` : "";
}

// ---------- Akış ----------

function playLeague() {
    if (!league) return;
    if (gameState !== "idle" && gameState !== "ended") return;
    if (league.stage === "done") {
        league = null;
        saveLeague();
        renderMode();
        renderLeague();
        return;
    }
    const simulate = (home, away) => simulateMatch(home, away, league.mode).score;
    const hadMatch = !!leagueNext(league);
    leagueSimulateWeek(league, simulate);
    saveLeague();
    leagueWeekView = Math.min(league.played, league.weeks.length - 1);
    renderLeague();
    if (!hadMatch) return; // bay haftası simüle edildi; maç bir sonraki dokunuşta
    const next = leagueNext(league);
    if (!next) return;

    leagueMatch = { label: `Week ${next.week}` };
    const c = leagueCompetition();
    activeCompetition = c;
    setFieldTheme(c);
    Sound.unlock();
    closeSheet($("result"));
    startGame(next.home, next.away, league.mode);
    renderLeague();
    const stage = $("stage").getBoundingClientRect();
    if (stage.top < 0 || stage.bottom > window.innerHeight) $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

function leagueSubtitle() {
    return leagueMatch ? `${leagueCompetition().name} · ${leagueMatch.label}` : null;
}

// Maç bittiğinde (ui.js çağırır). Lig maçıysa işler ve true döner.
function onLeagueMatchEnded() {
    if (!leagueMatch || !league) return false;
    const note = $("result-note");
    $("rematch-btn").hidden = true;
    const l = league;
    const outcome = leagueRecord(l, score);
    leagueMatch = null;
    saveLeague();
    leagueWeekView = Math.min(l.played, l.weeks.length - 1);
    renderMode();
    renderLeague();
    const rank = leagueRank(l, l.team);
    let text = "";
    if (l.stage === "done") {
        text = l.champion === l.team ? "CHAMPIONS!" : `Season over · finished ${ordinal(rank)}`;
        $("league-table-section").open = true;
    } else if (outcome) {
        const gap = leagueTable(l)[0].points - leagueTable(l).find(r => r.id === l.team).points;
        text = `Week ${outcome.week} done · ${ordinal(rank)}${rank === 1 ? ", top of the table" : gap ? `, ${gap} pt${gap > 1 ? "s" : ""} off the top` : ""}`;
    }
    note.classList.remove("muted");
    note.textContent = text;
    note.hidden = !text;
    return true;
}

// ---------- Sezon özeti kartı ----------

function leagueHeadline(l) {
    const rank = leagueRank(l, l.team);
    if (l.champion === l.team) return "CHAMPIONS!";
    if (rank === 2) return "Runners-up";
    return `Finished ${ordinal(rank)}`;
}

function leaguePathItems(l) {
    const items = [];
    l.weeks.forEach((week, i) => {
        const m = week.find(x => x.home === l.team || x.away === l.team);
        if (!m || !m.score) return;
        const home = m.home === l.team;
        items.push({ label: `W${i + 1}`, opponent: teamData(home ? m.away : m.home).name, home, mine: home ? m.score[0] : m.score[1], theirs: home ? m.score[1] : m.score[0], pens: "" });
    });
    return items;
}

async function buildLeagueCard(l) {
    const row = leagueTable(l).find(r => r.id === l.team);
    return buildRunCard({
        title: leagueCompetition().name.replace("Trendyol ", "").toUpperCase(),
        subtitle: `${l.mode === "realistic" ? "Realistic" : "Classic"} mode${l.champion ? ` · Champions: ${teamData(l.champion).name}` : ""}`,
        teamId: l.team,
        headline: leagueHeadline(l),
        gold: l.champion === l.team,
        line: `${row.points} pts · ${row.won}W ${row.drawn}D ${row.lost}L · Goals ${row.gf}-${row.ga}`,
        items: leaguePathItems(l)
    });
}

function leagueFileName() {
    return `rotascore-${league.competition}-${league.team}-season.png`.replace(/[^a-z0-9.-]/gi, "");
}

async function shareLeague() {
    if (!league) return;
    const blob = await buildLeagueCard(league);
    try {
        await navigator.share({ files: [new File([blob], leagueFileName(), { type: "image/png" })] });
    } catch (error) {
        // iptal
    }
}

async function downloadLeague() {
    if (!league) return;
    const blob = await buildLeagueCard(league);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = leagueFileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- Olaylar ----------

$("league-select").addEventListener("change", event => {
    leagueSetup.competition = event.target.value;
    renderLeagueSetup();
});
$("pick-league-team").addEventListener("click", () => openPicker("league"));
$("league-start").addEventListener("click", startLeague);
$("league-play").addEventListener("click", playLeague);
$("league-quit").addEventListener("click", abandonLeague);
$("league-week-prev").addEventListener("click", () => { leagueWeekView--; renderLeagueWeek(); });
$("league-week-next").addEventListener("click", () => { leagueWeekView++; renderLeagueWeek(); });
$("league-share-btn").addEventListener("click", shareLeague);
$("league-download-btn").addEventListener("click", downloadLeague);
$("tab-league").addEventListener("click", () => showTab("league", true));
