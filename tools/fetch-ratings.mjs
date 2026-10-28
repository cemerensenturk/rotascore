// Realistic mod için takımların Elo puanlarını çekip json/ratings.json dosyasına yazar.
// GitHub Actions her sabah günün maçlarından sonra çalıştırır (.github/workflows/today.yml).
//
// Kaynaklar:
//   Kulüpler:       Club Elo (api.clubelo.com) – CSV: Rank,Club,Country,Level,Elo,From,To
//   Milli takımlar: eloratings.net (World.tsv + en.teams.tsv)
// Kaynaklardan biri o gün yanıt vermezse o kısmın önceki puanları korunur.
//
// Elle çalıştırmak için:  node tools/fetch-ratings.mjs

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const teams = JSON.parse(fs.readFileSync(path.join(root, "json/teams.json"), "utf8"));
const { competitions } = JSON.parse(fs.readFileSync(path.join(root, "json/competitions.json"), "utf8"));
const aliases = JSON.parse(fs.readFileSync(path.join(root, "tools/rating-aliases.json"), "utf8"));
const outputFile = path.join(root, "json/ratings.json");
const previous = fs.existsSync(outputFile) ? JSON.parse(fs.readFileSync(outputFile, "utf8")) : { clubs: {}, national: {} };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
const nationalIds = new Set(competitions.find(c => c.id === "worldcup").teams);

// Club Elo ülke kodu -> isimleri önce bu ligin takımlarında ara (yanlış eşleşmeyi önler)
const COUNTRY_LEAGUE = { ENG: "premier-league", ESP: "la-liga", GER: "bundesliga", ITA: "serie-a", FRA: "ligue-1", TUR: "super-lig" };

const STOP_WORDS = new Set(["fc", "cf", "afc", "sc", "ac", "as", "ss", "ssc", "sk", "fk", "cd", "ud", "rc", "rcd", "sv", "vfl",
    "vfb", "tsg", "bv", "club", "de", "calcio", "football", "futbol", "the", "1", "04", "05", "07", "29", "1899", "1907", "1909",
    "1913", "fa", "pae", "jk", "kv", "osc", "hsc", "sco", "aj", "rb", "us", "cfc"]);

function normalize(name) {
    return name.toLocaleLowerCase("tr")
        .replace(/ø/g, "o").replace(/ı/g, "i").replace(/ß/g, "ss").replace(/æ/g, "ae")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(name) {
    return normalize(name).split(" ").filter(token => token && !STOP_WORDS.has(token));
}

// Önce birebir, sonra (sadece o ülkenin liginde) "bir adın tüm kelimeleri diğerinde geçiyor" eşleşmesi
function resolveClub(name, country) {
    if (aliases.clubs[name]) return aliases.clubs[name];
    const wanted = tokens(name);
    const key = wanted.join(" ");
    const clubIds = Object.keys(teams).filter(id => !nationalIds.has(id));
    const league = competitions.find(c => c.id === COUNTRY_LEAGUE[country]);

    const exact = clubIds.filter(id => tokens(teams[id].name).join(" ") === key);
    if (exact.length === 1) return exact[0];
    if (!league || !wanted.length) return null;

    const partial = league.teams.filter(id => {
        const ours = tokens(teams[id].name);
        const [short, long] = ours.length <= wanted.length ? [ours, wanted] : [wanted, ours];
        return short.length && short.every(token => long.includes(token));
    });
    return partial.length === 1 ? partial[0] : null;
}

async function fetchText(url) {
    const response = await fetch(url, { headers: { "User-Agent": "RotaScore ratings (https://cemeren.dev/rotascore)" } });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.text();
}

async function clubRatings() {
    const csv = await fetchText(`http://api.clubelo.com/${today}`);
    const [header, ...rows] = csv.trim().split("\n");
    const columns = header.split(",");
    const [clubColumn, countryColumn, eloColumn] = ["Club", "Country", "Elo"].map(name => columns.indexOf(name));
    const ratings = {};
    const ourClubs = new Set(Object.keys(teams).filter(id => !nationalIds.has(id)));
    for (const row of rows) {
        const cells = row.split(",");
        const id = resolveClub(cells[clubColumn], cells[countryColumn]);
        if (id && ourClubs.has(id)) ratings[id] = Math.round(Number(cells[eloColumn]));
    }
    const missing = [...ourClubs].filter(id => !ratings[id]).map(id => teams[id].name);
    return { ratings, missing };
}

async function nationalRatings() {
    const [world, names] = await Promise.all([
        fetchText("https://www.eloratings.net/World.tsv"),
        fetchText("https://www.eloratings.net/en.teams.tsv")
    ]);
    // en.teams.tsv: kod, ardından bir ya da daha fazla ad
    const codeByName = {};
    for (const line of names.split("\n")) {
        const [code, ...labels] = line.trim().split("\t");
        for (const label of labels) codeByName[normalize(label)] ??= code;
    }
    // World.tsv: sıra, sıra, kod, puan, ...
    const eloByCode = {};
    for (const line of world.split("\n")) {
        const cells = line.split("\t");
        if (cells.length > 3) eloByCode[cells[2]] = Number(cells[3]);
    }
    const ratings = {};
    const missing = [];
    for (const id of nationalIds) {
        const name = aliases.national[teams[id].name] || teams[id].name;
        const elo = eloByCode[codeByName[normalize(name)]];
        if (elo) ratings[id] = elo;
        else missing.push(teams[id].name);
    }
    return { ratings, missing };
}

const output = { date: today, generatedAt: new Date().toISOString(), clubs: previous.clubs, national: previous.national };
let failures = 0;

for (const [kind, load] of [["clubs", clubRatings], ["national", nationalRatings]]) {
    try {
        const { ratings, missing } = await load();
        output[kind] = ratings;
        console.log(`${kind}: ${Object.keys(ratings).length} takım`);
        // Bunlar Realistic modda Classic gibi oynar; tools/rating-aliases.json'a eklenerek eşleştirilebilir
        if (missing.length) console.log(`${kind} puanı bulunamayanlar: ${missing.join(", ")}`);
    } catch (error) {
        failures++;
        console.log(`${kind}: alınamadı, önceki puanlar korunuyor (${error.message})`);
    }
}

fs.writeFileSync(outputFile, JSON.stringify(output, null, 1) + "\n");
if (failures === 2) process.exitCode = 1;
