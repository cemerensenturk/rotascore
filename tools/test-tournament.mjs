// Turnuva modunun kurallarını ve akışını Node'da sınar: motor çizimsiz yüklenir, üç turnuva baştan sona oynatılır.
//   node tools/test-tournament.mjs            (her turnuva 20 kez)
//   node tools/test-tournament.mjs 100

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const T = require(path.join(root, "tournament.js"));
const teams = JSON.parse(fs.readFileSync(path.join(root, "json/teams.json"), "utf8"));
const { competitions } = JSON.parse(fs.readFileSync(path.join(root, "json/competitions.json"), "utf8"));
const ratingsFile = JSON.parse(fs.readFileSync(path.join(root, "json/ratings.json"), "utf8"));
const runs = Number(process.argv[2]) || 20;

// Motoru ekransız yükle (tools/calibrate-strength.mjs ile aynı yöntem)
const noop = () => {};
const fake = () => new Proxy(function () {}, { get: () => fake(), set: () => true, apply: () => fake() });
const element = () => ({ value: "", textContent: "", innerHTML: "", style: { setProperty: noop }, classList: { add: noop, remove: noop }, appendChild: noop, addEventListener: noop, getContext: () => fake() });
const context = vm.createContext({
    document: { getElementById: element, createElement: element, body: { classList: { add: noop, remove: noop } } },
    window: { addEventListener: noop, innerWidth: 1280, devicePixelRatio: 1 },
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop, performance, console, Math, Promise,
    Image: class { decode() { return Promise.reject(); } }, fetch: async () => ({ ok: false })
});
vm.runInContext(`var Sound = new Proxy({}, { get: () => () => {} });
    function onDataLoaded() {} function uiMatchStarted() {} function uiEvent() {} function uiClockChanged() {}
    function uiMatchEnded() {} function uiStatsChanged() {} function uiScoreChanged() {}`, context);
vm.runInContext(fs.readFileSync(path.join(root, "xg-table.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), context);
vm.runInContext(`teamsDatabase = ${JSON.stringify(teams)};
    ratings = ${JSON.stringify(Object.fromEntries(Object.entries(ratingsFile.clubs).map(([id, elo]) => [id, { elo, kind: "club" }])))};`, context);
const simulate = (home, away, mode) => vm.runInContext(`simulateMatch(${JSON.stringify(home)}, ${JSON.stringify(away)}, ${JSON.stringify(mode)})`, context);

const countries = Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, t.country]));
let failures = 0;
const check = (ok, message) => { if (!ok) { failures++; console.log("  HATA:", message); } };

for (const competitionId of ["ucl", "uel", "uecl"]) {
    const format = T.TOURNAMENT_FORMATS[competitionId];
    const ids = competitions.find(c => c.id === competitionId).teams;
    const stats = { champion: {}, userOut: {}, goals: 0, matches: 0, penalties: 0, userPosition: [] };
    const started = Date.now();

    for (let run = 0; run < runs; run++) {
        const user = ids[Math.floor(Math.random() * ids.length)];
        const t = T.createTournament(competitionId, user, { teams: ids, ratings: ratingsFile.clubs, countries, mode: "realistic" });

        // Kura kuralları
        const all = t.league.matchdays.flat();
        check(all.length === ids.length * format.matches / 2, `${competitionId}: ${all.length} maç`);
        check(t.league.matchdays.length === format.matches && t.league.matchdays.every(r => r.length === ids.length / 2), "hafta sayısı/boyutu");
        for (const id of ids) {
            const mine = all.filter(m => m.home === id || m.away === id);
            check(mine.length === format.matches, `${id}: ${mine.length} maç`);
            check(mine.filter(m => m.home === id).length === format.matches / 2, `${id}: iç saha dengesi`);
            const perCountry = {};
            for (const m of mine) {
                const other = m.home === id ? m.away : m.home;
                check(countries[other] !== countries[id], `${id} aynı ülkeden ${other} ile`);
                perCountry[countries[other]] = (perCountry[countries[other]] || 0) + 1;
                check(perCountry[countries[other]] <= 2, `${id}: aynı ülkeden 3 rakip`);
            }
            for (const pot of t.pots) {
                const fromPot = mine.filter(m => pot.includes(m.home === id ? m.away : m.home));
                check(fromPot.length === format.perPot, `${id}: torbadan ${fromPot.length} rakip`);
                if (format.perPot === 2) check(fromPot.filter(m => m.home === id).length === 1, `${id}: torba içi iç/dış dengesi`);
            }
            check(new Set(mine.map(m => m.home === id ? m.away : m.home)).size === format.matches, `${id}: aynı rakiple iki kez`);
        }
        for (const round of t.league.matchdays) {
            const seen = new Set();
            for (const m of round) { check(!seen.has(m.home) && !seen.has(m.away), "bir haftada iki maç"); seen.add(m.home); seen.add(m.away); }
        }

        // Akış: kullanıcının maçları da simülasyonla oynanır
        let userMatches = 0;
        for (let guard = 0; guard < 100 && t.stage !== "done"; guard++) {
            T.simulateUntilUser(t, (h, a) => { const r = simulate(h, a, t.mode); stats.goals += r.score[0] + r.score[1]; stats.matches++; return r.score; });
            const next = T.nextUserMatch(t);
            if (!next) { check(t.stage === "done", `maç yok ama turnuva bitmedi (${t.stage})`); break; }
            check(next.home === user || next.away === user, "kullanıcı maçı kullanıcıya ait değil");
            const r = simulate(next.home, next.away, t.mode);
            T.recordUserResult(t, r.score);
            userMatches++;
        }
        check(t.stage === "done" && t.champion, "şampiyon yok");
        const table = T.standings(t);
        check(table.every(row => row.played === format.matches), "lig aşaması eksik");
        check(t.rounds.playoffs.length === 8 && t.rounds.r16.length === 8 && t.rounds.qf.length === 4 && t.rounds.sf.length === 2 && t.rounds.final.length === 1, "tur boyutları");
        const top8 = table.slice(0, 8).map(r => r.id);
        check(t.rounds.r16.every(tie => top8.includes(tie.seed)), "son 16 seri başları ilk 8 değil");
        check(t.rounds.playoffs.every(tie => { const p = T.leaguePosition(t, tie.seed), q = T.leaguePosition(t, tie.other); return p >= 9 && p <= 16 && q >= 17 && q <= 24; }), "play-off eşleşmeleri");
        for (const round of Object.values(t.rounds)) for (const tie of round) { check(!!tie.winner, "kazanansız eşleşme"); if (tie.penalties) stats.penalties++; }
        const pos = T.leaguePosition(t, user);
        stats.userPosition.push(pos);
        const expectedUserMatches = format.matches + (pos > 24 ? 0 : (pos > 8 ? 2 : 0) + (t.userOut === "playoffs" ? 0 : ({ r16: 2, qf: 4, sf: 6, final: 7, null: 7 })[t.userOut] ?? 0));
        check(userMatches === expectedUserMatches, `kullanıcı ${userMatches} maç oynadı, ${expectedUserMatches} bekleniyordu (sıra ${pos}, elendi: ${t.userOut})`);
        stats.champion[t.champion] = (stats.champion[t.champion] || 0) + 1;
        stats.userOut[t.userOut || "champion"] = (stats.userOut[t.userOut || "champion"] || 0) + 1;
        JSON.parse(JSON.stringify(t)); // kaydedilebilir olmalı
    }

    const top = Object.entries(stats.champion).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${teams[id].name} ${n}`).join(", ");
    console.log(`${competitionId}: ${runs} turnuva, ${((Date.now() - started) / runs).toFixed(0)} ms/turnuva, ${(stats.goals / stats.matches).toFixed(2)} gol/maç, ${stats.penalties} penaltı serisi`);
    console.log(`  şampiyonlar: ${top}`);
    console.log(`  kullanıcı: ${JSON.stringify(stats.userOut)}`);
}
console.log(failures ? `${failures} hata` : "Tüm kontroller geçti");
process.exitCode = failures ? 1 : 0;
