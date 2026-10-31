// Turnuva sekmesi: kurulum, kura, maç aralarında puan durumu ve eleme ağacı, kaldığı yerden devam.
// Turnuva verisi tournament.js'te (saf mantık), maçlar script.js motorunda oynanır.

const TOURNAMENT_KEY = "rotascore-tournament";
const CUPS = ["ucl", "uel", "uecl"];
const CUP_SHORT = { ucl: "Champions", uel: "Europa", uecl: "Conference" };
const ROUND_SHORT = { playoffs: "PO", r16: "R16", qf: "QF", sf: "SF", final: "Final" };

let tournament = null;                                 // aktif turnuva (localStorage'da saklanır)
let cupSetup = { competition: "uecl", team: null };    // kurulum ekranındaki seçim
let tournamentMatch = null;                            // şu an canlı oynanan turnuva maçı: { label }
let abandonArmed = 0;

function cupCompetition() {
    const id = tournament ? tournament.competition : cupSetup.competition;
    return competitions.find(c => c.id === id);
}

function loadTournament() {
    try {
        tournament = JSON.parse(localStorage.getItem(TOURNAMENT_KEY));
    } catch (error) {
        tournament = null;
    }
    if (tournament && tournament.version !== 1) tournament = null;
    // Turnuva sürerken mod turnuvanınkine kilitli
    if (tournamentActive()) {
        selection.mode = tournament.mode;
        saveSelection();
    }
}

function saveTournament() {
    try {
        if (tournament) localStorage.setItem(TOURNAMENT_KEY, JSON.stringify(tournament));
        else localStorage.removeItem(TOURNAMENT_KEY);
    } catch (error) {
        // yoksay
    }
}

function tournamentActive() {
    return !!tournament && tournament.stage !== "done";
}

// Mod, maç sürerken ve turnuva boyunca değiştirilemez
function modeLocked() {
    return tournamentActive() || (gameState !== "idle" && gameState !== "ended");
}

function ordinal(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------- Kurulum ----------

function renderCupSetup() {
    for (const option of document.querySelectorAll(".mode-option[data-cup]")) {
        option.setAttribute("aria-checked", String(option.dataset.cup === cupSetup.competition));
    }
    const button = $("pick-cup-team");
    button.innerHTML = "";
    const id = cupSetup.team;
    if (id && cupCompetition().teams.includes(id)) {
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
        cupSetup.team = null;
        button.innerHTML = `<span class="pick-text"><small>Your team</small><strong>Choose a club</strong></span>`;
    }
    $("tournament-start").disabled = !cupSetup.team;
    $("cup-setup-note").textContent = `${cupCompetition().name} · 36 clubs · ${selection.mode === "realistic" ? "Realistic" : "Classic"} mode. The mode is locked once the draw is made.`;
}

function startTournament() {
    if (!cupSetup.team) return;
    const cup = cupCompetition();
    const clubRatings = {};
    const countries = {};
    for (const id of cup.teams) {
        const rating = teamRating(id);
        clubRatings[id] = rating ? rating.elo : null;
        countries[id] = teamData(id).country || null;
    }
    try {
        tournament = createTournament(cup.id, cupSetup.team, { teams: cup.teams, ratings: clubRatings, countries, mode: selection.mode });
    } catch (error) {
        $("cup-setup-note").textContent = `Could not draw the tournament: ${error.message}`;
        return;
    }
    saveTournament();
    renderMode();
    renderTournament();
    // Kurayı göster
    $("cup-path-section").open = true;
    $("cup-table-section").open = false;
}

function abandonTournament() {
    // Yanlışlıkla silinmesin: iki dokunuş
    if (Date.now() - abandonArmed > 4000) {
        abandonArmed = Date.now();
        $("tournament-quit").textContent = "Tap again to abandon";
        setTimeout(() => { $("tournament-quit").textContent = "Abandon tournament"; }, 4000);
        return;
    }
    tournament = null;
    tournamentMatch = null;
    saveTournament();
    renderMode();
    renderTournament();
}

// ---------- Aktif turnuva ----------

function matchLabel(next) {
    if (next.stage === "league") return `Matchday ${next.matchday}`;
    const round = ROUND_NAMES[next.stage];
    if (next.stage === "final") return round;
    return `${round} · ${next.leg === 1 ? "1st" : "2nd"} leg`;
}

function stageText(t) {
    const summary = tournamentSummary(t);
    if (t.stage === "done") return summary.champion === t.team ? "Champions!" : `Finished · ${teamData(summary.champion).name} are champions`;
    if (t.stage === "league") return `League phase · Matchday ${Math.min(t.league.played + 1, t.league.matchdays.length)} of ${t.league.matchdays.length}`;
    return ROUND_NAMES[t.stage];
}

function userOutText(t) {
    if (!t.userOut) return "";
    if (t.userOut === "league") return `Eliminated · finished ${ordinal(leaguePosition(t, t.team))} in the league phase`;
    const tie = tieOf(t, t.userOut, t.team);
    const other = tie.seed === t.team ? tie.other : tie.seed;
    const agg = tie.seed === t.team ? tie.aggregate : [tie.aggregate[1], tie.aggregate[0]];
    const pens = tie.penalties ? ` · ${tie.seed === t.team ? tie.penalties.join("-") : tie.penalties.slice().reverse().join("-")} on penalties` : "";
    return `${t.userOut === "final" ? "Runners-up" : `Out in the ${ROUND_NAMES[t.userOut].toLowerCase()}`} · ${agg[0]}-${agg[1]} vs ${teamData(other).name}${pens}`;
}

function renderTournament() {
    const setup = $("tournament-setup");
    const live = $("tournament-live");
    setup.hidden = !!tournament;
    live.hidden = !tournament;
    if (!tournament) {
        renderCupSetup();
        return;
    }
    const t = tournament;
    const cup = cupCompetition();

    $("cup-badge").src = `./img/${cup.badge}`;
    $("cup-name").textContent = `${cup.name} · ${t.mode === "realistic" ? "Realistic" : "Classic"}`;
    $("cup-team").textContent = teamData(t.team).name;
    const position = leaguePosition(t, t.team);
    $("cup-pos").textContent = t.league.played ? ordinal(position) : "–";
    $("cup-pos").className = `cup-pos ${position <= 8 ? "zone-direct" : position <= 24 ? "zone-playoff" : "zone-out"}`;
    $("cup-stage").textContent = stageText(t);

    // Sıradaki maç ve düğme
    const next = nextUserMatch(t);
    const nextBox = $("cup-next");
    const play = $("tournament-play");
    const out = $("cup-out");
    out.hidden = !t.userOut;
    out.textContent = userOutText(t);
    nextBox.innerHTML = "";
    const busy = gameState !== "idle" && gameState !== "ended";
    play.disabled = busy;
    if (next) {
        nextBox.hidden = false;
        nextBox.appendChild(nextMatchRow(next));
        play.textContent = busy ? "Live" : `Play · ${matchLabel(next)}`;
    } else if (t.stage === "done") {
        nextBox.hidden = true;
        play.textContent = "New tournament";
    } else if (t.userOut) {
        nextBox.hidden = true;
        play.textContent = "Simulate the rest";
    } else {
        // İlk 8'e girdi: play-off oynamıyor
        nextBox.hidden = false;
        nextBox.innerHTML = `<p class="cup-note">Straight into the round of 16. Simulate the play-offs to meet your opponent.</p>`;
        play.textContent = "Simulate play-offs";
    }

    renderCupTable(t);
    renderBracket(t);
    renderPath(t);
    $("cup-table-count").textContent = t.league.played ? `MD ${t.league.played}` : "";
    $("cup-bracket-section").hidden = t.stage === "league";
    renderMode(); // kilit durumu turnuvayla birlikte değişir
}

function nextMatchRow(next) {
    const row = document.createElement("div");
    row.className = "cup-match";
    const home = next.home === tournament.team;
    const opponent = home ? next.away : next.home;
    const meta = [home ? "Home" : "Away"];
    if (next.tie && next.leg === 2) {
        const first = next.tie.legs[0];
        const mine = first.home === tournament.team ? first.score[0] : first.score[1];
        const theirs = first.home === tournament.team ? first.score[1] : first.score[0];
        meta.push(`1st leg ${mine}-${theirs}`);
    }
    if (next.stage === "final") meta[0] = "Final";
    row.innerHTML = `<span class="cup-match-label">Next · ${matchLabel(next)}</span>`;
    const teams = document.createElement("div");
    teams.className = "cup-match-teams";
    for (const [id, isHome] of [[next.home, true], [next.away, false]]) {
        const side = document.createElement("span");
        side.className = `cup-side ${id === tournament.team ? "me" : ""}`;
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
    info.textContent = `${meta.join(" · ")}${opponent && teamRating(opponent) && tournament.mode === "realistic" ? ` · Elo ${teamRating(opponent).elo}` : ""}`;
    row.appendChild(info);
    return row;
}

function renderCupTable(t) {
    const table = $("cup-table");
    table.innerHTML = `<div class="cup-row cup-row-head"><span></span><span></span><span class="cup-name">Club</span><span class="cup-num">P</span><span class="cup-num">GD</span><span class="cup-num">Pts</span></div>`;
    standings(t).forEach((row, i) => {
        const rank = i + 1;
        const line = document.createElement("div");
        line.className = `cup-row ${rank <= 8 ? "zone-direct" : rank <= 24 ? "zone-playoff" : "zone-out"}${row.id === t.team ? " me" : ""}`;
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
}

function renderBracket(t) {
    const box = $("cup-bracket");
    box.innerHTML = "";
    for (const round of KNOCKOUT_ROUNDS) {
        const ties = t.rounds[round];
        if (!ties) continue;
        const heading = document.createElement("h3");
        heading.className = "cup-round";
        heading.textContent = ROUND_NAMES[round];
        box.appendChild(heading);
        for (const tie of ties) box.appendChild(tieRow(t, tie));
    }
}

function tieRow(t, tie) {
    const row = document.createElement("div");
    row.className = `cup-tie${[tie.seed, tie.other].includes(t.team) ? " me" : ""}`;
    for (const id of [tie.seed, tie.other]) {
        const side = document.createElement("div");
        side.className = `cup-tie-side${tie.winner === id ? " winner" : tie.winner ? " loser" : ""}`;
        side.appendChild(teamBadge(id, "badge-xxs"));
        const name = document.createElement("span");
        name.className = "cup-name";
        name.textContent = teamData(id).name;
        side.appendChild(name);
        const legs = document.createElement("span");
        legs.className = "cup-legs";
        legs.textContent = tie.legs.map(leg => leg.score ? (leg.home === id ? leg.score[0] : leg.score[1]) : "–").join("  ");
        side.appendChild(legs);
        const agg = document.createElement("span");
        agg.className = "cup-agg";
        agg.textContent = tie.aggregate ? tie.aggregate[id === tie.seed ? 0 : 1] : "";
        side.appendChild(agg);
        row.appendChild(side);
    }
    if (tie.penalties) {
        const pens = document.createElement("span");
        pens.className = "cup-pens";
        pens.textContent = `${teamData(tie.winner).name} win ${Math.max(...tie.penalties)}-${Math.min(...tie.penalties)} on penalties`;
        row.appendChild(pens);
    }
    return row;
}

// Kullanıcının yolu: lig maçları (kura) ve eleme maçları
function renderPath(t) {
    const box = $("cup-path");
    box.innerHTML = "";
    const items = [];
    t.league.matchdays.forEach((round, i) => {
        const m = round.find(x => x.home === t.team || x.away === t.team);
        if (m) items.push({ label: `MD ${i + 1}`, match: m });
    });
    for (const round of KNOCKOUT_ROUNDS) {
        const tie = tieOf(t, round, t.team);
        if (!tie) continue;
        tie.legs.forEach((leg, i) => items.push({ label: round === "final" ? "Final" : `${ROUND_SHORT[round]} ${i === 0 ? "1st" : "2nd"} leg`, match: leg, tie }));
    }
    for (const { label, match } of items) {
        const home = match.home === t.team;
        const opponent = home ? match.away : match.home;
        const row = document.createElement("div");
        row.className = "cup-path-row";
        const tag = document.createElement("span");
        tag.className = "cup-path-label";
        tag.textContent = label;
        row.appendChild(tag);
        row.appendChild(teamBadge(opponent, "badge-xxs"));
        const name = document.createElement("span");
        name.className = "cup-name";
        name.textContent = `${teamData(opponent).name} (${home ? "H" : "A"})`;
        row.appendChild(name);
        const result = document.createElement("span");
        result.className = "cup-path-score";
        if (match.score) {
            const mine = home ? match.score[0] : match.score[1];
            const theirs = home ? match.score[1] : match.score[0];
            result.textContent = `${mine}-${theirs}`;
            result.classList.add(mine > theirs ? "win" : mine < theirs ? "loss" : "draw");
        } else {
            result.textContent = "–";
        }
        row.appendChild(result);
        box.appendChild(row);
    }
}

// ---------- Akış ----------

function playTournament() {
    if (!tournament) return;
    if (gameState !== "idle" && gameState !== "ended") return;
    if (tournament.stage === "done") {
        tournament = null;
        saveTournament();
        renderMode();
        renderTournament();
        return;
    }
    // Diğer sahalardaki maçlar anında oynanır
    simulateUntilUser(tournament, (home, away) => simulateMatch(home, away, tournament.mode).score);
    saveTournament();
    const next = nextUserMatch(tournament);
    renderTournament();
    if (!next) return;

    tournamentMatch = { label: matchLabel(next) };
    const cup = cupCompetition();
    activeCompetition = cup;
    setFieldTheme(cup);
    Sound.unlock();
    closeSheet($("result"));
    startGame(next.home, next.away, tournament.mode);
    renderTournament();
    const stage = $("stage").getBoundingClientRect();
    if (stage.top < 0 || stage.bottom > window.innerHeight) $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Sonuç kartının alt başlığı: turnuva maçında turnuva ve tur adı
function tournamentSubtitle() {
    return tournamentMatch ? `${cupCompetition().name} · ${tournamentMatch.label}` : null;
}

// Maç bittiğinde (ui.js çağırır): sonucu işle, kullanıcıya ne olduğunu söyle
function onTournamentMatchEnded() {
    const note = $("result-note");
    $("rematch-btn").hidden = !!tournamentMatch;
    if (!tournamentMatch || !tournament) {
        note.hidden = true;
        return;
    }
    const t = tournament;
    const outcome = recordUserResult(t, score);
    tournamentMatch = null;
    saveTournament();
    renderMode();
    renderTournament();

    let text = "";
    if (outcome && outcome.stage === "league") {
        const position = leaguePosition(t, t.team);
        text = t.league.played < t.league.matchdays.length
            ? `Matchday ${t.league.played} done · ${ordinal(position)} in the league phase`
            : position <= 8 ? `League phase over · ${ordinal(position)}, straight into the round of 16`
            : position <= 24 ? `League phase over · ${ordinal(position)}, into the knock-out play-offs`
            : `League phase over · ${ordinal(position)}, eliminated`;
    } else if (outcome && outcome.tie) {
        const tie = outcome.tie;
        if (!tie.winner) {
            text = "First leg played · the second leg decides";
        } else if (t.stage === "done") {
            text = t.champion === t.team ? "CHAMPIONS!" : "Runners-up · so close";
        } else if (tie.winner === t.team) {
            const pens = tie.penalties ? ` · won ${Math.max(...tie.penalties)}-${Math.min(...tie.penalties)} on penalties` : "";
            text = `Through to the ${ROUND_NAMES[t.stage].toLowerCase()} · aggregate ${tie.aggregate[tie.seed === t.team ? 0 : 1]}-${tie.aggregate[tie.seed === t.team ? 1 : 0]}${pens}`;
        } else {
            text = userOutText(t);
        }
    }
    note.textContent = text;
    note.hidden = !text;
}

// ---------- Olaylar ----------

for (const option of document.querySelectorAll(".mode-option[data-cup]")) {
    option.addEventListener("click", () => {
        cupSetup.competition = option.dataset.cup;
        renderCupSetup();
    });
}
$("pick-cup-team").addEventListener("click", () => openPicker("cup"));
$("tournament-start").addEventListener("click", startTournament);
$("tournament-play").addEventListener("click", playTournament);
$("tournament-quit").addEventListener("click", abandonTournament);
$("tab-tournament").addEventListener("click", () => showTab("tournament", true));
