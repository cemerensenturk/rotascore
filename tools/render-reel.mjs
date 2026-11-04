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
const OUTRO_SECONDS = 3.5;
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
    "-movflags", "+faststart", output
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

const snap = () => page.screenshot({ type: "jpeg", quality: 88 });
let frames = 0;
// Açılış kartı
for (let i = 0; i < INTRO_SECONDS * FPS; i++) { await writeFrame(await snap()); frames++; }
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
const summary = await page.evaluate(() => reel.summary());
await browser.close();
server.close();
ffmpeg.stdin.end();
await new Promise(resolve => ffmpeg.on("close", resolve));

fs.writeFileSync(output.replace(/\.mp4$/, ".json"), JSON.stringify({ date, match, summary, frames, fps: FPS }, null, 1));
console.error(`Bitti: ${frames} kare, ${(frames / FPS).toFixed(1)} s, skor ${summary.score.join("-")}`);
