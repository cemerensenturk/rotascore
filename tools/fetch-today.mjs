// Günün ve yarının öne çıkan maçlarını çekip json/today.json dosyasına yazar.
// GitHub Actions her sabah çalıştırır (.github/workflows/today.yml).
//
// Kaynaklar (sırayla denenir):
//   1. ESPN skor servisi (anahtar gerekmez) – tüm ligler, Süper Lig ve Avrupa kupaları dahil
//   2. football-data.org (FOOTBALL_DATA_KEY) – yedek: 5 büyük lig ve Şampiyonlar Ligi
//   3. API-Football (API_FOOTBALL_KEY)       – yedek: tüm ligler
//
// Elle denemek için:  node tools/fetch-today.mjs
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
const ESPN_LEAGUES = {
    "eng.1": "premier-league", "esp.1": "la-liga", "ger.1": "bundesliga", "ita.1": "serie-a", "fra.1": "ligue-1",
    "tur.1": "super-lig", "uefa.champions": "ucl", "uefa.europa": "uel", "uefa.europa.conf": "uecl"
};
const FOOTBALL_DATA_LEAGUES = {
    PL: "premier-league", PD: "la-liga", BL1: "bundesliga", SA: "serie-a", FL1: "ligue-1", CL: "ucl"
};
const ORDER = Object.values(API_FOOTBALL_LEAGUES);

// Türkiye saatine göre bir anın tarihi (YYYY-MM-DD)
const istanbulDate = date => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
// Türkiye günü UTC ve ABD saatinde iki güne yayıldığı için sağlayıcılardan komşu günleri de isteyip süzüyoruz
function shiftDay(date, days) {
    const shifted = new Date(`${date}T00:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString().slice(0, 10);
}
const today = istanbulDate(new Date());
const tomorrow = shiftDay(today, 1);
const WANTED_DAYS = [today, tomorrow];
const isWanted = fixture => WANTED_DAYS.includes(istanbulDate(new Date(fixture.kickoff)));

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

async function fromEspn() {
    // ESPN tarih aralığı kabul etmiyor, her gün ayrı istenir
    const requests = Object.entries(ESPN_LEAGUES).flatMap(([code, competition]) =>
        [shiftDay(today, -1), today, tomorrow].map(date => ({ code, competition, date: date.replaceAll("-", "") })));
    const results = await Promise.all(requests.map(async ({ code, competition, date }) => {
        const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${date}`);
        // Tek bir lig bile alınamazsa eksik liste yazmak yerine yedeğe geçilir
        if (!response.ok) throw new Error(`ESPN ${code}: ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.events)) throw new Error(`ESPN ${code}: beklenmeyen yanıt`);
        return data.events.map(event => {
            const sides = Object.fromEntries(event.competitions[0].competitors.map(c => [c.homeAway, c.team.displayName]));
            return { competition, kickoff: new Date(event.date).toISOString().replace(".000Z", "Z"), home: sides.home, away: sides.away };
        });
    }));
    return results.flat().filter(isWanted);
}

async function fromApiFootball(key) {
    // Ücretsiz plan yalnızca dün/bugün/yarın tarihlerine izin verir; her gün ayrı istek
    const days = await Promise.all(WANTED_DAYS.map(async date => {
        const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Europe/Istanbul`, {
            headers: { "x-apisports-key": key }
        });
        const data = await response.json();
        if (!response.ok || (data.errors && Object.keys(data.errors).length)) {
            throw new Error(`API-Football: ${response.status} ${JSON.stringify(data.errors)}`);
        }
        return parseApiFootball(data);
    }));
    return days.flat().filter(isWanted);
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
    const response = await fetch(`https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${shiftDay(today, 2)}`, {
        headers: { "X-Auth-Token": key }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`football-data.org: ${response.status} ${data.message || ""}`);
    return data.matches
        .filter(m => FOOTBALL_DATA_LEAGUES[m.competition.code])
        .map(m => ({
            competition: FOOTBALL_DATA_LEAGUES[m.competition.code],
            kickoff: m.utcDate,
            home: m.homeTeam.name,
            away: m.awayTeam.name
        }))
        .filter(isWanted);
}

// ---------- Çalıştır ----------

async function collect() {
    const fileIndex = process.argv.indexOf("--from-file");
    if (fileIndex > -1) {
        return { source: "file", fixtures: parseApiFootball(JSON.parse(fs.readFileSync(process.argv[fileIndex + 1], "utf8"))) };
    }
    const sources = [
        ["espn", () => fromEspn()],
        ["football-data.org", process.env.FOOTBALL_DATA_KEY && (() => fromFootballData(process.env.FOOTBALL_DATA_KEY))],
        ["api-football", process.env.API_FOOTBALL_KEY && (() => fromApiFootball(process.env.API_FOOTBALL_KEY))]
    ];
    const errors = [];
    for (const [source, fetchFixtures] of sources) {
        if (!fetchFixtures) continue;
        try {
            return { source, fixtures: await fetchFixtures() };
        } catch (error) {
            // Yedeğe düşülse bile neden düşüldüğü log'da görünsün
            console.warn(`Yedek kaynağa geçiliyor: ${error.message}`);
            errors.push(error.message);
        }
    }
    // Hiçbir kaynak çalışmazsa today.json'a dokunulmaz ve workflow hata verir
    throw new Error(`Maçlar alınamadı: ${errors.join(" | ")}`);
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

// Bugünün maçları eski düzende en üstte kalır (önbellekte kalmış eski sayfalar yalnızca onları okur), yarın "tomorrow" altında
const byDay = date => matches.filter(m => istanbulDate(new Date(m.kickoff)) === date);
const output = {
    date: today, generatedAt: new Date().toISOString(), source, matches: byDay(today),
    tomorrow: { date: tomorrow, matches: byDay(tomorrow) }
};
fs.writeFileSync(path.join(root, "json/today.json"), JSON.stringify(output, null, 1) + "\n");

console.log(`${today}: ${output.matches.length} maç, ${tomorrow}: ${output.tomorrow.matches.length} maç (${source})`);
if (unmatched.size) {
    // Bunlar oyunda logosuz oynar; tools/team-aliases.json'a eklenerek eşleştirilebilir
    console.log(`Eşleşmeyen takımlar: ${[...unmatched].join(", ")}`);
}
