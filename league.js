// Lig modu: bir ligin takımlarından biriyle tek devreli sezon (herkes herkesle bir kez).
// Ekrana ve motora dokunmaz; kaldığı yerden devam için localStorage'a yazılır, Node'da test edilir.
//
//   createLeague(competitionId, teamId, { teams, ratings, mode })
//   leagueTable(l)                   -> puan durumu (puan, averaj, atılan gol, galibiyet, Elo)
//   leagueRank(l, id)                -> takımın sırası (1'den başlar)
//   leagueNext(l)                    -> kullanıcının sıradaki maçı { week, home, away } (sezon bittiyse null)
//   leagueSimulateWeek(l, simulate)  -> bu haftanın diğer maçlarını oynatır
//   leagueRecord(l, score)           -> kullanıcının sonucunu işler, hafta bitince ilerler

// Fikstür: çember yöntemi. Takım sayısı tekse "bay" eklenir, o hafta o takım dinlenir.
// Ev sahibi: o ana kadar daha az evinde oynayan takım (iki devre olmadığı için herkes 8-9 ev maçı oynar).
function roundRobin(teams) {
    const list = teams.slice();
    if (list.length % 2) list.push(null);
    const n = list.length;
    const homes = Object.fromEntries(teams.map(id => [id, 0]));
    const weeks = [];
    for (let round = 0; round < n - 1; round++) {
        const week = [];
        for (let i = 0; i < n / 2; i++) {
            const a = list[i];
            const b = list[n - 1 - i];
            if (a === null || b === null) continue;
            const [home, away] = homes[a] <= homes[b] ? [a, b] : [b, a];
            homes[home]++;
            week.push({ home, away, score: null });
        }
        weeks.push(week);
        // İlk takım sabit, diğerleri bir kaydırılır
        list.splice(1, 0, list.pop());
    }
    return weeks;
}

function shuffleList(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function createLeague(competitionId, teamId, { teams, ratings, mode }) {
    if (!teams.includes(teamId)) throw new Error("Seçilen takım bu ligde değil");
    if (teams.length < 4) throw new Error("Lig için en az 4 takım gerekli");
    return {
        version: 1,
        competition: competitionId,
        team: teamId,
        mode: mode || "classic",
        createdAt: new Date().toISOString(),
        teams: teams.slice(),
        ratings: Object.fromEntries(teams.map(id => [id, (ratings && ratings[id]) || null])),
        weeks: roundRobin(shuffleList(teams)),
        played: 0,            // tamamlanan hafta sayısı
        stage: "season",      // season | done
        champion: null
    };
}

function leagueTable(l) {
    const rows = Object.fromEntries(l.teams.map(id => [id, { id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
    for (const week of l.weeks) {
        for (const m of week) {
            if (!m.score) continue;
            const [h, a] = m.score;
            const home = rows[m.home];
            const away = rows[m.away];
            home.played++; away.played++;
            home.gf += h; home.ga += a; away.gf += a; away.ga += h;
            if (h > a) { home.won++; away.lost++; home.points += 3; }
            else if (h < a) { away.won++; home.lost++; away.points += 3; }
            else { home.drawn++; away.drawn++; home.points++; away.points++; }
        }
    }
    for (const row of Object.values(rows)) row.gd = row.gf - row.ga;
    return Object.values(rows).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || b.won - a.won
        || (l.ratings[b.id] || 0) - (l.ratings[a.id] || 0) || a.id.localeCompare(b.id));
}

function leagueRank(l, id) {
    return leagueTable(l).findIndex(row => row.id === id) + 1;
}

function leagueWeekMatches(l, week) {
    return l.weeks[week] || [];
}

// Kullanıcının sıradaki maçı: bu haftada oynanmamış maçı (bay haftasında null değil, sonraki haftaya bakılmaz;
// bay haftası leagueSimulateWeek ile geçilir)
function leagueNext(l) {
    if (l.stage === "done") return null;
    const m = leagueWeekMatches(l, l.played).find(x => (x.home === l.team || x.away === l.team) && !x.score);
    return m ? { week: l.played + 1, home: m.home, away: m.away, match: m } : null;
}

function leagueUserHasMatchThisWeek(l) {
    return leagueWeekMatches(l, l.played).some(x => x.home === l.team || x.away === l.team);
}

function leagueAdvanceIfWeekDone(l) {
    if (l.stage === "done") return;
    if (leagueWeekMatches(l, l.played).some(m => !m.score)) return;
    l.played++;
    if (l.played >= l.weeks.length) {
        l.stage = "done";
        l.champion = leagueTable(l)[0].id;
    }
}

// Bu haftanın kullanıcıyı ilgilendirmeyen maçlarını oynat; kullanıcının bay haftasıysa haftayı bitir ve
// kullanıcının maçı olan haftaya kadar ilerle. simulate(homeId, awayId) -> [evGol, depGol]
function leagueSimulateWeek(l, simulate) {
    for (let guard = 0; guard < 100 && l.stage !== "done"; guard++) {
        for (const m of leagueWeekMatches(l, l.played)) {
            if (m.score || m.home === l.team || m.away === l.team) continue;
            m.score = simulate(m.home, m.away);
        }
        if (leagueUserHasMatchThisWeek(l)) return;
        leagueAdvanceIfWeekDone(l);
    }
}

// Sezon bitene kadar her şeyi oynat (kullanıcı sezonu bırakıp sonucu görmek isterse)
function leagueSimulateRest(l, simulate) {
    for (let guard = 0; guard < 100 && l.stage !== "done"; guard++) {
        for (const m of leagueWeekMatches(l, l.played)) if (!m.score) m.score = simulate(m.home, m.away);
        leagueAdvanceIfWeekDone(l);
    }
}

function leagueRecord(l, score) {
    const next = leagueNext(l);
    if (!next) return null;
    next.match.score = [score[0], score[1]];
    const week = l.played + 1;
    leagueAdvanceIfWeekDone(l);
    return { week, match: next.match };
}

if (typeof module !== "undefined") {
    module.exports = { roundRobin, createLeague, leagueTable, leagueRank, leagueNext, leagueSimulateWeek, leagueSimulateRest, leagueRecord, leagueWeekMatches };
}
