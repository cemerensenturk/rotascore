// Günün öne çıkan maçlarını çekip json/today.json dosyasına yazar.
// GitHub Actions her sabah çalıştırır (.github/workflows/today.yml).
//
// Kaynaklar:
//   1. API-Football (API_FOOTBALL_KEY)   – tüm ligler, Süper Lig ve Avrupa kupaları dahil
//   2. football-data.org (FOOTBALL_DATA_KEY) – yedek: 5 büyük lig ve Şampiyonlar Ligi
//
// Elle denemek için:  API_FOOTBALL_KEY=... node tools/fetch-today.mjs
// Kaydedilmiş bir yanıtla denemek için:  node tools/fetch-today.mjs --from-file yanit.json

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const teams = JSON.parse(fs.readFileSync(path.join(root, "json/teams.json"), "utf8"));
const { competitions } = JSON.parse(fs.readFileSync(path.join(root, "json/competitions.json"), "utf8"));
const aliases = JSON.parse(fs.readFileSync(path.join(root, "tools/team-aliases.json"), "utf8"));

// Sağlayıcıların lig kimlikleri -> bizim competitions.json kimliklerimiz
const API_FOOTBALL_LEAGUES = {
    39: "premier-league", 140: "la-liga", 78: "bundesliga", 135: "serie-a", 61: "ligue-1",
    203: "super-lig", 2: "ucl", 3: "uel", 848: "uecl"
};
const FOOTBALL_DATA_LEAGUES = {
    PL: "premier-league", PD: "la-liga", BL1: "bundesliga", SA: "serie-a", FL1: "ligue-1", CL: "ucl"
};
const ORDER = Object.values(API_FOOTBALL_LEAGUES);

// Türkiye saatine göre bugünün tarihi (YYYY-MM-DD)
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());

// ---------- Takım adı -> bizim takım kimliğimiz ----------

const STOP_WORDS = new Set(["fc", "cf", "afc", "sc", "ac", "as", "ss", "ssc", "sk", "fk", "cd", "ud", "rc", "rcd",
    "sv", "vfl", "vfb", "tsg", "bv", "club", "de", "calcio", "football", "futbol", "the", "1", "07", "04", "05", "29", "1899", "1907", "1913", "1909", "fa", "pae", "jk", "kv", "osc", "hsc", "sco", "ac", "aj", "rb", "us"]);

function normalize(name) {
    return name.toLocaleLowerCase("tr")
        .replace(/ø/g, "o").replace(/ı/g, "i").replace(/ß/g, "ss")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(name) {
    return normalize(name).split(" ").filter(token => token && !STOP_WORDS.has(token));
}

const competitionTeams = Object.fromEntries(competitions.filter(c => c.teams).map(c => [c.id, c.teams]));

function resolveTeam(name, competitionId) {
    if (aliases[name]) return aliases[name];

    const wanted = tokens(name);
    const key = wanted.join(" ");
    // Önce o ligin takımlarında ara
    const pool = competitionTeams[competitionId] || [];
    const exact = pool.filter(id => tokens(teams[id].name).join(" ") === key);
    if (exact.length === 1) return exact[0];

    // Bir adın tüm kelimeleri diğerinde geçiyorsa (ör. "Atletico Madrid" ~ "Atlético de Madrid")
    const partial = pool.filter(id => {
        const ours = tokens(teams[id].name);
        if (!ours.length || !wanted.length) return false;
        const [short, long] = ours.length <= wanted.length ? [ours, wanted] : [wanted, ours];
        return short.every(token => long.includes(token));
    });
    if (partial.length === 1) return partial[0];

    // Tüm takımlarda sadece birebir aynı ad kabul edilir (yanlış eşleşme olmasın)
    const anywhere = Object.keys(teams).filter(id => tokens(teams[id].name).join(" ") === key);
    return anywhere.length === 1 ? anywhere[0] : null;
}

// ---------- Kaynaklar ----------

async function fromApiFootball(key) {
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${today}&timezone=Europe/Istanbul`, {
        headers: { "x-apisports-key": key }
    });
    const data = await response.json();
    if (!response.ok || (data.errors && Object.keys(data.errors).length)) {
        throw new Error(`API-Football: ${response.status} ${JSON.stringify(data.errors)}`);
    }
    return parseApiFootball(data);
}

function parseApiFootball(data) {
    return data.response
        .filter(f => API_FOOTBALL_LEAGUES[f.league.id])
        .map(f => ({
            competition: API_FOOTBALL_LEAGUES[f.league.id],
            kickoff: f.fixture.date,
            home: f.teams.home.name,
            away: f.teams.away.name
        }));
}

async function fromFootballData(key) {
    // Türkiye gece yarısı UTC'de önceki güne düştüğü için iki günü isteyip süzüyoruz
    const next = new Date(`${today}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const response = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${next.toISOString().slice(0, 10)}`, {
        headers: { "X-Auth-Token": key }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`football-data.org: ${response.status} ${data.message || ""}`);
    return data.matches
        .filter(m => FOOTBALL_DATA_LEAGUES[m.competition.code])
        .filter(m => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(m.utcDate)) === today)
        .map(m => ({
            competition: FOOTBALL_DATA_LEAGUES[m.competition.code],
            kickoff: m.utcDate,
            home: m.homeTeam.name,
            away: m.awayTeam.name
        }));
}

// ---------- Çalıştır ----------

async function collect() {
    const fileIndex = process.argv.indexOf("--from-file");
    if (fileIndex > -1) {
        return { source: "file", fixtures: parseApiFootball(JSON.parse(fs.readFileSync(process.argv[fileIndex + 1], "utf8"))) };
    }
    const errors = [];
    if (process.env.API_FOOTBALL_KEY) {
        try {
            return { source: "api-football", fixtures: await fromApiFootball(process.env.API_FOOTBALL_KEY) };
        } catch (error) {
            // Yedeğe düşülse bile neden düşüldüğü log'da görünsün
            console.warn(`Yedek kaynağa geçiliyor: ${error.message}`);
            errors.push(error.message);
        }
    }
    if (process.env.FOOTBALL_DATA_KEY) {
        try {
            return { source: "football-data.org", fixtures: await fromFootballData(process.env.FOOTBALL_DATA_KEY) };
        } catch (error) {
            errors.push(error.message);
        }
    }
    throw new Error(`Maçlar alınamadı: ${errors.join(" | ") || "API anahtarı yok"}`);
}

const { source, fixtures } = await collect();
const unmatched = new Set();

const matches = fixtures
    .map(f => {
        const home = resolveTeam(f.home, f.competition);
        const away = resolveTeam(f.away, f.competition);
        if (!home) unmatched.add(`${f.home} (${f.competition})`);
        if (!away) unmatched.add(`${f.away} (${f.competition})`);
        return {
            competition: f.competition,
            kickoff: f.kickoff,
            home: { id: home, name: f.home },
            away: { id: away, name: f.away }
        };
    })
    .sort((a, b) => ORDER.indexOf(a.competition) - ORDER.indexOf(b.competition) || a.kickoff.localeCompare(b.kickoff));

const output = { date: today, generatedAt: new Date().toISOString(), source, matches };
fs.writeFileSync(path.join(root, "json/today.json"), JSON.stringify(output, null, 1) + "\n");

console.log(`${today}: ${matches.length} maç (${source})`);
if (unmatched.size) {
    // Bunlar oyunda logosuz oynar; tools/team-aliases.json'a eklenerek eşleştirilebilir
    console.log(`Eşleşmeyen takımlar: ${[...unmatched].join(", ")}`);
}
