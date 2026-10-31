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
let drawReveal = null;                                 // kura açıklanırken: { count, timer }
const DRAW_REVEAL_MS = 420;                            // rakipler bu aralıkla tek tek görünür

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
    // Kura açıklanır: rakipler sırayla gelir, bitene kadar maç başlatılamaz
    const count = t => t.league.matchdays.length;
    Sound.unlock();
    drawReveal = { count: count(tournament) };
    for (let i = 0; i < drawReveal.count; i++) setTimeout(() => Sound.tick(3), i * DRAW_REVEAL_MS + 200);
    drawReveal.timer = setTimeout(() => {
        drawReveal = null;
        renderTournament();
    }, drawReveal.count * DRAW_REVEAL_MS + 500);
    renderTournament();
    $("cup-path-section").open = true;
    $("cup-table-section").open = false;
    $("cup-path-section").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    if (drawReveal) clearTimeout(drawReveal.timer);
    drawReveal = null;
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
    play.disabled = busy || !!drawReveal;
    if (next) {
        nextBox.hidden = !!drawReveal;
        nextBox.appendChild(nextMatchRow(next));
        play.textContent = drawReveal ? "Drawing…" : busy ? "Live" : `Play · ${matchLabel(next)}`;
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

    // Takımın turnuvası bittiyse (elendi ya da turnuva tamamlandı) özet kartı paylaşılabilir
    $("cup-share-row").hidden = !(t.userOut || t.stage === "done");
    $("cup-share-btn").hidden = !canShareFiles();
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

// Lig aşaması bitince eleme ağacı açık, tablo kapalı gelsin
function openKnockoutView() {
    $("cup-bracket-section").open = true;
    $("cup-table-section").open = false;
    $("cup-path-section").open = false;
}

// Finale en yakın tur en üstte
function renderBracket(t) {
    const box = $("cup-bracket");
    box.innerHTML = "";
    for (const round of KNOCKOUT_ROUNDS.slice().reverse()) {
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
    items.forEach(({ label, match }, index) => {
        const home = match.home === t.team;
        const opponent = home ? match.away : match.home;
        const row = document.createElement("div");
        row.className = "cup-path-row";
        if (drawReveal) {
            row.classList.add("cup-reveal");
            row.style.animationDelay = `${index * DRAW_REVEAL_MS}ms`;
        }
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
    });
}

// ---------- Akış ----------

function playTournament() {
    if (!tournament || drawReveal) return;
    if (gameState !== "idle" && gameState !== "ended") return;
    if (tournament.stage === "done") {
        tournament = null;
        saveTournament();
        renderMode();
        renderTournament();
        return;
    }
    // Kullanıcının oynayacağı maç yoksa (ilk 8'de play-off'u atlıyor ya da elendi) sadece simüle et;
    // maç kullanıcı bir daha dokununca başlar, arada sonuçlar incelenebilir
    const stageBefore = tournament.stage;
    const hadMatch = !!nextUserMatch(tournament);
    // Diğer sahalardaki maçlar anında oynanır
    simulateUntilUser(tournament, (home, away) => simulateMatch(home, away, tournament.mode).score);
    saveTournament();
    if (tournament.stage !== stageBefore) openKnockoutView();
    renderTournament();
    if (!hadMatch) return;
    const next = nextUserMatch(tournament);
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

// Motor maç sonunda sorar: eleme turunun son maçı bitti ve toplam skor eşit mi? Öyleyse penaltılar oynanır.
function shootoutNeeded() {
    if (!tournamentMatch || !tournament) return false;
    const next = nextUserMatch(tournament);
    if (!next || !next.tie) return false;
    const legs = next.tie.legs;
    if (next.leg !== legs.length) return false; // ilk maçta penaltı yok
    let mine = score[team1.id === tournament.team ? 0 : 1];
    let theirs = score[team1.id === tournament.team ? 1 : 0];
    if (legs.length === 2) {
        const first = legs[0];
        mine += first.home === tournament.team ? first.score[0] : first.score[1];
        theirs += first.home === tournament.team ? first.score[1] : first.score[0];
    }
    return mine === theirs;
}

// Sonuç kartının alt başlığı: turnuva maçında turnuva ve tur adı;
// turnuva sürerken oynanan hazırlık maçında lig adının yanına "Friendly" (turnuva maçıyla karışmasın)
function tournamentSubtitle() {
    if (tournamentMatch) return `${cupCompetition().name} · ${tournamentMatch.label}`;
    if (tournamentActive() && activeCompetition) return `${activeCompetition.name} · Friendly${matchMode === "realistic" ? " · Realistic" : ""}`;
    return null;
}

// Maç bittiğinde (ui.js çağırır): sonucu işle, kullanıcıya ne olduğunu söyle
function onTournamentMatchEnded() {
    const note = $("result-note");
    $("rematch-btn").hidden = !!tournamentMatch;
    if (!tournamentMatch || !tournament) {
        const friendly = tournamentActive();
        note.textContent = friendly ? "Friendly · your tournament is not affected" : "";
        note.classList.toggle("muted", friendly);
        note.hidden = !friendly;
        return;
    }
    note.classList.remove("muted");
    const t = tournament;
    const stageBefore = t.stage;
    const outcome = recordUserResult(t, score, shootoutResult);
    tournamentMatch = null;
    saveTournament();
    renderMode();
    if (stageBefore === "league" && t.stage !== "league") openKnockoutView();
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

// ---------- Turnuva özeti kartı ----------

function cupHeadline(t) {
    if (t.champion === t.team) return "CHAMPIONS!";
    if (t.userOut === "final") return "Runners-up";
    if (t.userOut === "sf") return "Semi-finalists";
    if (t.userOut === "qf") return "Quarter-finalists";
    if (t.userOut === "r16") return "Out in the round of 16";
    if (t.userOut === "playoffs") return "Out in the play-offs";
    if (t.userOut === "league") return `Out in the league phase · ${ordinal(leaguePosition(t, t.team))}`;
    return "In progress";
}

// Kullanıcının oynanmış bütün maçları: { label, opponent, home, mine, theirs, pens }
function cupPathItems(t) {
    const items = [];
    t.league.matchdays.forEach((round, i) => {
        const m = round.find(x => x.home === t.team || x.away === t.team);
        if (m && m.score) items.push({ label: `MD${i + 1}`, match: m });
    });
    for (const round of KNOCKOUT_ROUNDS) {
        const tie = tieOf(t, round, t.team);
        if (!tie) continue;
        tie.legs.forEach((leg, i) => {
            if (!leg.score) return;
            const label = round === "final" ? "Final" : `${ROUND_SHORT[round]} ${tie.legs.length > 1 ? (i === 0 ? "L1" : "L2") : ""}`.trim();
            items.push({ label, match: leg, tie, lastLeg: i === tie.legs.length - 1 });
        });
    }
    return items.map(({ label, match, tie, lastLeg }) => {
        const home = match.home === t.team;
        const mine = home ? match.score[0] : match.score[1];
        const theirs = home ? match.score[1] : match.score[0];
        const pens = tie && lastLeg && tie.penalties ? ` (${tie.seed === t.team ? tie.penalties.join("-") : tie.penalties.slice().reverse().join("-")} p)` : "";
        return { label, opponent: teamData(home ? match.away : match.home).name, home, mine, theirs, pens };
    });
}

async function buildTournamentCard(t) {
    const size = 1080;
    const card = document.createElement("canvas");
    card.width = size;
    card.height = size;
    const c = card.getContext("2d");
    try {
        await document.fonts.load("800 100px Inter");
    } catch (error) {
        // Arial ile devam
    }
    const cup = cupCompetition();
    const colors = teamData(t.team).colors;

    const bg = c.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, "#0b1220");
    bg.addColorStop(1, "#123b22");
    c.fillStyle = bg;
    c.fillRect(0, 0, size, size);
    for (const [index, x] of [[0, 0], [1, size]]) {
        const glow = c.createRadialGradient(x, 360, 0, x, 360, 560);
        glow.addColorStop(0, `${colors[index]}55`);
        glow.addColorStop(1, `${colors[index]}00`);
        c.fillStyle = glow;
        c.fillRect(0, 0, size, size);
    }
    c.textAlign = "center";
    c.textBaseline = "middle";

    // Başlık: turnuva adı ve mod
    c.fillStyle = "#6AD04A";
    c.font = "800 34px Inter, Arial, sans-serif";
    c.fillText(cup.name.replace("UEFA ", "").toUpperCase(), size / 2, 84);
    c.fillStyle = "rgba(255, 255, 255, 0.7)";
    c.font = "600 28px Inter, Arial, sans-serif";
    c.fillText(`${t.mode === "realistic" ? "Realistic" : "Classic"} mode${t.champion ? ` · Champions: ${teamData(t.champion).name}` : ""}`, size / 2, 128);

    // Takım
    await drawCardBadge(c, { id: t.team, isFlag: false }, size / 2, 300, 120);
    c.fillStyle = "#FFFFFF";
    fitFont(c, teamData(t.team).name, 800, 56, 800);
    c.fillText(teamData(t.team).name, size / 2, 468);

    // Sonuç
    const headline = cupHeadline(t);
    c.fillStyle = t.champion === t.team ? "#FFD84A" : "#6AD04A";
    fitFont(c, headline, 900, 72, 800);
    c.fillText(headline, size / 2, 548);
    const table = standings(t).find(row => row.id === t.team);
    c.fillStyle = "rgba(255, 255, 255, 0.7)";
    c.font = "600 28px Inter, Arial, sans-serif";
    c.fillText(`League phase ${ordinal(leaguePosition(t, t.team))} · ${table.won}W ${table.drawn}D ${table.lost}L · ${table.gf}-${table.ga}`, size / 2, 604);

    // Yol: tek ya da iki sütun
    const items = cupPathItems(t);
    const columns = items.length > 8 ? 2 : 1;
    const perColumn = Math.ceil(items.length / columns);
    const colWidth = (size - 180) / columns;
    // En uzun yol 17 maç (play-off'tan finale): satırlar alt bilgiye taşmasın diye aralık daralır
    const rowHeight = Math.min(36, Math.floor(256 / Math.max(1, perColumn - 1)));
    items.forEach((item, i) => {
        const col = Math.floor(i / perColumn);
        const x = 90 + col * colWidth;
        const y = 668 + (i % perColumn) * rowHeight;
        c.textAlign = "left";
        c.fillStyle = "rgba(255, 255, 255, 0.55)";
        c.font = "700 20px Inter, Arial, sans-serif";
        c.fillText(item.label, x, y);
        c.fillStyle = "#FFFFFF";
        const nameSize = columns === 2 ? 22 : 24;
        c.font = `600 ${nameSize}px Inter, Arial, sans-serif`;
        // Skor sağda (penaltılıysa daha geniş), isim kalan yere sığmazsa kırpılır
        const scoreText = `${item.mine}-${item.theirs}${item.pens}`;
        c.font = `800 ${nameSize}px Inter, Arial, sans-serif`;
        const scoreWidth = c.measureText(scoreText).width;
        c.font = `600 ${nameSize}px Inter, Arial, sans-serif`;
        let label = `${item.opponent} (${item.home ? "H" : "A"})`;
        const maxName = colWidth - 80 - scoreWidth - 44;
        while (c.measureText(label).width > maxName && label.length > 4) label = `${label.slice(0, -2).trimEnd()}…`;
        c.fillText(label, x + 80, y);
        c.textAlign = "right";
        c.fillStyle = item.mine > item.theirs ? "#6AD04A" : item.mine < item.theirs ? "#FF7A7A" : "#E0B84A";
        c.font = `800 ${nameSize}px Inter, Arial, sans-serif`;
        c.fillText(scoreText, x + colWidth - 30, y);
    });

    // Alt bilgi
    const brand = new Image();
    brand.src = "./img/favicon.png";
    try {
        await brand.decode();
        c.drawImage(brand, 84, 952, 116, 116);
    } catch (error) {
        c.textAlign = "left";
        c.font = "800 30px Inter, Arial, sans-serif";
        c.fillStyle = "#6AD04A";
        c.fillText("RotaScore", 90, 1010);
    }
    c.font = "600 26px Inter, Arial, sans-serif";
    c.fillStyle = "rgba(255, 255, 255, 0.6)";
    c.textAlign = "right";
    c.fillText("cemeren.dev/rotascore", size - 90, 1010);
    return new Promise(resolve => card.toBlob(resolve, "image/png"));
}

function cupFileName() {
    return `rotascore-${tournament.competition}-${tournament.team}.png`.replace(/[^a-z0-9.-]/gi, "");
}

async function shareTournament() {
    if (!tournament) return;
    const blob = await buildTournamentCard(tournament);
    try {
        await navigator.share({ files: [new File([blob], cupFileName(), { type: "image/png" })] });
    } catch (error) {
        // iptal
    }
}

async function downloadTournament() {
    if (!tournament) return;
    const blob = await buildTournamentCard(tournament);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = cupFileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- Olaylar ----------

$("cup-share-btn").addEventListener("click", shareTournament);
$("cup-download-btn").addEventListener("click", downloadTournament);

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
