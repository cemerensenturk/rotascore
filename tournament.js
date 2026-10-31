// Turnuva modu: UEFA'nın 36 takımlı "lig aşaması + eleme" formatı (2024-25'ten itibaren).
// Bu dosya ekrana ve motora dokunmaz: kura, fikstür, puan durumu ve eleme ağacı saf veri olarak tutulur,
// böylece localStorage'a yazılıp kaldığı yerden devam edilebilir ve Node'da test edilebilir.
//
//   createTournament(competitionId, teamId, { teams, ratings, countries, mode })
//   nextUserMatch(t)                 -> kullanıcının sıradaki maçı (yoksa null)
//   simulateUntilUser(t, simulate)   -> kullanıcıyı ilgilendirmeyen maçları/turları oynatır
//   recordUserResult(t, score)       -> kullanıcının maç sonucunu işler, turu ilerletir
//   standings(t)                     -> lig aşaması puan durumu
//
// Format farkları (kuralların tamamı UEFA'nın resmi düzeniyle aynı):
//   Şampiyonlar Ligi / Avrupa Ligi: 4 torba x 9 takım, her torbadan 2 rakip (1 iç 1 dış), 8 maç
//   Konferans Ligi:                 6 torba x 6 takım, her torbadan 1 rakip (3 iç 3 dış), 6 maç
//   Üçünde de: ilk 8 doğrudan son 16'ya, 9-24 arası play-off (çift maçlı), 25-36 elenir.
//   Son 16, çeyrek ve yarı final çift maçlı; final tek maç. Eşitlikte penaltılar.

const TOURNAMENT_FORMATS = {
    ucl: { pots: 4, potSize: 9, perPot: 2, matches: 8 },
    uel: { pots: 4, potSize: 9, perPot: 2, matches: 8 },
    uecl: { pots: 6, potSize: 6, perPot: 1, matches: 6 }
};

const KNOCKOUT_ROUNDS = ["playoffs", "r16", "qf", "sf", "final"];
const ROUND_NAMES = { league: "League phase", playoffs: "Knock-out play-offs", r16: "Round of 16", qf: "Quarter-finals", sf: "Semi-finals", final: "Final" };

function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

// ---------- Kura ----------

// Takımlar Elo puanına göre torbalara ayrılır (UEFA katsayı sıralamasının yerine geçer)
function makePots(teams, ratings, format) {
    const sorted = teams.slice().sort((a, b) => (ratings[b] || 0) - (ratings[a] || 0));
    return Array.from({ length: format.pots }, (_, i) => sorted.slice(i * format.potSize, (i + 1) * format.potSize));
}

// Aşağıdaki dört çekiliş, "valid(maçlar)" kuralı sağlanana kadar rastgele dener (valid: aynı ülke yok, aynı ülkeden en fazla 2 rakip)

// Torbalar arası: her takım karşı torbadan 2 rakip, biri iç biri dış saha.
// İki bağımsız birebir eşleme (iç saha için, dış saha için); aynı rakip ikisinde de çıkmasın.
function drawTwoPerPot(potA, potB, valid) {
    for (let attempt = 0; attempt < 3000; attempt++) {
        const homeOpponent = shuffle(potB);
        const awayOpponent = shuffle(potB);
        if (homeOpponent.some((team, i) => team === awayOpponent[i])) continue;
        const matches = potA.flatMap((team, i) => [{ home: team, away: homeOpponent[i] }, { home: awayOpponent[i], away: team }]);
        if (valid(matches)) return matches;
    }
    return null;
}

// Torba içi: rastgele bir çevrim, herkes bir sonrakini ağırlar
function drawWithinPotCycle(pot, valid) {
    for (let attempt = 0; attempt < 3000; attempt++) {
        const order = shuffle(pot);
        const matches = order.map((team, i) => ({ home: team, away: order[(i + 1) % order.length] }));
        if (valid(matches)) return matches;
    }
    return null;
}

// Torbalar arası tek rakip: birebir eşleme (saha sonra dengelenir)
function drawOnePerPot(potA, potB, valid) {
    for (let attempt = 0; attempt < 3000; attempt++) {
        const order = shuffle(potB);
        const matches = potA.map((team, i) => ({ home: team, away: order[i] }));
        if (valid(matches)) return matches;
    }
    return null;
}

// Torba içi tek rakip: 6 takım 3 çift
function drawWithinPotPairs(pot, valid) {
    for (let attempt = 0; attempt < 3000; attempt++) {
        const order = shuffle(pot);
        const matches = [];
        for (let i = 0; i < order.length; i += 2) matches.push({ home: order[i], away: order[i + 1] });
        if (valid(matches)) return matches;
    }
    return null;
}

// Herkes eşit sayıda iç/dış saha oynasın: her takımın maç sayısı çift olduğundan çizge Euler turuna sahiptir;
// tur boyunca yürüyüp her kenarı yürüyüş yönünde "iç saha -> dış saha" diye yönlendirince giriş = çıkış olur (Hierholzer)
function balanceVenues(matches, teams) {
    const incident = Object.fromEntries(teams.map(id => [id, []]));
    matches.forEach((m, i) => { incident[m.home].push(i); incident[m.away].push(i); });
    const used = new Array(matches.length).fill(false);
    const pointer = Object.fromEntries(teams.map(id => [id, 0]));
    const endpoint = (i, from) => (matches[i].home === from ? matches[i].away : matches[i].home);

    for (const start of teams) {
        if (pointer[start] >= incident[start].length) continue;
        // Hierholzer: yığınla tur kur, kenarları ziyaret sırasına göre yönlendir
        const stack = [{ node: start, edge: -1 }];
        const circuit = [];
        while (stack.length) {
            const { node } = stack[stack.length - 1];
            let next = -1;
            while (pointer[node] < incident[node].length) {
                const edge = incident[node][pointer[node]++];
                if (!used[edge]) { next = edge; break; }
            }
            if (next === -1) circuit.push(stack.pop());
            else { used[next] = true; stack.push({ node: endpoint(next, node), edge: next }); }
        }
        // circuit ters sırada; her adımda "edge" ile "node"a gelindi, önceki düğüm ev sahibi
        for (let i = circuit.length - 1; i > 0; i--) {
            const from = circuit[i].node;
            const edge = circuit[i - 1].edge;
            const m = matches[edge];
            if (m.home !== from) [m.home, m.away] = [m.away, m.home];
        }
    }
    return teams.every(id => matches.filter(m => m.home === id).length * 2 === incident[id].length);
}

// Maçları haftalara böl: her takım her hafta tam bir maç oynar.
// Bu, 8-düzenli bir çizgenin 8 renkle kenar boyamasıdır; rastgele sırayla boyanır, çakışmalar
// Kempe zinciri (iki rengin yer değiştirdiği alternatif yol) ile onarılır. Başaramazsa kura yeniden çekilir.
function scheduleMatchdays(matches, teams, matchdays) {
    const edgeColor = new Array(matches.length).fill(-1);
    const colorAt = Object.fromEntries(teams.map(id => [id, new Map()])); // takım -> renk -> maç indeksi
    const other = (edge, id) => (matches[edge].home === id ? matches[edge].away : matches[edge].home);
    const free = id => { const list = []; for (let c = 0; c < matchdays; c++) if (!colorAt[id].has(c)) list.push(c); return list; };
    const assign = (edge, color) => { edgeColor[edge] = color; colorAt[matches[edge].home].set(color, edge); colorAt[matches[edge].away].set(color, edge); };
    const unassign = edge => { const color = edgeColor[edge]; colorAt[matches[edge].home].delete(color); colorAt[matches[edge].away].delete(color); edgeColor[edge] = -1; };

    // v'den başlayan (a, b) alternatif yolu bul; u'da bitiyorsa null
    const kempePath = (v, a, b, u) => {
        const path = [];
        let node = v;
        let color = a;
        const seen = new Set([v]);
        while (colorAt[node].has(color)) {
            const edge = colorAt[node].get(color);
            path.push(edge);
            node = other(edge, node);
            if (node === u || seen.has(node)) return null;
            seen.add(node);
            color = color === a ? b : a;
        }
        return path;
    };
    const swapPath = (path, a, b) => {
        const colors = path.map(edge => edgeColor[edge]);
        for (const edge of path) unassign(edge);
        path.forEach((edge, i) => assign(edge, colors[i] === a ? b : a));
    };

    for (let attempt = 0; attempt < 60; attempt++) {
        edgeColor.fill(-1);
        for (const id of teams) colorAt[id].clear();
        let failed = false;
        for (const edge of shuffle(matches.map((_, i) => i))) {
            const { home: u, away: v } = matches[edge];
            const freeU = free(u);
            const freeV = free(v);
            const shared = freeU.find(c => freeV.includes(c));
            if (shared !== undefined) { assign(edge, shared); continue; }
            let done = false;
            for (const a of shuffle(freeU)) {
                for (const b of shuffle(freeV)) {
                    // a rengi v'de dolu: v'den a ile başlayan (a,b) zincirini çevirince a v'de boşalır
                    const path = kempePath(v, a, b, u);
                    if (path) { swapPath(path, a, b); assign(edge, a); done = true; break; }
                    const reverse = kempePath(u, b, a, v);
                    if (reverse) { swapPath(reverse, a, b); assign(edge, b); done = true; break; }
                }
                if (done) break;
            }
            if (!done) { failed = true; break; }
        }
        if (!failed) {
            const rounds = Array.from({ length: matchdays }, () => []);
            matches.forEach((m, i) => rounds[edgeColor[i]].push(m));
            return rounds;
        }
    }
    return null;
}

function drawLeaguePhase(teams, ratings, countries, format) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const pots = makePots(teams, ratings, format);
        const matches = [];
        // Takım -> ülke -> o ülkeden kaç rakip; parça parça kontrol edilir ki son anda bozulmasın
        const opponents = Object.fromEntries(teams.map(id => [id, {}]));
        const valid = part => {
            const added = {};
            for (const m of part) {
                if (countries[m.home] && countries[m.home] === countries[m.away]) return false;
                for (const [team, other] of [[m.home, m.away], [m.away, m.home]]) {
                    if (!countries[other]) continue; // ülkesi bilinmeyen takım bu kurala girmez
                    const key = `${team}|${countries[other]}`;
                    added[key] = (added[key] || 0) + 1;
                    if ((opponents[team][countries[other]] || 0) + added[key] > 2) return false;
                }
            }
            return true;
        };
        const commit = part => {
            for (const m of part) {
                if (countries[m.away]) opponents[m.home][countries[m.away]] = (opponents[m.home][countries[m.away]] || 0) + 1;
                if (countries[m.home]) opponents[m.away][countries[m.home]] = (opponents[m.away][countries[m.home]] || 0) + 1;
            }
            matches.push(...part);
        };

        let ok = true;
        // Önce torba içi (en kısıtlı), sonra torbalar arası
        for (let p = 0; p < pots.length && ok; p++) {
            const part = format.perPot === 2 ? drawWithinPotCycle(pots[p], valid) : drawWithinPotPairs(pots[p], valid);
            if (part) commit(part); else ok = false;
        }
        for (let p = 0; p < pots.length && ok; p++) {
            for (let q = p + 1; q < pots.length && ok; q++) {
                const part = format.perPot === 2 ? drawTwoPerPot(pots[p], pots[q], valid) : drawOnePerPot(pots[p], pots[q], valid);
                if (part) commit(part); else ok = false;
            }
        }
        if (!ok) continue;
        if (format.perPot === 1 && !balanceVenues(matches, teams)) continue;

        const matchdays = scheduleMatchdays(matches, teams, format.matches);
        if (!matchdays) continue;
        return { pots, matchdays: matchdays.map(round => round.map(m => ({ home: m.home, away: m.away, score: null }))) };
    }
    throw new Error("Kura çekilemedi");
}

// ---------- Turnuva nesnesi ----------

function createTournament(competitionId, teamId, { teams, ratings, countries, mode }) {
    const format = TOURNAMENT_FORMATS[competitionId];
    if (!format) throw new Error(`Bilinmeyen turnuva: ${competitionId}`);
    if (teams.length !== format.pots * format.potSize) throw new Error(`${competitionId}: ${teams.length} takım, ${format.pots * format.potSize} gerekli`);
    if (!teams.includes(teamId)) throw new Error("Seçilen takım turnuvada değil");

    const { pots, matchdays } = drawLeaguePhase(teams, ratings, countries, format);
    return {
        version: 1,
        competition: competitionId,
        team: teamId,
        mode: mode || "classic",
        createdAt: new Date().toISOString(),
        teams: teams.slice(),
        ratings: Object.fromEntries(teams.map(id => [id, ratings[id] || null])),
        pots,
        league: { matchdays, played: 0 },
        stage: "league",             // league | playoffs | r16 | qf | sf | final | done
        rounds: {},                  // round -> [tie]; tie: { seed, other, legs: [match, match?], winner, penalties }
        userOut: null,               // kullanıcı hangi aşamada elendi (league: 25-36 arası)
        champion: null
    };
}

// ---------- Puan durumu ----------

function standings(t) {
    const rows = Object.fromEntries(t.teams.map(id => [id, { id, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0, awayGoals: 0 }]));
    for (const round of t.league.matchdays) {
        for (const m of round) {
            if (!m.score) continue;
            const [h, a] = m.score;
            const home = rows[m.home];
            const away = rows[m.away];
            home.played++; away.played++;
            home.gf += h; home.ga += a; away.gf += a; away.ga += h; away.awayGoals += a;
            if (h > a) { home.won++; away.lost++; home.points += 3; }
            else if (h < a) { away.won++; home.lost++; away.points += 3; }
            else { home.drawn++; away.drawn++; home.points++; away.points++; }
        }
    }
    for (const row of Object.values(rows)) row.gd = row.gf - row.ga;
    // UEFA sırası: puan, averaj, atılan gol, deplasman golü, galibiyet; sonra Elo
    return Object.values(rows).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || b.awayGoals - a.awayGoals
        || b.won - a.won || (t.ratings[b.id] || 0) - (t.ratings[a.id] || 0) || a.id.localeCompare(b.id));
}

function leaguePosition(t, id) {
    return standings(t).findIndex(row => row.id === id) + 1;
}

// ---------- Eleme turları ----------

function makeTie(seed, other, singleLeg) {
    // Çift maçta avantajlı (seri başı) takım rövanşı evinde oynar; final tek maç
    const legs = singleLeg ? [{ home: seed, away: other, score: null }] : [{ home: other, away: seed, score: null }, { home: seed, away: other, score: null }];
    return { seed, other, legs, winner: null, penalties: null };
}

function pickOne(pair) {
    const i = Math.floor(Math.random() * 2);
    return [pair[i], pair[1 - i]];
}

// Play-off: 9-16 seri başı, 17-24 kurasız; 9/10 - 23/24, 11/12 - 21/22, 13/14 - 19/20, 15/16 - 17/18
function buildPlayoffs(t) {
    const table = standings(t).map(row => row.id);
    const at = pos => table[pos - 1];
    const brackets = [[[9, 10], [23, 24]], [[11, 12], [21, 22]], [[13, 14], [19, 20]], [[15, 16], [17, 18]]];
    const ties = [];
    for (const [seeds, others] of brackets) {
        const [firstOther, secondOther] = pickOne(others.map(at));
        ties.push(makeTie(at(seeds[0]), firstOther, false), makeTie(at(seeds[1]), secondOther, false));
    }
    return ties;
}

// Son 16 ağacı: 1/2 - (15/16-17/18 galibi), 3/4 - (13/14-19/20), 5/6 - (11/12-21/22), 7/8 - (9/10-23/24).
// İki yarı: {1 ya da 2, 7/8'den biri, 3/4'ten biri, 5/6'dan biri}; çeyrek final 1-8 ve 3-5 kolları, yarı final çapraz.
function buildRoundOf16(t) {
    const table = standings(t).map(row => row.id);
    const at = pos => table[pos - 1];
    const playoffs = t.rounds.playoffs;
    const winnerOf = seedPos => playoffs.find(tie => tie.seed === at(seedPos)).winner;
    // Her seri başı çiftinden biri A yarısına, diğeri B yarısına
    const halves = [[], []];
    const pairs = [[1, 2], [8, 7], [3, 4], [5, 6]];
    const opponents = { 1: [15, 16], 2: [15, 16], 3: [13, 14], 4: [13, 14], 5: [11, 12], 6: [11, 12], 7: [9, 10], 8: [9, 10] };
    for (const pair of pairs) {
        const [toA, toB] = pickOne(pair);
        halves[0].push(toA);
        halves[1].push(toB);
    }
    const ties = [];
    for (const half of halves) {
        for (const pos of half) {
            // Seri başı, kendi bloğundaki iki play-off galibinden henüz eşleşmemiş olanla oynar
            const winners = opponents[pos].map(winnerOf).filter(id => !ties.some(tie => tie.other === id));
            const [other] = pickOne(winners.length === 2 ? winners : [winners[0], winners[0]]);
            ties.push(makeTie(at(pos), other, false));
        }
    }
    return ties; // sıra: A yarısı [1/2, 7/8, 3/4, 5/6], B yarısı [aynı]
}

// Sonraki tur: çeyrek final kolları (1/2 - 7/8) ve (3/4 - 5/6); yarı final kolları çapraz; final
function buildNextRound(t, previous) {
    const winners = previous.map(tie => tie.winner);
    const pairs = [];
    for (let i = 0; i < winners.length; i += 2) {
        // Lig sırası daha iyi olan rövanşı evinde oynar
        const [a, b] = [winners[i], winners[i + 1]];
        const seed = leaguePosition(t, a) <= leaguePosition(t, b) ? a : b;
        pairs.push(makeTie(seed, seed === a ? b : a, winners.length === 2));
    }
    return pairs;
}

// Penaltılar: güçlü takım biraz daha şanslı
function rollShootout(t, a, b) {
    const edge = Math.tanh(((t.ratings[a] || 1500) - (t.ratings[b] || 1500)) / 900);
    const aWins = Math.random() < 0.5 + edge * 0.25;
    const scores = [[5, 4], [4, 3], [3, 2], [4, 2], [5, 3], [6, 5], [3, 1], [7, 6]];
    const [w, l] = scores[Math.floor(Math.random() * scores.length)];
    return aWins ? [w, l] : [l, w];
}

function settleTie(t, tie) {
    if (tie.legs.some(leg => !leg.score)) return;
    if (tie.winner) return;
    let seedGoals = 0;
    let otherGoals = 0;
    for (const leg of tie.legs) {
        const [h, a] = leg.score;
        if (leg.home === tie.seed) { seedGoals += h; otherGoals += a; } else { seedGoals += a; otherGoals += h; }
    }
    if (seedGoals !== otherGoals) {
        tie.winner = seedGoals > otherGoals ? tie.seed : tie.other;
        tie.penalties = null;
    } else {
        // Kullanıcının maçında penaltılar sahada atılmış olabilir (recordUserResult yazar)
        if (!tie.penalties) tie.penalties = rollShootout(t, tie.seed, tie.other);
        tie.winner = tie.penalties[0] > tie.penalties[1] ? tie.seed : tie.other;
    }
    tie.aggregate = [seedGoals, otherGoals];
}

function tieOf(t, round, id) {
    return (t.rounds[round] || []).find(tie => tie.seed === id || tie.other === id) || null;
}

// ---------- Akış ----------

// Turun henüz oynanmamış maçları (lig haftası ya da eleme turunun o ayağı)
function pendingMatches(t) {
    if (t.stage === "league") {
        const round = t.league.matchdays[t.league.played];
        return round ? round.filter(m => !m.score) : [];
    }
    if (t.stage === "done") return [];
    const ties = t.rounds[t.stage] || [];
    // Önce herkesin ilk maçı, sonra rövanşlar
    const firstLegs = ties.flatMap(tie => tie.legs[0] && !tie.legs[0].score ? [tie.legs[0]] : []);
    if (firstLegs.length) return firstLegs;
    return ties.flatMap(tie => tie.legs[1] && !tie.legs[1].score ? [tie.legs[1]] : []);
}

function involvesUser(t, m) {
    return m.home === t.team || m.away === t.team;
}

function userAlive(t) {
    return !t.userOut && t.stage !== "done";
}

// Kullanıcının sıradaki maçı: { stage, matchday|round, leg, home, away }
function nextUserMatch(t) {
    if (!userAlive(t)) return null;
    const m = pendingMatches(t).find(x => involvesUser(t, x));
    if (!m) return null;
    const tie = t.stage === "league" ? null : tieOf(t, t.stage, t.team);
    return {
        stage: t.stage,
        matchday: t.stage === "league" ? t.league.played + 1 : null,
        leg: tie ? tie.legs.indexOf(m) + 1 : null,
        home: m.home,
        away: m.away,
        tie
    };
}

// Tur bitince ilerle: lig haftası -> sonraki hafta / play-off; eleme turu -> sonraki tur
function advanceIfRoundDone(t) {
    if (pendingMatches(t).length) return;
    if (t.stage === "league") {
        t.league.played++;
        if (t.league.played < t.league.matchdays.length) return;
        const position = leaguePosition(t, t.team);
        if (position > 24) t.userOut = "league";
        t.rounds.playoffs = buildPlayoffs(t);
        t.stage = "playoffs";
        return;
    }
    const ties = t.rounds[t.stage];
    for (const tie of ties) settleTie(t, tie);
    const userTie = tieOf(t, t.stage, t.team);
    if (userTie && userTie.winner !== t.team) t.userOut = t.stage;

    if (t.stage === "final") {
        t.champion = ties[0].winner;
        t.stage = "done";
        return;
    }
    const next = KNOCKOUT_ROUNDS[KNOCKOUT_ROUNDS.indexOf(t.stage) + 1];
    t.rounds[next] = next === "r16" ? buildRoundOf16(t) : buildNextRound(t, ties);
    t.stage = next;
}

// Kullanıcının maçı gelene (ya da turnuva bitene) kadar diğer maçları oynat.
// simulate(homeId, awayId) -> [evGol, depGol]
function simulateUntilUser(t, simulate) {
    for (let guard = 0; guard < 2000; guard++) {
        if (t.stage === "done") return;
        const pending = pendingMatches(t);
        const user = userAlive(t) ? pending.find(m => involvesUser(t, m)) : null;
        for (const m of pending) {
            if (m === user) continue;
            m.score = simulate(m.home, m.away);
        }
        if (user) return;
        advanceIfRoundDone(t);
    }
}

// Kullanıcının bitirdiği maçı işle; tur tamamlandıysa ilerlet.
// penalties: sahada atılan seri [ev, deplasman]; verilmezse eşitlikte seri anında hesaplanır.
function recordUserResult(t, score, penalties) {
    const m = pendingMatches(t).find(x => involvesUser(t, x));
    if (!m) return null;
    m.score = [score[0], score[1]];
    const tie = t.stage === "league" ? null : tieOf(t, t.stage, t.team);
    if (tie && penalties) tie.penalties = m.home === tie.seed ? [penalties[0], penalties[1]] : [penalties[1], penalties[0]];
    const stageBefore = t.stage;
    advanceIfRoundDone(t);
    return { stage: stageBefore, match: m, tie: stageBefore === "league" ? null : tieOf(t, stageBefore, t.team) };
}

// Kullanıcı o turda oynuyor mu, elendi mi, turnuva bitti mi: ekran için kısa özet
function tournamentSummary(t) {
    const position = leaguePosition(t, t.team);
    return {
        stage: t.stage,
        stageName: ROUND_NAMES[t.stage] || "Finished",
        matchday: t.league.played,
        totalMatchdays: t.league.matchdays.length,
        position,
        userOut: t.userOut,
        champion: t.champion,
        alive: userAlive(t)
    };
}

if (typeof module !== "undefined") {
    module.exports = { TOURNAMENT_FORMATS, KNOCKOUT_ROUNDS, ROUND_NAMES, createTournament, standings, leaguePosition, nextUserMatch, simulateUntilUser, recordUserResult, pendingMatches, tournamentSummary, tieOf };
}
