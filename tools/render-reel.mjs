// Günün bir maçını Realistic modda oynatıp dikey (1080x1920, 30 fps) MP4 üretir: Instagram Reels için.
// Motor kare kare sürülür (gerçek zamanlı ekran kaydı değil), bu yüzden video her zaman akıcıdır.
//
//   node tools/render-reel.mjs                       (bugünün ilk maçı)
//   node tools/render-reel.mjs --match 2             (json/today.json'daki 2. maç, 1'den başlar)
//   node tools/render-reel.mjs --home fenerbahce --away liverpool --competition ucl
//   Çıktı: out/reel-<tarih>-<ev>-<dep>.mp4  (--out ile değiştirilebilir)
//
// Gerekenler: ffmpeg (PATH'te) ve playwright (PLAYWRIGHT_ROOT ile başka bir kurulum gösterilebilir).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const require = createRequire(process.env.PLAYWRIGHT_ROOT ? path.join(process.env.PLAYWRIGHT_ROOT, "package.json") : import.meta.url);
const { chromium } = require("playwright");

const FPS = 30;
const STEPS_PER_FRAME = 2;        // motor 60 Hz
const INTRO_SECONDS = 2.2;
const OUTRO_SECONDS = 3.0;     // FULL-TIME yazısı
const RESULT_SECONDS = 4.5;    // sonuç kartı sahnesi
const MAX_SECONDS = 180;

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(`--${name}`); return i > -1 ? args[i + 1] : null; };

// ---------- Maçı seç ----------
const today = JSON.parse(fs.readFileSync(path.join(root, "json/today.json"), "utf8"));
let match;
if (option("home") && option("away")) {
    match = { home: { id: option("home") }, away: { id: option("away") }, competition: option("competition") || "ucl" };
} else {
    const index = Number(option("match") || 1) - 1;
    match = today.matches.filter(m => m.home.id && m.away.id)[index];
    if (!match) throw new Error("Bugün için uygun maç yok");
}
const date = today.date;
const output = option("out") || path.join(root, "out", `reel-${date}-${match.home.id}-${match.away.id}.mp4`);
const silentOutput = output.replace(/\.mp4$/, ".silent.mp4");
fs.mkdirSync(path.dirname(output), { recursive: true });

// ---------- Siteyi yerelden sun ----------
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const server = http.createServer((request, response) => {
    const file = path.join(root, decodeURIComponent(request.url.split("?")[0]));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// ---------- ffmpeg: kareleri borudan al ----------
const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-movflags", "+faststart", silentOutput
], { stdio: ["pipe", "inherit", "inherit"] });
const writeFrame = buffer => new Promise(resolve => (ffmpeg.stdin.write(buffer) ? resolve() : ffmpeg.stdin.once("drain", resolve)));

// ---------- Tarayıcı ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on("pageerror", error => console.error("Sayfa hatası:", error.message));
await page.goto(`http://127.0.0.1:${port}/reel/index.html`);
await page.waitForFunction(() => reel.ready());
const info = await page.evaluate(({ home, away, competition, date }) => reel.start({ home, away, mode: "realistic", competition, date }),
    { home: match.home.id, away: match.away.id, competition: match.competition, date: new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) });
console.error(`${info.home} vs ${info.away} (${info.mode}) → ${path.relative(root, output)}`);

const competitionName = await page.evaluate(() => document.getElementById("reel-competition").textContent);
const snap = () => page.screenshot({ type: "jpeg", quality: 88 });
let frames = 0;
// Açılış kartı
for (let i = 0; i < INTRO_SECONDS * FPS; i++) { await writeFrame(await snap()); frames++; }
const introFrames = frames;
await page.evaluate(() => reel.hideIntro());
// Maç
let ended = false;
while (!ended && frames < MAX_SECONDS * FPS) {
    const result = await page.evaluate(steps => reel.frame(steps), STEPS_PER_FRAME);
    await writeFrame(await snap());
    frames++;
    ended = result.ended;
    if (frames % (FPS * 10) === 0) console.error(`  ${Math.round(frames / FPS)} s · ${result.score.join("-")} · ${result.state}`);
}
// Bitiş: FULL-TIME yazısı ve son istatistikler ekranda kalsın
for (let i = 0; i < OUTRO_SECONDS * FPS; i++) {
    await page.evaluate(steps => reel.frame(steps), STEPS_PER_FRAME);
    await writeFrame(await snap());
    frames++;
}
// Sonuç kartı sahnesi
await page.evaluate(name => reel.showResult(name), competitionName);
for (let i = 0; i < RESULT_SECONDS * FPS; i++) { await writeFrame(await snap()); frames++; }

const summary = await page.evaluate(() => reel.summary());
await browser.close();
server.close();
ffmpeg.stdin.end();
await new Promise(resolve => ffmpeg.on("close", resolve));

// ---------- Ses: tribün uğultusu (kahverengi gürültü, oyundaki gibi 500 Hz bant geçiren), düdükler, gol tezahüratı ----------
const seconds = frames / FPS;
const at = event => (introFrames + event.frame) / FPS;
const events = summary.events;
const inputs = ["-i", silentOutput];
const filters = [];
const mixed = [];
let index = 1;
const clip = (file, time, label, trimSeconds, volume) => {
    inputs.push("-i", path.join(root, "sounds", file));
    const trim = trimSeconds ? `atrim=0:${trimSeconds},` : "";
    filters.push(`[${index}:a]${trim}adelay=${Math.round(time * 1000)}|${Math.round(time * 1000)},volume=${volume}[${label}]`);
    mixed.push(`[${label}]`);
    index++;
};
for (const event of events) {
    const time = at(event);
    if (event.type === "kickoff" || event.type === "secondhalf") clip("whistle.mp3", time, `w${index}`, 0.9, 0.5);
    else if (event.type === "halftime") clip("whistle.mp3", time, `w${index}`, 1.4, 0.5);
    else if (event.type === "fulltime") clip("whistle.mp3", time, `w${index}`, null, 0.5);
    else if (event.type === "goal") clip("goal.mp3", time, `g${index}`, null, 0.9);
}
// Tribün: düdükten düdüğe; gollerde 3 saniye yükselir, kurtarış ve direkte kısa bir dalga
const kickoff = events.find(e => e.type === "kickoff");
const fulltime = events.find(e => e.type === "fulltime");
const swells = events.filter(e => e.type === "goal").map(e => `0.9*between(t,${at(e).toFixed(2)},${(at(e) + 3).toFixed(2)})`)
    .concat(events.filter(e => e.type === "save" || e.type === "post").map(e => `0.35*between(t,${at(e).toFixed(2)},${(at(e) + 1.2).toFixed(2)})`));
const crowdLevel = `0.22*between(t,${kickoff ? at(kickoff).toFixed(2) : 0},${fulltime ? (at(fulltime) + 2.5).toFixed(2) : seconds})*(1${swells.length ? "+" + swells.join("+") : ""})`;
filters.push(`anoisesrc=color=brown:amplitude=0.6:sample_rate=48000:duration=${seconds.toFixed(2)},bandpass=f=500:width_type=q:w=0.6,volume='${crowdLevel}':eval=frame[crowd]`);
// Tribün tüm video boyunca sürer; karışımın süresi ona göre (ilk girdi)
mixed.unshift("[crowd]");
filters.push(`${mixed.join("")}amix=inputs=${mixed.length}:normalize=0:duration=first[a]`);
await new Promise((resolve, reject) => {
    const mux = spawn("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", filters.join(";"),
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output], { stdio: "inherit" });
    mux.on("close", code => (code === 0 ? resolve() : reject(new Error(`ffmpeg ses karıştırma: ${code}`))));
});
fs.unlinkSync(silentOutput);

// ---------- Başlık metni (Instagram açıklaması) ----------
const tag = name => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
const scorers = index => summary.goals.filter(g => g.team === index).map(g => g.minute).join(", ");
const compTags = { ucl: "#ChampionsLeague #UCL", uel: "#EuropaLeague #UEL", uecl: "#ConferenceLeague", "super-lig": "#SuperLig #TrendyolSuperLig", "premier-league": "#PremierLeague #PL", "la-liga": "#LaLiga", bundesliga: "#Bundesliga", "serie-a": "#SerieA", "ligue-1": "#Ligue1" };
const caption = [
    `${summary.home} ${summary.score[0]}-${summary.score[1]} ${summary.away} ⚽`,
    `RotaScore's prediction for today's ${competitionName.replace("UEFA ", "").replace("Trendyol ", "")} match, played out in Realistic mode.`,
    summary.goals.length ? `Goals: ${[scorers(0) && `${summary.home} ${scorers(0)}`, scorers(1) && `${summary.away} ${scorers(1)}`].filter(Boolean).join(" · ")}` : "No goals, but plenty of chances.",
    "",
    "Play it yourself: cemeren.dev/rotascore",
    "",
    `#${tag(summary.home)} #${tag(summary.away)} ${compTags[match.competition] || ""} #football #futbol #prediction #RotaScore`.replace(/\s+/g, " ").trim()
].join("\n");
fs.writeFileSync(output.replace(/\.mp4$/, ".txt"), caption + "\n");
fs.writeFileSync(output.replace(/\.mp4$/, ".json"), JSON.stringify({ date, match, summary, frames, fps: FPS, caption }, null, 1));
console.error(`Bitti: ${frames} kare, ${seconds.toFixed(1)} s, skor ${summary.score.join("-")}`);
