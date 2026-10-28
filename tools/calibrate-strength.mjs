// Realistic mod ayarı: farklı Elo farkları için çok sayıda maç oynatır ve güçlü takımın
// oyundaki beklenen skorunu (galibiyet + beraberliğin yarısı) Elo formülünün beklediğiyle karşılaştırır.
//
//   node tools/calibrate-strength.mjs                 (script.js'teki katsayılarla)
//   node tools/calibrate-strength.mjs 0.4 0.3 800 600 (FINISHING_TURN, DUEL_EDGE, fark başına maç, ELO_SCALE dene)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIFFS = [0, 100, 200, 300, 400, 600];

function simulate({ diff, matches, turn, duel, scale }) {
    let source = fs.readFileSync(path.join(root, "script.js"), "utf8");
    if (turn !== undefined) source = source.replace(/const FINISHING_TURN = [\d.]+;/, `const FINISHING_TURN = ${turn};`);
    if (duel !== undefined) source = source.replace(/const DUEL_EDGE = [\d.]+;/, `const DUEL_EDGE = ${duel};`);
    if (scale !== undefined) source = source.replace(/const ELO_SCALE = [\d.]+;/, `const ELO_SCALE = ${scale};`);

    const noop = () => {};
    const fake = () => new Proxy(function () {}, { get: () => fake(), set: () => true, apply: () => fake() });
    const element = () => ({
        value: "", textContent: "", innerHTML: "", style: { setProperty: noop },
        classList: { add: noop, remove: noop }, appendChild: noop, addEventListener: noop, getContext: () => fake()
    });
    const context = vm.createContext({
        document: { getElementById: element, createElement: element },
        window: { addEventListener: noop, innerWidth: 1280, devicePixelRatio: 1 },
        requestAnimationFrame: () => 0, cancelAnimationFrame: noop, performance, console, Math, Promise,
        Image: class { decode() { return Promise.reject(); } }, fetch: async () => ({ ok: false })
    });
    vm.runInContext(`var Sound = new Proxy({}, { get: () => () => {} });
        function onDataLoaded() {} function uiMatchStarted() {} function uiEvent() {} function uiClockChanged() {}
        function uiMatchEnded() {} function uiStatsChanged() {} function uiScoreChanged() {}`, context);
    vm.runInContext(source, context);
    return vm.runInContext(`
        let wins = 0, draws = 0, goals = 0;
        for (let m = 0; m < ${matches}; m++) {
            for (const t of [team1, team2]) { t.color = ["#FF0000", "#FFFFFF"]; t.initial = "X"; t.name = "X"; }
            setStrength({ elo: 1500 + ${diff}, kind: "club" }, { elo: 1500, kind: "club" });
            score = [0, 0]; clock = { half: 1, minute: 0, added: 0, extra: 0 }; stats = [newStats(), newStats()];
            matchEvents = []; matchGoals = []; minuteTimer = 0;
            keeper.form = randomBetween(KEEPER_FORM_MIN, KEEPER_FORM_MAX);
            resetPositions(); gameState = "playing";
            while (gameState !== "ended") step();
            if (score[0] > score[1]) wins++; else if (score[0] === score[1]) draws++;
            goals += score[0] + score[1];
        }
        ({ wins, draws, goals });`, context);
}

if (!isMainThread) {
    parentPort.postMessage(simulate(workerData));
} else {
    // Boş bırakılan ya da verilmeyen katsayı script.js'teki değerle çalışır
    const [turn, duel, , scale] = process.argv.slice(2, 6).map(v => (v === undefined || v === "" ? undefined : Number(v)));
    const matches = Number(process.argv[4]) || 1500;
    const workers = Math.max(1, Math.min(os.cpus().length, 8));

    const run = diff => Promise.all(Array.from({ length: workers }, (_, i) => new Promise((resolve, reject) => {
        const share = Math.floor(matches / workers) + (i < matches % workers ? 1 : 0);
        const worker = new Worker(new URL(import.meta.url), { workerData: { diff, matches: share, turn, duel, scale } });
        worker.on("message", resolve);
        worker.on("error", reject);
    }))).then(parts => parts.reduce((a, b) => ({ wins: a.wins + b.wins, draws: a.draws + b.draws, goals: a.goals + b.goals })));

    console.log(`FINISHING_TURN=${turn ?? "script.js"} DUEL_EDGE=${duel ?? "script.js"} ELO_SCALE=${scale ?? "script.js"}, fark başına ${matches} maç`);
    console.log("Elo farkı | galibiyet beraberlik mağlubiyet | oyunda beklenen | Elo beklenen | gol/maç");
    for (const diff of DIFFS) {
        const { wins, draws, goals } = await run(diff);
        const expected = (wins + draws / 2) / matches;
        const elo = 1 / (1 + 10 ** (-diff / 400));
        const pct = v => `${(v * 100).toFixed(0)}%`.padStart(4);
        console.log(`${String(diff).padStart(9)} | ${pct(wins / matches)} ${pct(draws / matches)} ${pct(1 - (wins + draws) / matches)} | ${pct(expected).padStart(15)} | ${pct(elo).padStart(12)} | ${(goals / matches).toFixed(2)}`);
    }
}
