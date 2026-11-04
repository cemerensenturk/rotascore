// Reel sayfasının arayüzü: script.js motorunun çağırdığı ui* kancalarının küçük sürümü.
// Zaman tarayıcıdan değil, tools/render-reel.mjs'den akar: her karede reel.frame() çağrılır.

const $ = id => document.getElementById(id);
const Sound = new Proxy({}, { get: () => () => false }); // ses çevrimdışı kayda girmez
let reelReady = false;
let reelEnded = false;
const reelEvents = []; // { frame, type } - ileride ses bindirmek için

// Canvas: 350 CSS piksel (dikey karede istatistiklere yer kalsın), 2.4 ölçek => 840 piksel bitmap
function resizeCanvas() {
    const cssSize = 350;
    const dpr = 2.4;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);
    renderScale = canvas.width / WORLD_SIZE;
    fieldLayer = createFieldLayer();
    if (team1.color) team1.sprite = createBallSprite(team1);
    if (team2.color) team2.sprite = createBallSprite(team2);
}

function onDataLoaded() {
    resizeCanvas();
    reelReady = true;
}

// Tarayıcının kendi animasyon döngüsü kapalı: zaman yalnızca reel.frame() ile ilerler
function startLoop() {}

function teamData(id) {
    return teamsDatabase[id];
}

function badge(id, className) {
    const data = teamData(id);
    const el = document.createElement("span");
    el.className = `badge ${className}`;
    const file = logoPath(data);
    if (file) {
        const img = document.createElement("img");
        img.src = `./img/${file}`;
        img.alt = "";
        el.appendChild(img);
    } else {
        el.style.background = `linear-gradient(${data.colors[0]} 50%, ${data.colors[1]} 50%)`;
        el.textContent = data.initial;
    }
    return el;
}

function barColor(team) {
    return team.color[0] === "#FFFFFF" ? team.color[1] : team.color[0];
}

function colorDistance(a, b) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [x, y] = [rgb(a), rgb(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function matchColors() {
    const home = barColor(team1);
    let away = barColor(team2);
    if (colorDistance(home, away) < 120) away = team2.color.find(c => colorDistance(home, c) >= 120) || "#CFD8DC";
    return [home, away];
}

// ---------- Motorun kancaları ----------

function uiMatchStarted() {
    for (const [side, team] of [["home", team1], ["away", team2]]) {
        const logo = $(`sb-${side}-logo`);
        logo.innerHTML = "";
        logo.appendChild(badge(team.id, "badge-xs"));
        $(`sb-${side}-abbr`).textContent = team.initial;
        $(`sb-${side}-score`).textContent = "0";
    }
    $("timeline").innerHTML = "";
    $("ticker").textContent = `${team1.name} vs ${team2.name}`;
    uiClockChanged();
    uiStatsChanged();
}

function uiClockChanged() {
    $("sb-clock-text").textContent =
        gameState === "halftime" ? "HT" :
        gameState === "ended" ? "FT" :
        gameState === "countdown" ? "0'" : clockLabel();
    $("stage").dataset.state = gameState;
}

function uiScoreChanged(teamIndex) {
    const span = $(teamIndex === 0 ? "sb-home-score" : "sb-away-score");
    span.textContent = score[teamIndex];
    span.classList.remove("bump");
    void span.offsetWidth;
    span.classList.add("bump");
}

const eventIcons = { goal: "⚽", save: "🧤", post: "🥅", added: "⏱", kickoff: "▶", halftime: "⏸", fulltime: "🏁" };

function eventText(event) {
    const team = event.team === null ? null : (event.team === 0 ? team1 : team2);
    switch (event.type) {
        case "goal": return `GOAL! ${team.name}${event.xg !== undefined ? ` · xG ${event.xg.toFixed(2)}` : ""}`;
        case "save": return event.great ? `What a save! Fingertips deny ${team.name}` : `Saved! ${team.name} denied by the keeper`;
        case "post": return `Off the post! ${team.name} so close`;
        case "added": return `${event.added} minute${event.added > 1 ? "s" : ""} added`;
        case "kickoff": return `Kick-off: ${team1.name} vs ${team2.name}${matchMode === "realistic" ? ` · Elo ${team1.rating} vs ${team2.rating}` : ""}`;
        case "halftime": return `Half-time: ${score[0]} - ${score[1]}`;
        case "fulltime": return `Full-time: ${team1.name} ${score[0]} - ${score[1]} ${team2.name}`;
        default: return "";
    }
}

function uiEvent(event) {
    reelEvents.push({ frame: reelFrameCount, type: event.type, team: event.team });
    const text = eventText(event);
    $("ticker").textContent = `${event.minute} ${text}`;
    uiClockChanged();
    const item = document.createElement("li");
    item.className = `event event-${event.type}`;
    if (event.team !== null) item.classList.add(event.team === 0 ? "is-home" : "is-away");
    item.innerHTML = `<span class="event-minute"></span><span class="event-icon">${eventIcons[event.type] || ""}</span><span class="event-text"></span>`;
    item.querySelector(".event-minute").textContent = event.minute;
    item.querySelector(".event-text").textContent = text;
    $("timeline").prepend(item);
    // Dikey karede en çok 2 olay görünsün
    while ($("timeline").children.length > 2) $("timeline").lastChild.remove();
}

function uiStatsChanged() {
    if (!stats.length) return;
    const totalPressure = stats[0].pressure + stats[1].pressure || 1;
    // Dikey karede üç satır: xG, isabetli şut, baskı
    const rows = [
        ["xG", stats[0].xg, stats[1].xg, v => v.toFixed(2)],
        ["Shots on target", stats[0].onTarget, stats[1].onTarget],
        ["Pressure", Math.round(stats[0].pressure / totalPressure * 100), Math.round(stats[1].pressure / totalPressure * 100), v => `${v}%`]
    ];
    const container = $("stats");
    if (!container.children.length) {
        container.innerHTML = rows.map(row => `
            <div class="stat">
                <span class="stat-home"></span><span class="stat-label">${row[0]}</span><span class="stat-away"></span>
                <div class="stat-bar"><i class="bar-home"></i><i class="bar-away"></i></div>
            </div>`).join("");
    }
    rows.forEach((row, i) => {
        const stat = container.children[i];
        const [, home, away, format = String] = row;
        const total = home + away || 1;
        stat.querySelector(".stat-home").textContent = format(home);
        stat.querySelector(".stat-away").textContent = format(away);
        stat.querySelector(".bar-home").style.width = `${(home / total) * 100}%`;
        stat.querySelector(".bar-away").style.width = `${(away / total) * 100}%`;
    });
    const [homeColor, awayColor] = matchColors();
    container.style.setProperty("--home-color", homeColor);
    container.style.setProperty("--away-color", awayColor);
}

function uiMatchEnded() {
    reelEnded = true;
}

// ---------- Kayıt aracının kullandığı arayüz ----------

let reelFrameCount = 0;

const reel = {
    ready: () => reelReady,

    // Maçı kurar; logoların yüklenmesini bekler ki ilk kareden itibaren görünsünler
    async start({ home, away, mode, competition, date }) {
        const comp = competitions.find(c => c.id === competition) || null;
        if (comp) {
            setFieldTheme(comp);
            $("reel-cup").src = `./img/${comp.badge}`;
            $("reel-competition").textContent = comp.name;
            $("intro-competition").textContent = comp.name;
        }
        $("reel-date").textContent = date || "";
        $("intro-home").textContent = teamData(home).name;
        $("intro-away").textContent = teamData(away).name;
        $("intro-home-badge").replaceWith(Object.assign(badge(home, "badge-lg"), { id: "intro-home-badge" }));
        $("intro-away-badge").replaceWith(Object.assign(badge(away, "badge-lg"), { id: "intro-away-badge" }));
        ratings = {};
        try {
            const data = await (await fetch("./json/ratings.json")).json();
            for (const [id, elo] of Object.entries(data.clubs || {})) ratings[id] = { elo, kind: "club" };
            for (const [id, elo] of Object.entries(data.national || {})) ratings[id] = { elo, kind: "national" };
        } catch (error) {
            // puansız: Classic gibi oynar
        }
        const images = [home, away].map(id => logoPath(teamData(id))).filter(Boolean).map(file => loadLogo(file).decode().catch(() => {}));
        await Promise.all(images);
        startGame(home, away, mode);
        // Logoların topa işlenmesi için bir an
        await new Promise(resolve => setTimeout(resolve, 150));
        render();
        return { home: team1.name, away: team2.name, mode: matchMode };
    },

    hideIntro() {
        $("reel-intro").hidden = true;
    },

    // Bir kare: 60 Hz motorda "steps" adım, sonra çizim
    frame(steps) {
        for (let i = 0; i < steps; i++) step();
        render();
        reelFrameCount++;
        return { state: gameState, ended: reelEnded, score: [score[0], score[1]] };
    },

    summary() {
        return { score: [score[0], score[1]], goals: matchGoals, events: reelEvents, home: team1.name, away: team2.name, mode: matchMode };
    }
};
