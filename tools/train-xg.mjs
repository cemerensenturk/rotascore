// xG tablosunu üretir: oyun motorunu (script.js) ekransız çalıştırıp çok sayıda maç oynatır,
// her şutun çekildiği andaki hedefini (kale merkezine yay uzunluğu) ve kat edeceği mesafeyi,
// ve gol olup olmadığını kaydeder; sonra her (mesafe, hedef) diliminin gol oranını xg-table.js'e yazar.
//
// Oyunun fiziği, kale ya da kaleci ayarları değişince yeniden çalıştırın:
//   node tools/train-xg.mjs            (varsayılan 24.000 maç, işlemci çekirdeklerine bölünür)
//   node tools/train-xg.mjs 5000       (daha hızlı, daha kaba)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const AIM_STEP = 10;      // Hedefin kale merkezine uzaklık dilimi (dünya birimi)
const AIM_MAX = 140;      // Bundan uzağa nişanlanan şutlar son dilime düşer
const TRAVEL_STEP = 30;   // Kat edilecek yol dilimi
const TRAVEL_MAX = 300;

// ---------- İşçi: maç oynatıp şutları toplar ----------

function simulate(matches) {
    const noop = () => {};
    // Çizim çağrıları hiçbir şey yapmaz; her çağrı yine çağrılabilir bir taklit döndürür (ör. createRadialGradient)
    const fake = () => new Proxy(function () {}, { get: () => fake(), set: () => true, apply: () => fake() });
    const element = () => ({
        value: "", textContent: "", innerHTML: "", style: { setProperty: noop },
        classList: { add: noop, remove: noop }, appendChild: noop, addEventListener: noop,
        getContext: () => fake()
    });
    const context = vm.createContext({
        document: { getElementById: element, createElement: element },
        window: { addEventListener: noop, innerWidth: 1280, devicePixelRatio: 1 },
        requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
        performance, console, Math, Promise,
        Image: class { decode() { return Promise.reject(); } },
        fetch: async () => ({ ok: false })
    });
    // Oyun motorunun arayüze ve sese yaptığı çağrılar burada boş
    vm.runInContext(`var Sound = new Proxy({}, { get: () => () => {} });
        function onDataLoaded() {} function uiMatchStarted() {} function uiEvent() {} function uiClockChanged() {}
        function uiMatchEnded() {} function uiStatsChanged() {} function uiScoreChanged() {}`, context);
    vm.runInContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), context);

    return vm.runInContext(`
        const shots = [];
        recordShot = (team, features, result) => { shots.push([features.aim, features.travel, result === "goal" ? 1 : 0]); };
        for (let m = 0; m < ${matches}; m++) {
            for (const t of [team1, team2]) { t.color = ["#FF0000", "#FFFFFF"]; t.initial = "X"; t.name = "X"; }
            score = [0, 0]; clock = { half: 1, minute: 0, added: 0, extra: 0 }; stats = [newStats(), newStats()];
            matchEvents = []; matchGoals = []; minuteTimer = 0;
            keeper.form = randomBetween(KEEPER_FORM_MIN, KEEPER_FORM_MAX);
            resetPositions(); gameState = "playing";
            while (gameState !== "ended") step();
        }
        shots;`, context);
}

if (!isMainThread) {
    parentPort.postMessage(simulate(workerData.matches));
} else {
    const total = Number(process.argv[2]) || 24000;
    const workers = Math.max(1, Math.min(os.cpus().length, 8));
    const started = Date.now();

    const parts = await Promise.all(Array.from({ length: workers }, (_, i) => new Promise((resolve, reject) => {
        const matches = Math.floor(total / workers) + (i < total % workers ? 1 : 0);
        const worker = new Worker(new URL(import.meta.url), { workerData: { matches } });
        worker.on("message", resolve);
        worker.on("error", reject);
    })));
    const shots = parts.flat();

    // Dilimlere ayır: her ızgara noktası, çevresindeki yarım dilimlik şutların ortalaması
    const aimPoints = AIM_MAX / AIM_STEP + 1;
    const travelPoints = TRAVEL_MAX / TRAVEL_STEP + 1;
    const goals = Array.from({ length: travelPoints }, () => new Array(aimPoints).fill(0));
    const counts = Array.from({ length: travelPoints }, () => new Array(aimPoints).fill(0));
    for (const [aim, travel, goal] of shots) {
        const a = Math.min(aimPoints - 1, Math.round(aim / AIM_STEP));
        const t = Math.min(travelPoints - 1, Math.round(travel / TRAVEL_STEP));
        goals[t][a] += goal;
        counts[t][a]++;
    }

    // Az şut düşen dilimler, aynı hedefteki tüm şutların ortalamasına doğru çekilir
    const overall = goals[0].map((_, a) => {
        const g = goals.reduce((sum, row) => sum + row[a], 0);
        const n = counts.reduce((sum, row) => sum + row[a], 0);
        return n ? g / n : 0;
    });
    const PRIOR = 30;
    const values = goals.map((row, t) => row.map((g, a) =>
        Number(((g + PRIOR * overall[a]) / (counts[t][a] + PRIOR)).toFixed(3))));

    const goalCount = shots.reduce((sum, shot) => sum + shot[2], 0);
    const table = { aimStep: AIM_STEP, travelStep: TRAVEL_STEP, values };
    const file = `// Bu dosya tools/train-xg.mjs ile üretildi, elle düzenlemeyin.
// ${total} simüle maç, ${shots.length} şut, ${goalCount} gol (şut başına ${(goalCount / shots.length).toFixed(3)}).
// values[mesafe dilimi][hedef dilimi]: mesafe 0'dan ${TRAVEL_STEP}'ar, hedef (kale merkezine uzaklık) 0'dan ${AIM_STEP}'ar birim.
const XG_TABLE = ${JSON.stringify(table)};
`;
    fs.writeFileSync(path.join(root, "xg-table.js"), file);

    console.log(`${total} maç, ${shots.length} şut, ${goalCount} gol, ${((Date.now() - started) / 1000).toFixed(0)} sn`);
    console.log("Hedefe göre gol oranı:", overall.map(v => v.toFixed(2)).join(" "));
    console.log("Mesafe dilimlerindeki şut sayısı:", counts.map(row => row.reduce((a, b) => a + b, 0)).join(" "));
}
