// Arayüz: takım seçici, skor tabelası, istatistikler, maç olayları ve maç sonu kartı.
// Oyun motoru (script.js) buradaki ui* fonksiyonlarını çağırır.

const $ = id => document.getElementById(id);

let selection = { category: "all", home: null, away: null };
let activeCompetition = null; // Oynanan maçın ligi (sonuç kartında yazar)

// Günün maçları her sabah GitHub Actions ile güncellenir; site dosyayı doğrudan GitHub'dan okur
const TODAY_URL = "https://raw.githubusercontent.com/cemerensenturk/rotascore/main/json/today.json";
let todayMatches = [];

// ---------- Kayıtlı seçim (bir sonraki ziyarette hatırlansın) ----------

function loadSelection() {
    try {
        const saved = JSON.parse(localStorage.getItem("rotascore-setup"));
        if (saved) Object.assign(selection, saved);
    } catch (error) {
        // localStorage yoksa ya da bozuksa varsayılanlarla devam
    }
}

function saveSelection() {
    try {
        localStorage.setItem("rotascore-setup", JSON.stringify(selection));
    } catch (error) {
        // yoksay
    }
}

// ---------- Yardımcılar ----------

function teamData(id) {
    return teamsDatabase[id];
}

function sortByName(ids) {
    return [...ids].sort((a, b) => teamData(a).name.localeCompare(teamData(b).name, "tr"));
}

function normalize(text) {
    return text.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
}

function currentCompetition() {
    return competitions.find(c => c.id === selection.category) || null;
}

// Veritabanımızdaki takımlar (günün maçlarından gelen geçici takımlar hariç)
function databaseTeams() {
    return Object.keys(teamsDatabase).filter(id => !teamsDatabase[id].external);
}

function categoryTeams() {
    const competition = currentCompetition();
    return competition ? competition.teams : databaseTeams();
}

// Bir takımın ait olduğu lig (arama sonuçlarında küçük etiket olarak gösterilir)
function leagueOf(id) {
    const league = competitions.find(c => (c.type === "league" || c.type === "national" || c.type === "others") && c.teams.includes(id));
    return league ? league.name : "";
}

// Logo, bayrak ya da (ikisi de yoksa) takım renklerinde baş harf
function teamBadge(id, className) {
    const data = teamData(id);
    const badge = document.createElement("span");
    badge.className = `badge ${className || ""}`;
    const file = logoPath(data);
    if (file) {
        const img = document.createElement("img");
        img.src = `./img/${file}`;
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        if (data.flag && !data.logo) badge.classList.add("is-flag");
        badge.appendChild(img);
    } else {
        badge.classList.add("is-initial");
        badge.style.background = `linear-gradient(${data.colors[0]} 50%, ${data.colors[1]} 50%)`;
        badge.textContent = data.initial;
    }
    return badge;
}

// ---------- Veriler yüklendi ----------

function onDataLoaded() {
    loadSelection();
    buildCategoryOptions();
    $("filter-category").value = selection.category;
    if ($("filter-category").value !== selection.category) selection.category = "all";
    applyCategory(selection.category);
    loadToday();
}

function buildCategoryOptions() {
    const select = $("filter-category");
    const groups = [
        { label: "Leagues", types: ["league", "others"] },
        { label: "Tournaments", types: ["national", "cup"] }
    ];
    for (const group of groups) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group.label;
        for (const competition of competitions) {
            if (group.types.includes(competition.type)) {
                optgroup.appendChild(new Option(competition.name, competition.id));
            }
        }
        select.appendChild(optgroup);
    }
}

function applyCategory(categoryId) {
    selection.category = categoryId;
    const ids = sortByName(categoryTeams());

    // Seçili takımlar bu ligde yoksa ligin ilk iki takımını seç
    if (!ids.includes(selection.home)) selection.home = ids[0];
    if (!ids.includes(selection.away) || selection.away === selection.home) {
        selection.away = ids.find(id => id !== selection.home) || ids[0];
    }

    saveSelection();
    renderPickButtons();
    setFieldTheme(currentCompetition());
}

function renderPickButtons() {
    for (const side of ["home", "away"]) {
        const button = $(`pick-${side}`);
        const id = selection[side];
        button.innerHTML = "";
        if (!id) continue;
        button.appendChild(teamBadge(id, "badge-md"));
        const text = document.createElement("span");
        text.className = "pick-text";
        text.innerHTML = `<small>${side === "home" ? "Home" : "Away"}</small>`;
        const name = document.createElement("strong");
        name.textContent = teamData(id).name;
        text.appendChild(name);
        button.appendChild(text);
        const file = logoPath(teamData(id));
        if (file) loadLogo(file); // maç başlamadan logoyu indir

        // Maç oynanmıyorsa skor tabelasında seçilen eşleşmeyi göster
        if (gameState === "idle" || gameState === "ended") {
            setScorebugTeam(side, id);
            $(`sb-${side}-score`).textContent = "0";
            $("sb-clock-text").textContent = "0'";
        }
    }
}

// ---------- Takım seçici ----------

let pickerSide = "home";

function openSheet(sheet) {
    sheet.hidden = false;
    document.body.classList.add("sheet-open");
}

function closeSheet(sheet) {
    sheet.hidden = true;
    if (!document.querySelector(".sheet:not([hidden])")) document.body.classList.remove("sheet-open");
}

function openPicker(side) {
    pickerSide = side;
    $("picker-title").textContent = side === "home" ? "Choose home team" : "Choose away team";
    $("picker-search").value = "";
    renderPickerList();
    openSheet($("picker"));
    // Telefonda klavye kendiliğinden açılmasın
    if (window.matchMedia("(pointer: fine)").matches) $("picker-search").focus();
}

function renderPickerList() {
    const query = normalize($("picker-search").value.trim());
    const list = $("picker-list");
    list.innerHTML = "";

    // Arama varsa tüm takımlarda, yoksa seçili ligde
    const ids = query
        ? sortByName(databaseTeams().filter(id => normalize(teamData(id).name).includes(query)))
        : sortByName(categoryTeams());

    if (ids.length === 0) {
        list.innerHTML = `<p class="empty">No team found</p>`;
        return;
    }

    const otherSide = pickerSide === "home" ? "away" : "home";
    for (const id of ids) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "team-option";
        option.dataset.id = id;
        if (id === selection[pickerSide]) option.classList.add("selected");
        option.appendChild(teamBadge(id, "badge-sm"));

        const name = document.createElement("span");
        name.className = "option-name";
        name.textContent = teamData(id).name;
        option.appendChild(name);

        const tag = document.createElement("span");
        tag.className = "option-tag";
        if (id === selection[otherSide]) tag.textContent = otherSide === "home" ? "Home" : "Away";
        else if (query) tag.textContent = leagueOf(id);
        option.appendChild(tag);

        list.appendChild(option);
    }
}

function pickTeam(id) {
    const otherSide = pickerSide === "home" ? "away" : "home";
    // Diğer taraftaki takım seçildiyse yer değiştir
    if (id === selection[otherSide]) selection[otherSide] = selection[pickerSide];
    selection[pickerSide] = id;
    saveSelection();
    renderPickButtons();
    closeSheet($("picker"));
}

// ---------- Maç başlıyor ----------

function kickOff(competition) {
    if (!selection.home || !selection.away) return;
    if (gameState !== "idle" && gameState !== "ended") return;
    activeCompetition = competition && competition.id ? competition : currentCompetition();
    Sound.unlock();
    closeSheet($("result"));
    startGame(selection.home, selection.away);

    // Mobilde saha görünmüyorsa sahaya kaydır
    const stage = $("stage").getBoundingClientRect();
    if (stage.top < 0 || stage.bottom > window.innerHeight) {
        $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function setScorebugTeam(side, id) {
    const logo = $(`sb-${side}-logo`);
    logo.innerHTML = "";
    logo.appendChild(teamBadge(id, "badge-xs"));
    $(`sb-${side}-abbr`).textContent = teamData(id).initial;
}

function uiMatchStarted() {
    setScorebugTeam("home", team1.id);
    setScorebugTeam("away", team2.id);
    $("sb-home-score").textContent = "0";
    $("sb-away-score").textContent = "0";
    $("timeline").innerHTML = "";
    $("kickoff-btn").disabled = true;
    $("kickoff-btn").textContent = "Live";
    $("match-stats").classList.add("has-match");
    setTicker(`${team1.name} vs ${team2.name}`);
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
    void span.offsetWidth; // animasyonu yeniden başlat
    span.classList.add("bump");
}

// ---------- Maç olayları ----------

const eventIcons = { goal: "⚽", save: "🧤", post: "🥅", added: "⏱", kickoff: "▶", halftime: "⏸", fulltime: "🏁" };

function eventText(event) {
    const team = event.team === null ? null : (event.team === 0 ? team1 : team2);
    switch (event.type) {
        case "goal": return `GOAL! ${team.name}${event.xg !== undefined ? ` · xG ${event.xg.toFixed(2)}` : ""}`;
        case "save": return event.great
            ? `What a save! Fingertips deny ${team.name}`
            : `Saved! ${team.name} denied by the keeper`;
        case "post": return `Off the post! ${team.name} so close`;
        case "added": return `${event.added} minute${event.added > 1 ? "s" : ""} added`;
        case "kickoff": return `Kick-off: ${team1.name} vs ${team2.name}${keeperFormText(event.keeperForm)}`;
        case "halftime": return `Half-time: ${score[0]} - ${score[1]}`;
        case "fulltime": return `Full-time: ${team1.name} ${score[0]} - ${score[1]} ${team2.name}`;
        default: return "";
    }
}

// Kalecinin o günkü formu: sadece belirgin iyi ya da kötü günlerde söylenir
function keeperFormText(form) {
    if (form >= 1.4) return " · Keeper in top form today";
    if (form <= 0.8) return " · Keeper looks shaky today";
    return "";
}

function setTicker(text) {
    const ticker = $("ticker");
    ticker.textContent = text;
    ticker.classList.remove("flash");
    void ticker.offsetWidth;
    ticker.classList.add("flash");
}

function uiEvent(event) {
    const text = eventText(event);
    setTicker(`${event.minute} ${text}`);
    uiClockChanged();

    const item = document.createElement("li");
    item.className = `event event-${event.type}`;
    if (event.team !== null) item.classList.add(event.team === 0 ? "is-home" : "is-away");
    item.innerHTML = `<span class="event-minute"></span><span class="event-icon">${eventIcons[event.type] || ""}</span><span class="event-text"></span>`;
    item.querySelector(".event-minute").textContent = event.minute;
    item.querySelector(".event-text").textContent = text;
    $("timeline").prepend(item);
}

// ---------- İstatistikler ----------

function uiStatsChanged() {
    if (!stats.length) return;
    const totalPressure = stats[0].pressure + stats[1].pressure || 1;
    const xg = value => value.toFixed(2);
    const percent = value => `${value}%`;
    const rows = [
        ["xG", stats[0].xg, stats[1].xg, xg],
        ["Shots", stats[0].shots, stats[1].shots],
        ["Shots on target", stats[0].onTarget, stats[1].onTarget],
        ["Woodwork", stats[0].posts, stats[1].posts],
        ["Pressure", Math.round(stats[0].pressure / totalPressure * 100), Math.round(stats[1].pressure / totalPressure * 100), percent]
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

function barColor(team) {
    return team.color[0] === "#FFFFFF" ? team.color[1] : team.color[0];
}

function colorDistance(a, b) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const [x, y] = [rgb(a), rgb(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// İki takımın rengi birbirine çok yakınsa deplasman takımı ikinci rengini kullanır
function matchColors() {
    const home = barColor(team1);
    let away = barColor(team2);
    if (colorDistance(home, away) < 120) {
        away = team2.color.find(color => colorDistance(home, color) >= 120) || "#CFD8DC";
    }
    return [home, away];
}

// ---------- Maç sonu kartı ----------

let resultBlob = null;
let resultUrl = null;

function uiMatchEnded() {
    $("kickoff-btn").disabled = false;
    $("kickoff-btn").textContent = "Kick off";
    // Son düdükten sonra kısa bir an bekle, sonra kartı göster
    setTimeout(async () => {
        if (gameState !== "ended") return;
        resultBlob = await buildResultCard();
        if (resultUrl) URL.revokeObjectURL(resultUrl);
        resultUrl = URL.createObjectURL(resultBlob);
        $("result-card").src = resultUrl;
        $("share-btn").hidden = !canShareFiles();
        openSheet($("result"));
    }, 1600);
}

function canShareFiles() {
    try {
        const file = new File([new Blob()], "test.png", { type: "image/png" });
        return !!(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (error) {
        return false;
    }
}

function resultFileName() {
    return `rotascore-${team1.id}-${team2.id}.png`.replace(/[^a-z0-9.-]/gi, "");
}

async function shareResult() {
    const file = new File([resultBlob], resultFileName(), { type: "image/png" });
    try {
        // Sadece resim paylaşılır: metin de eklenirse iPhone'da "Kopyala" ikisini birden kopyalıyor
        // ve WhatsApp'a iki ayrı gönderi olarak yapışıyor. Skor ve site adresi zaten kartın üstünde.
        await navigator.share({ files: [file] });
    } catch (error) {
        // Kullanıcı paylaşımı iptal ettiyse sorun değil
    }
}

function downloadResult() {
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = resultFileName();
    link.click();
}

// Metni verilen genişliğe sığana kadar küçültür
function fitFont(c, text, maxWidth, size, weight) {
    do {
        c.font = `${weight} ${size}px Inter, Arial, sans-serif`;
        size -= 2;
    } while (c.measureText(text).width > maxWidth && size > 12);
}

async function drawCardBadge(c, team, x, y, radius) {
    // Beyaz yuvarlak zemin, içinde logo (bayraksa yuvarlağı kaplar)
    c.save();
    c.shadowColor = "rgba(0, 0, 0, 0.4)";
    c.shadowBlur = 30;
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.fillStyle = "#FFFFFF";
    c.fill();
    c.restore();

    const file = logoPath(teamData(team.id));
    let image = null;
    if (file) {
        image = loadLogo(file);
        try {
            await image.decode();
        } catch (error) {
            image = null;
        }
    }

    c.save();
    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.clip();
    if (image && team.isFlag) {
        c.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
    } else if (image) {
        const size = radius * 1.35;
        c.drawImage(image, x - size / 2, y - size / 2, size, size);
    } else {
        c.fillStyle = team.color[0];
        c.fillRect(x - radius, y - radius, radius * 2, radius);
        c.fillStyle = team.color[1];
        c.fillRect(x - radius, y, radius * 2, radius);
        c.fillStyle = team.color.includes("#FFFFFF") ? "#000000" : "#FFFFFF";
        c.font = `800 ${radius * 0.55}px Inter, Arial, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(team.initial, x, y);
    }
    c.restore();

    c.beginPath();
    c.arc(x, y, radius, 0, Math.PI * 2);
    c.lineWidth = 10;
    c.strokeStyle = matchColors()[team.index];
    c.stroke();
}

async function buildResultCard() {
    const size = 1080;
    const card = document.createElement("canvas");
    card.width = size;
    card.height = size;
    const c = card.getContext("2d");
    try {
        await document.fonts.load("800 100px Inter");
    } catch (error) {
        // Font yüklenemezse Arial ile devam
    }

    // Arka plan: gece maçı
    const bg = c.createLinearGradient(0, 0, 0, size);
    bg.addColorStop(0, "#0b1220");
    bg.addColorStop(1, "#123b22");
    c.fillStyle = bg;
    c.fillRect(0, 0, size, size);

    // Silik saha çizgileri
    c.strokeStyle = "rgba(255, 255, 255, 0.06)";
    c.lineWidth = 4;
    c.beginPath();
    c.arc(size / 2, size / 2 + 40, 300, 0, Math.PI * 2);
    c.moveTo(0, size / 2 + 40);
    c.lineTo(size, size / 2 + 40);
    c.stroke();

    // Takım renklerinde iki yumuşak ışık
    const colors = matchColors();
    for (const [index, x] of [[0, 0], [1, size]]) {
        const glow = c.createRadialGradient(x, 420, 0, x, 420, 520);
        glow.addColorStop(0, `${colors[index]}55`);
        glow.addColorStop(1, `${colors[index]}00`);
        c.fillStyle = glow;
        c.fillRect(0, 0, size, size);
    }

    c.textAlign = "center";
    c.textBaseline = "middle";

    // Başlık
    c.fillStyle = "#6AD04A";
    c.font = "800 34px Inter, Arial, sans-serif";
    c.fillText("FULL-TIME", size / 2, 110);
    c.fillStyle = "rgba(255, 255, 255, 0.7)";
    c.font = "600 30px Inter, Arial, sans-serif";
    c.fillText(activeCompetition ? activeCompetition.name : "Friendly", size / 2, 160);

    // Logolar ve skor
    await drawCardBadge(c, team1, 250, 430, 140);
    await drawCardBadge(c, team2, size - 250, 430, 140);
    c.fillStyle = "#FFFFFF";
    c.font = "800 150px Inter, Arial, sans-serif";
    c.fillText(`${score[0]}-${score[1]}`, size / 2, 440);

    // Takım adları
    for (const [team, x] of [[team1, 250], [team2, size - 250]]) {
        c.fillStyle = "#FFFFFF";
        fitFont(c, team.name, 400, 42, 800);
        c.fillText(team.name, x, 625);
    }

    // Golleri atanlar (dakikalar)
    for (const [index, x] of [[0, 250], [1, size - 250]]) {
        const minutes = matchGoals.filter(g => g.team === index).map(g => g.minute);
        c.fillStyle = "rgba(255, 255, 255, 0.75)";
        c.font = "600 30px Inter, Arial, sans-serif";
        const lines = [];
        for (let i = 0; i < minutes.length; i += 4) lines.push(minutes.slice(i, i + 4).join("  "));
        lines.slice(0, 3).forEach((line, i) => c.fillText(`⚽ ${line}`, x, 685 + i * 42));
    }

    // İstatistik satırı
    const statsLine = [
        `xG ${stats[0].xg.toFixed(2)}-${stats[1].xg.toFixed(2)}`,
        `Shots on target ${stats[0].onTarget}-${stats[1].onTarget}`,
        `Woodwork ${stats[0].posts}-${stats[1].posts}`
    ].join("   ·   ");
    c.fillStyle = "rgba(255, 255, 255, 0.08)";
    roundRect(c, 90, 860, size - 180, 76, 38);
    c.fill();
    c.fillStyle = "rgba(255, 255, 255, 0.85)";
    fitFont(c, statsLine, size - 240, 30, 600);
    c.fillText(statsLine, size / 2, 899);

    // Alt bilgi: RotaScore logosu ve site adresi
    const brand = new Image();
    brand.src = "./img/favicon.png";
    try {
        await brand.decode();
        c.drawImage(brand, 84, 952, 116, 116);
    } catch (error) {
        c.font = "800 30px Inter, Arial, sans-serif";
        c.fillStyle = "#6AD04A";
        c.textAlign = "left";
        c.fillText("RotaScore", 90, 1010);
    }
    c.font = "600 26px Inter, Arial, sans-serif";
    c.fillStyle = "rgba(255, 255, 255, 0.6)";
    c.textAlign = "right";
    c.fillText("cemeren.dev/rotascore", size - 90, 1010);

    return new Promise(resolve => card.toBlob(resolve, "image/png"));
}

function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

// ---------- Günün maçları ----------

async function loadToday() {
    let data = null;
    // Önce GitHub'daki güncel dosya, olmazsa sitedeki kopya
    for (const url of [TODAY_URL, "./json/today.json"]) {
        try {
            const response = await fetch(url, { cache: "no-cache" });
            if (response.ok) {
                data = await response.json();
                break;
            }
        } catch (error) {
            // sıradaki kaynağı dene
        }
    }

    todayMatches = data ? data.matches.filter(m => competitions.some(c => c.id === m.competition)) : [];
    todayMatches.forEach(match => {
        match.home.id = match.home.id && teamsDatabase[match.home.id] ? match.home.id : addExternalTeam(match.home.name);
        match.away.id = match.away.id && teamsDatabase[match.away.id] ? match.away.id : addExternalTeam(match.away.name);
    });

    renderToday(data);
    $("today-count").textContent = todayMatches.length || "";

    // Bugün maç varsa ve kullanıcı en son takım seçimini kullanmadıysa "Today" açık gelsin
    let savedTab = null;
    try {
        savedTab = localStorage.getItem("rotascore-tab");
    } catch (error) {
        // yoksay
    }
    if (todayMatches.length && savedTab !== "teams") showTab("today", false);
}

// Veritabanımızda olmayan takım: logosuz, nötr renkli bir top olarak oynanır
function addExternalTeam(name) {
    const id = `ext-${normalize(name).replace(/[^a-z0-9]+/g, "-")}`;
    if (!teamsDatabase[id]) {
        const letters = normalize(name).replace(/[^a-z]/g, "").toUpperCase();
        teamsDatabase[id] = { name: name, initial: letters.slice(0, 3) || "???", colors: ["#3A4756", "#E8EEF5"], external: true };
    }
    return id;
}

function renderToday(data) {
    const list = $("today-list");
    list.innerHTML = "";

    if (data && data.date) {
        const date = new Date(`${data.date}T12:00:00`);
        $("today-date").textContent = date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    }

    if (!todayMatches.length) {
        list.innerHTML = `<p class="empty">No featured matches today</p>`;
        return;
    }

    // Her lig açılır kapanır bir grup; aynı anda tek grup açık, ilki açık gelir
    let currentLeague = null;
    let group = null;
    for (const match of todayMatches) {
        if (match.competition !== currentLeague) {
            currentLeague = match.competition;
            const section = document.createElement("details");
            section.className = "today-league";
            section.name = "today-league";
            section.open = !list.children.length;

            const heading = document.createElement("summary");
            const title = document.createElement("span");
            title.textContent = competitions.find(c => c.id === currentLeague).name;
            const count = document.createElement("span");
            count.className = "today-league-count";
            count.textContent = todayMatches.filter(m => m.competition === currentLeague).length;
            heading.append(title, count);

            group = document.createElement("div");
            group.className = "today-league-matches";
            section.append(heading, group);
            list.appendChild(section);
        }

        const fixture = document.createElement("button");
        fixture.type = "button";
        fixture.className = "fixture";
        fixture.addEventListener("click", () => playFixture(match));

        const teamsColumn = document.createElement("span");
        teamsColumn.className = "fixture-teams";
        for (const side of [match.home, match.away]) {
            const row = document.createElement("span");
            row.className = "fixture-team";
            row.appendChild(teamBadge(side.id, "badge-xxs"));
            const name = document.createElement("span");
            name.textContent = teamData(side.id).name;
            row.appendChild(name);
            teamsColumn.appendChild(row);
        }

        const play = document.createElement("span");
        play.className = "fixture-play";
        play.setAttribute("aria-hidden", "true");
        play.textContent = "▶";

        fixture.append(teamsColumn, play);
        fixture.setAttribute("aria-label", `Play ${teamData(match.home.id).name} vs ${teamData(match.away.id).name}`);
        group.appendChild(fixture);
    }
}

// Günün maçına dokununca o iki takımla maçı başlat
function playFixture(match) {
    if (gameState !== "idle" && gameState !== "ended") return;
    const competition = competitions.find(c => c.id === match.competition);

    // İki takım da o ligin listesindeyse lig seçimini de o lige çevir
    if (competition.teams.includes(match.home.id) && competition.teams.includes(match.away.id)) {
        selection.category = competition.id;
        $("filter-category").value = competition.id;
    }
    setFieldTheme(competition);

    selection.home = match.home.id;
    selection.away = match.away.id;
    saveSelection();
    renderPickButtons();
    kickOff(competition);
}

function showTab(name, remember) {
    for (const tab of ["teams", "today"]) {
        $(`tab-${tab}`).setAttribute("aria-selected", String(tab === name));
        $(`panel-${tab}`).hidden = tab !== name;
    }
    if (remember) {
        try {
            localStorage.setItem("rotascore-tab", name);
        } catch (error) {
            // yoksay
        }
    }
}

// ---------- Olay dinleyicileri ----------

$("tab-teams").addEventListener("click", () => showTab("teams", true));
$("tab-today").addEventListener("click", () => showTab("today", true));

$("filter-category").addEventListener("change", event => applyCategory(event.target.value));
$("pick-home").addEventListener("click", () => openPicker("home"));
$("pick-away").addEventListener("click", () => openPicker("away"));
$("kickoff-btn").addEventListener("click", () => kickOff());
$("rematch-btn").addEventListener("click", () => kickOff(activeCompetition));
$("share-btn").addEventListener("click", shareResult);
$("download-btn").addEventListener("click", downloadResult);

$("picker-search").addEventListener("input", renderPickerList);
$("picker-search").addEventListener("keydown", event => {
    if (event.key === "Enter") {
        const first = $("picker-list").querySelector(".team-option");
        if (first) pickTeam(first.dataset.id);
    }
});
$("picker-list").addEventListener("click", event => {
    const option = event.target.closest(".team-option");
    if (option) pickTeam(option.dataset.id);
});

for (const sheet of document.querySelectorAll(".sheet")) {
    sheet.addEventListener("click", event => {
        if (event.target.closest("[data-close]")) closeSheet(sheet);
    });
}
document.addEventListener("keydown", event => {
    if (event.key === "Escape") document.querySelectorAll(".sheet:not([hidden])").forEach(closeSheet);
});

const soundButton = $("sound-toggle");
function renderSoundButton() {
    soundButton.textContent = Sound.isMuted() ? "🔇" : "🔊";
    soundButton.setAttribute("aria-label", Sound.isMuted() ? "Unmute" : "Mute");
}
soundButton.addEventListener("click", () => {
    Sound.unlock();
    Sound.toggleMute();
    renderSoundButton();
});
renderSoundButton();
