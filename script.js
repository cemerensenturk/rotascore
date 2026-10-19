const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Simülasyon sabit 400x400'lük bir "dünya" koordinatında çalışır.
// Ekrandaki gerçek boyut ne olursa olsun çizim bu dünyaya ölçeklenir,
// böylece hızlar, mesafeler ve gol kontrolü her cihazda aynıdır.
const WORLD_SIZE = 400;
const CENTER = WORLD_SIZE / 2;
const FIELD_RADIUS = 180;   // Saha çemberi ve kalenin dönme mesafesi
const BALL_RADIUS = 30;
const BOUNCE_RADIUS = FIELD_RADIUS - BALL_RADIUS; // Topun kenarı çizgiye değince seker
const BADGE_RADIUS = 62;    // Sahanın ortasındaki lig logosu
const GOAL_WIDTH = 25;      // Kale derinliği
const GOAL_HEIGHT = 64;     // Kale ağzı (direkler arası)
const GOAL_SPEED = 0.8;     // Kalenin adım başına dönüşü (derece)
const KEEPER_SIZE = 20;     // Kalecinin boyu
const KEEPER_SPEED = 1.3;   // Kalecinin adım başına en fazla kayması (form 1.0'da)
const KEEPER_REACTION = 10; // Kaleci topu kaç adım geriden takip eder (10 adım = 0.17 sn, form 1.0'da)
const KEEPER_STRETCH = 20;  // Gövdenin ötesinde "parmak ucu" kurtarış bölgesi
const KEEPER_FORM_MIN = 0.5; // Kalecinin maçtan maça değişen formu: kötü gün ...
const KEEPER_FORM_MAX = 1.7; // ... iyi gün

// Hız: çarpıştıkça artar, MAX_SPEED'i geçemez; çarpışma olmadan
// sürtünmeyle yavaş yavaş BASE_SPEED'e iner. Birim: adım başına dünya birimi (60 adım = 1 sn)
const BASE_SPEED = 3.5;
const MAX_SPEED = 9.0;
const FRICTION = 0.992;     // Taban hızın üstündeki fazlalığın adım başına korunan oranı
const WALL_BOOST = 1.12;    // Duvara çarpınca hızlanma
const BALL_BOOST = 1.3;     // Toplar çarpışınca hızlanma
const SPIN_MAX = 0.02;      // Falso: adım başına en fazla dönüş (radyan)
const SPIN_DECAY = 0.985;
const TRAIL_LENGTH = 10;

// Fizik sabit 60Hz adımlarla ilerler; ekran kaç fps çizerse çizsin
// toplar gerçek zamanda aynı hızla hareket eder.
const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 5;
const MS_PER_MINUTE = 500;  // Bir maç dakikası = 0.5 sn
const COUNTDOWN_MS = 3000;
const GOAL_PAUSE_MS = 3000;
const HALFTIME_MS = 2500;

let team1 = { index: 0, history: [] };
let team2 = { index: 1, history: [] };
let goal = { x: CENTER + FIELD_RADIUS, y: CENTER, angle: 0, speed: GOAL_SPEED };
// Kaleci: kale ağzı boyunca konumu (kale merkezine göre), o maçki formu ve gecikmeli gördüğü top konumları
let keeper = { pos: 0, form: 1, seen: [] };
let score = [0, 0];
let goalParticles = [];
let collisionEffects = [];
let floatingTexts = [];
let confetti = [];
let celebration = null;     // { team, elapsed } gol kutlaması sürerken
let shakeAmount = 0;

// Maç saati: devre, dakika ve uzatma dakikaları
let clock = { half: 1, minute: 0, added: 0, extra: 0 };
// İstatistikler: şut, isabetli şut, direk, baskı (topun kaleye daha yakın olduğu adım sayısı)
let stats = [];
// Maçın olayları (gol, kurtarış, direk, devre arası...) ve goller
let matchEvents = [];
let matchGoals = [];

// "idle" | "countdown" | "playing" | "goalPause" | "halftime" | "ended"
let gameState = "idle";
let stateTimer = 0;
let minuteTimer = 0;
let pressureSteps = 0;

let loopRunning = false;
let lastFrameTime = 0;
let accumulator = 0;

// Ekran ölçeği ve önceden çizilmiş katmanlar
let renderScale = 1;
let fieldLayer = null;
let fieldBadge = null;      // { image, background, scale } sahanın ortasındaki lig logosu

// Takımlar (json/teams.json) ve bu sezonun lig/turnuva listeleri (json/competitions.json)
let teamsDatabase = {};
let competitions = [];

async function loadJson(file) {
    const response = await fetch(`./json/${file}`);
    if (!response.ok) throw new Error(`${file} yüklenemedi: ${response.status}`);
    return response.json();
}

async function loadAllTeams() {
    const [teams, season] = await Promise.all([loadJson("teams.json"), loadJson("competitions.json")]);
    teamsDatabase = teams;
    competitions = season.competitions;

    // "others": hiçbir lige ya da milli takım turnuvasına yazılmamış kulüpler
    const placed = new Set();
    for (const competition of competitions) {
        if (competition.type === "league" || competition.type === "national") {
            competition.teams.forEach(id => placed.add(id));
        }
    }
    for (const competition of competitions) {
        if (competition.type === "others") {
            competition.teams = Object.keys(teamsDatabase).filter(id => !placed.has(id));
        }
    }

    // competitions.json'da yazım hatası varsa konsolda göster
    for (const competition of competitions) {
        const unknown = competition.teams.filter(id => !teamsDatabase[id]);
        if (unknown.length > 0) {
            console.warn(`${competition.name}: teams.json'da olmayan takımlar:`, unknown);
            competition.teams = competition.teams.filter(id => teamsDatabase[id]);
        }
    }

    onDataLoaded();
}

function setSpeed(team, speed) {
    const current = Math.hypot(team.dx, team.dy) || 1;
    const clamped = Math.min(MAX_SPEED, Math.max(BASE_SPEED * 0.8, speed));
    team.dx = (team.dx / current) * clamped;
    team.dy = (team.dy / current) * clamped;
}

function rotateVelocity(team, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = team.dx;
    team.dx = dx * cos - team.dy * sin;
    team.dy = dx * sin + team.dy * cos;
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

// İki açı arasındaki en kısa fark (radyan, 0..PI)
function angleDifference(a, b) {
    const diff = Math.abs(a - b) % (Math.PI * 2);
    return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

// ---------- Takımlar ve logolar ----------

const logoCache = {};

// Kulüpler img/logos, milli takımlar img/flags klasöründen
function logoPath(data) {
    if (data.logo) return `logos/${data.logo}`;
    if (data.flag) return `flags/${data.flag}`;
    return null;
}

function loadLogo(file) {
    if (!logoCache[file]) {
        logoCache[file] = new Image();
        logoCache[file].src = `./img/${file}`;
    }
    return logoCache[file];
}

function setupTeam(team, teamId) {
    const data = teamsDatabase[teamId];
    team.id = teamId;
    team.name = data.name;
    team.color = data.colors;
    team.initial = data.initial;
    team.logoImage = null;
    team.isFlag = !data.logo && !!data.flag;
    team.sprite = createBallSprite(team);

    // Logo/bayrak varsa yüklenince topu onunla çiz; yüklenemezse renkli top kalır
    const file = logoPath(data);
    if (file) {
        const image = loadLogo(file);
        image.decode().then(() => {
            if (team.id !== teamId) return; // bu arada takım değiştiyse
            team.logoImage = image;
            team.sprite = createBallSprite(team);
            if (!loopRunning) render();
        }).catch(() => {});
    }
}

// ---------- Maç akışı ----------

function startGame(homeId, awayId) {
    if (gameState !== "idle" && gameState !== "ended") return;
    if (!teamsDatabase[homeId] || !teamsDatabase[awayId]) return;

    setupTeam(team1, homeId);
    setupTeam(team2, awayId);

    score = [0, 0];
    clock = { half: 1, minute: 0, added: 0, extra: 0 };
    stats = [newStats(), newStats()];
    matchEvents = [];
    matchGoals = [];
    minuteTimer = 0;
    pressureSteps = 0;
    goalParticles = [];
    collisionEffects = [];
    floatingTexts = [];
    confetti = [];
    celebration = null;
    shakeAmount = 0;

    keeper.form = randomBetween(KEEPER_FORM_MIN, KEEPER_FORM_MAX);
    resetPositions();
    gameState = "countdown";
    stateTimer = COUNTDOWN_MS;
    Sound.startCrowd();
    uiMatchStarted();
    startLoop();
}

function newStats() {
    return { shots: 0, onTarget: 0, posts: 0, pressure: 0 };
}

function clockLabel() {
    return clock.extra > 0 ? `${clock.minute}+${clock.extra}'` : `${clock.minute}'`;
}

function addEvent(type, team, details) {
    const event = { type: type, team: team ? team.index : null, minute: clockLabel(), ...details };
    if (type === "added") event.added = clock.added;
    matchEvents.push(event);
    uiEvent(event);
}

function tickClock() {
    const halfEnd = clock.half === 1 ? 45 : 90;
    if (clock.minute < halfEnd) {
        clock.minute++;
        if (clock.minute === halfEnd) {
            // Uzatma dakikaları: ilk yarı 1-3, ikinci yarı 2-5
            clock.added = clock.half === 1 ? Math.ceil(randomBetween(0, 3)) : Math.ceil(randomBetween(1, 5));
            addEvent("added");
        }
    } else if (clock.extra < clock.added) {
        clock.extra++;
    } else {
        endHalf();
        return;
    }
    uiClockChanged();
}

function endHalf() {
    if (clock.half === 1) {
        gameState = "halftime";
        stateTimer = HALFTIME_MS;
        addEvent("halftime");
        Sound.whistle("half");
    } else {
        gameState = "ended";
        stateTimer = 0;
        addEvent("fulltime");
        Sound.whistle("end");
        Sound.stopCrowd();
        uiMatchEnded();
    }
    uiClockChanged();
}

function startSecondHalf() {
    clock = { half: 2, minute: 45, added: 0, extra: 0 };
    minuteTimer = 0;
    resetPositions();
    gameState = "playing";
    Sound.whistle("start");
    uiClockChanged();
}

// ---------- Ekran boyutu ve retina ----------

function resizeCanvas() {
    const cssSize = Math.min(window.innerWidth - 32, WORLD_SIZE); // kenar boşluğu + çerçeve
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);

    renderScale = canvas.width / WORLD_SIZE;

    fieldLayer = createFieldLayer();
    if (team1.color) team1.sprite = createBallSprite(team1);
    if (team2.color) team2.sprite = createBallSprite(team2);

    // Canvas boyutu değişince içeriği silinir, döngü durmuşsa yeniden çiz
    if (!loopRunning) render();
}

// Dünya birimiyle çizilen ekran dışı bir canvas oluşturur
function createLayer(worldSize) {
    const layer = document.createElement("canvas");
    const pixels = Math.ceil(worldSize * renderScale);
    layer.width = pixels;
    layer.height = pixels;
    const layerCtx = layer.getContext("2d");
    layerCtx.scale(pixels / worldSize, pixels / worldSize);
    return { canvas: layer, ctx: layerCtx, size: worldSize };
}

// Lige göre sahanın ortasındaki logo (competitions.json: badge, badgeBg, badgeScale).
// Lig seçilmemişse RotaScore logosu.
function setFieldTheme(competition) {
    const theme = competition || { badge: "favicon.png", badgeScale: 1 };
    const image = new Image();
    image.src = `./img/${theme.badge}`;
    image.decode().then(() => {
        fieldBadge = { image: image, background: theme.badgeBg || null, scale: theme.badgeScale || 0.78 };
        fieldLayer = createFieldLayer();
        if (!loopRunning) render();
    }).catch(() => {});
}

// Saha (çim, çizgiler, lig logosu) hiç değişmediği için bir kere çizilir
function createFieldLayer() {
    const layer = createLayer(WORLD_SIZE);
    const c = layer.ctx;

    c.save();
    c.beginPath();
    c.arc(CENTER, CENTER, WORLD_SIZE / 2, 0, Math.PI * 2);
    c.clip();

    // Çim: ışıklandırılmış gece maçı havası
    const grass = c.createRadialGradient(CENTER, CENTER - 40, 20, CENTER, CENTER, WORLD_SIZE / 2);
    grass.addColorStop(0, "#3d8a36");
    grass.addColorStop(1, "#1c4a20");
    c.fillStyle = grass;
    c.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);

    // Biçilmiş çim şeritleri
    c.fillStyle = "rgba(255, 255, 255, 0.045)";
    for (let y = 0; y < WORLD_SIZE; y += 50) {
        c.fillRect(0, y, WORLD_SIZE, 25);
    }

    // Orta çizgi ve orta yuvarlak
    c.strokeStyle = "rgba(255, 255, 255, 0.55)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(CENTER - FIELD_RADIUS, CENTER);
    c.lineTo(CENTER - BADGE_RADIUS - 8, CENTER);
    c.moveTo(CENTER + BADGE_RADIUS + 8, CENTER);
    c.lineTo(CENTER + FIELD_RADIUS, CENTER);
    c.stroke();
    c.beginPath();
    c.arc(CENTER, CENTER, BADGE_RADIUS + 8, 0, Math.PI * 2);
    c.stroke();

    // Kenarlara doğru kararma
    const vignette = c.createRadialGradient(CENTER, CENTER, 120, CENTER, CENTER, WORLD_SIZE / 2);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.35)");
    c.fillStyle = vignette;
    c.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    c.restore();

    // Lig logosu
    if (fieldBadge) {
        const image = fieldBadge.image;
        c.save();
        c.beginPath();
        c.arc(CENTER, CENTER, BADGE_RADIUS, 0, Math.PI * 2);
        c.clip();
        if (fieldBadge.background) {
            c.fillStyle = fieldBadge.background;
            c.fillRect(CENTER - BADGE_RADIUS, CENTER - BADGE_RADIUS, BADGE_RADIUS * 2, BADGE_RADIUS * 2);
        }
        // Logo, en-boy oranı korunarak yuvarlağın ortasına sığdırılır
        const box = BADGE_RADIUS * 2 * fieldBadge.scale;
        const ratio = Math.min(box / image.naturalWidth, box / image.naturalHeight);
        const width = image.naturalWidth * ratio;
        const height = image.naturalHeight * ratio;
        c.drawImage(image, CENTER - width / 2, CENTER - height / 2, width, height);
        c.restore();
    }

    // Saha sınırı, hafif parlamayla
    c.shadowBlur = 12;
    c.shadowColor = "rgba(160, 255, 200, 0.8)";
    c.beginPath();
    c.arc(CENTER, CENTER, FIELD_RADIUS, 0, Math.PI * 2);
    c.strokeStyle = "rgba(255, 255, 255, 0.85)";
    c.lineWidth = 3;
    c.stroke();
    return layer;
}

function getGlowColor(colors) {
    let glow = colors[0] !== "#FFFFFF" ? colors[0] : (colors[1] !== "#000000" ? colors[1] : "#00FFFF");
    if (glow === "#000000") glow = "#FF00FF"; // fallback for pure black teams
    return glow;
}

// Top, neon parlaması ve harfiyle (ya da logosuyla) birlikte bir kere çizilir; her karede sadece kopyalanır
function createBallSprite(team) {
    const colors = team.color;
    const padding = 20; // Parlama için boşluk
    const layer = createLayer((BALL_RADIUS + padding) * 2);
    const c = layer.ctx;
    const mid = layer.size / 2;

    c.shadowBlur = 15;
    c.shadowColor = getGlowColor(colors);

    // Üst yarıyı çiz
    c.beginPath();
    c.arc(mid, mid, BALL_RADIUS, 0, Math.PI, true);
    c.fillStyle = colors[0];
    c.fill();

    // Alt yarıyı çiz
    c.beginPath();
    c.arc(mid, mid, BALL_RADIUS, Math.PI, 2 * Math.PI, true);
    c.fillStyle = colors[1];
    c.fill();
    c.shadowBlur = 0;

    if (team.logoImage && team.isFlag) {
        // Bayrak topun tamamını kaplar
        c.save();
        c.beginPath();
        c.arc(mid, mid, BALL_RADIUS, 0, Math.PI * 2);
        c.clip();
        c.drawImage(team.logoImage, mid - BALL_RADIUS, mid - BALL_RADIUS, BALL_RADIUS * 2, BALL_RADIUS * 2);
        c.restore();
        c.beginPath();
        c.arc(mid, mid, BALL_RADIUS - 1, 0, Math.PI * 2);
        c.strokeStyle = "rgba(255, 255, 255, 0.9)";
        c.lineWidth = 2;
        c.stroke();
        return layer;
    }

    if (team.logoImage) {
        // Takım renkleri dışta halka olarak kalır, logo beyaz zeminin ortasında
        const inner = BALL_RADIUS - 5;
        c.beginPath();
        c.arc(mid, mid, inner, 0, Math.PI * 2);
        c.fillStyle = "#FFFFFF";
        c.fill();

        const logoSize = inner * 1.5;
        c.drawImage(team.logoImage, mid - logoSize / 2, mid - logoSize / 2, logoSize, logoSize);
        return layer;
    }

    // Harfi çiz
    c.fillStyle = colors.includes("#FFFFFF") ? "black" : "white";
    c.font = `bold ${BALL_RADIUS * 0.6}px Arial`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(team.initial, mid, mid);

    return layer;
}

// ---------- Çizim ----------

function drawTrail(team) {
    const length = team.history.length;
    if (length < 2) return;
    ctx.fillStyle = team.color[0];
    for (let i = 0; i < length; i++) {
        const t = i / length;
        ctx.globalAlpha = 0.8 * (1 - t);
        ctx.beginPath();
        ctx.arc(team.history[i].x, team.history[i].y, BALL_RADIUS * (1 - t * 0.6), 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawBall(team) {
    const sprite = team.sprite;
    const half = sprite.size / 2;
    ctx.drawImage(sprite.canvas, team.x - half, team.y - half, sprite.size, sprite.size);
}

function drawTeams() {
    drawTrail(team1);
    drawTrail(team2);
    drawBall(team1);
    drawBall(team2);
}

function drawGoal() {
    ctx.save();
    ctx.translate(goal.x, goal.y);

    // Kalenin açısını, merkeze bakacak şekilde ayarla
    ctx.rotate(Math.atan2(CENTER - goal.y, CENTER - goal.x));

    // Kalenin arka plan kısmı (ağ etkisi)
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillRect(-GOAL_WIDTH / 2, -GOAL_HEIGHT / 2, GOAL_WIDTH, GOAL_HEIGHT);

    // Direkler
    ctx.fillStyle = "white";
    ctx.fillRect(-GOAL_WIDTH / 2, -GOAL_HEIGHT / 2, GOAL_WIDTH, 3);
    ctx.fillRect(-GOAL_WIDTH / 2, -GOAL_HEIGHT / 2, 3, GOAL_HEIGHT);
    ctx.fillRect(-GOAL_WIDTH / 2, GOAL_HEIGHT / 2 - 3, GOAL_WIDTH, 3);

    // Kaleci (kale çizgisinde, topa doğru kayar)
    ctx.fillStyle = "#FFD400";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(GOAL_WIDTH / 2 - 8, keeper.pos - KEEPER_SIZE / 2, 7, KEEPER_SIZE);
    ctx.strokeRect(GOAL_WIDTH / 2 - 8, keeper.pos - KEEPER_SIZE / 2, 7, KEEPER_SIZE);

    ctx.restore();
}

function drawEffects() {
    if (collisionEffects.length > 0) {
        ctx.beginPath();
        for (const effect of collisionEffects) {
            ctx.moveTo(effect.x + effect.radius, effect.y);
            ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        }
        ctx.strokeStyle = "rgba(255,204,0,0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Gol parçacıkları: gölge yerine arkasına büyük yarı saydam bir hale çizilir
    for (const p of goalParticles) {
        const alpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha * 0.3;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
    }

    // "SAVE!", "POST!" yazıları
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    for (const t of floatingTexts) {
        ctx.globalAlpha = Math.max(0, t.alpha);
        ctx.fillStyle = t.color;
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
}

// Sahayı karartıp ortaya büyük bir yazı (ve altına küçük bir satır) yazar
function drawBanner(title, subtitle, scale) {
    ctx.fillStyle = "rgba(5, 10, 18, 0.45)";
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, WORLD_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(CENTER, CENTER - (subtitle ? 10 : 0));
    ctx.scale(scale, scale);
    ctx.font = "800 46px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.strokeText(title, 0, 0);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(title, 0, 0);
    ctx.restore();

    if (subtitle) {
        ctx.font = "600 18px Inter, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
        ctx.fillText(subtitle, CENTER, CENTER + 30);
    }
}

function drawCelebration() {
    const t = celebration.elapsed / 1000;
    const team = celebration.team;

    // Takım renginde kısa bir flaş
    if (t < 0.5) {
        ctx.globalAlpha = 0.35 * (1 - t / 0.5);
        ctx.fillStyle = team.color[0] === "#FFFFFF" ? team.color[1] : team.color[0];
        ctx.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
        ctx.globalAlpha = 1;
    }

    // Konfeti
    for (const piece of confetti) {
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
        ctx.restore();
    }

    // "GOAL!" yazısı büyükten oturur, altında golü atan takımın topu
    const pop = t < 0.3 ? 1.8 - (t / 0.3) * 0.8 : 1;
    ctx.save();
    ctx.translate(CENTER, CENTER - 24);
    ctx.scale(pop, pop);
    ctx.font = "800 64px Inter, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeText("GOAL!", 0, 0);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("GOAL!", 0, 0);
    ctx.restore();

    if (t > 0.25) {
        const sprite = team.sprite;
        const size = sprite.size * 0.9;
        ctx.globalAlpha = Math.min(1, (t - 0.25) / 0.3);
        ctx.drawImage(sprite.canvas, CENTER - size / 2, CENTER + 42 - size / 2, size, size);
        ctx.globalAlpha = 1;
    }
}

function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);

    if (shakeAmount > 0) {
        ctx.translate((Math.random() - 0.5) * shakeAmount, (Math.random() - 0.5) * shakeAmount);
    }

    if (fieldLayer) ctx.drawImage(fieldLayer.canvas, 0, 0, WORLD_SIZE, WORLD_SIZE);
    if (gameState === "idle") return;

    drawGoal();
    drawTeams();
    drawEffects();

    if (gameState === "countdown") {
        const remaining = Math.ceil(stateTimer / 1000);
        const fraction = (stateTimer % 1000) / 1000;
        drawBanner(String(remaining), "Get ready", 0.8 + fraction * 0.5);
    } else if (gameState === "goalPause" && celebration) {
        drawCelebration();
    } else if (gameState === "halftime") {
        drawBanner("HALF-TIME", `${team1.initial} ${score[0]} - ${score[1]} ${team2.initial}`, 1);
    } else if (gameState === "ended" && !goalParticles.length) {
        drawBanner("FULL-TIME", `${team1.initial} ${score[0]} - ${score[1]} ${team2.initial}`, 1);
    }
}

// ---------- Simülasyon ----------

function step() {
    if (gameState === "countdown") {
        stateTimer -= STEP_MS;
        if (stateTimer <= 0) {
            gameState = "playing";
            Sound.whistle("start");
            addEvent("kickoff", null, { keeperForm: keeper.form });
        }
    } else if (gameState === "playing") {
        updatePositions();
        if (gameState !== "playing") return; // gol oldu

        updatePressure();
        minuteTimer += STEP_MS;
        if (minuteTimer >= MS_PER_MINUTE) {
            minuteTimer -= MS_PER_MINUTE;
            tickClock();
        }
    } else if (gameState === "goalPause") {
        stateTimer -= STEP_MS;
        if (celebration) celebration.elapsed += STEP_MS;
        if (stateTimer <= 0) {
            celebration = null;
            confetti = [];
            resetPositions();
            gameState = "playing";
        }
    } else if (gameState === "halftime") {
        stateTimer -= STEP_MS;
        if (stateTimer <= 0) startSecondHalf();
    }

    updateEffects();
}

// Top kaleye hangi takımınki daha yakınsa baskı o takımda
function updatePressure() {
    const d1 = Math.hypot(team1.x - goal.x, team1.y - goal.y);
    const d2 = Math.hypot(team2.x - goal.x, team2.y - goal.y);
    stats[d1 < d2 ? 0 : 1].pressure++;
    if (++pressureSteps % 30 === 0) uiStatsChanged();
}

function updatePositions() {
    for (const team of [team1, team2]) {
        team.history.unshift({ x: team.x, y: team.y });
        if (team.history.length > TRAIL_LENGTH) team.history.pop();

        // Falso: top kavis çizerek ilerler, falso giderek azalır
        if (team.spin) {
            rotateVelocity(team, team.spin);
            team.spin *= SPIN_DECAY;
        }

        // Sürtünme: taban hızın üstündeki fazlalık yavaş yavaş erir
        const speed = Math.hypot(team.dx, team.dy);
        setSpeed(team, BASE_SPEED + (speed - BASE_SPEED) * FRICTION);

        team.x += team.dx;
        team.y += team.dy;

        // Top kenara değdi mi?
        const distanceToCenter = Math.hypot(team.x - CENTER, team.y - CENTER);
        if (distanceToCenter < BOUNCE_RADIUS) continue;

        const nx = (team.x - CENTER) / distanceToCenter;
        const ny = (team.y - CENTER) / distanceToCenter;
        const hitX = CENTER + nx * FIELD_RADIUS;
        const hitY = CENTER + ny * FIELD_RADIUS;

        const result = checkGoalHit(hitX, hitY);
        if (result) {
            stats[team.index].shots++;
            if (result !== "post") stats[team.index].onTarget++;
            else stats[team.index].posts++;
            uiStatsChanged();
        }

        if (result === "goal") {
            // Topu ağlara yerleştir
            team.x = CENTER + nx * (FIELD_RADIUS - BALL_RADIUS * 0.5);
            team.y = CENTER + ny * (FIELD_RADIUS - BALL_RADIUS * 0.5);
            scoreGoal(team);
            return;
        }

        bounceOffWall(team, nx, ny);
        team.x = CENTER + nx * (BOUNCE_RADIUS - 1);
        team.y = CENTER + ny * (BOUNCE_RADIUS - 1);

        if (result === "save" || result === "great-save") {
            addFloatingText("SAVE!", hitX, hitY, "#FFD400");
            addCollisionEffect(hitX, hitY, "ball");
            addEvent("save", team, { great: result === "great-save" });
            Sound.swell(result === "great-save" ? 0.06 : 0.03, 1);
        } else if (result === "post") {
            addFloatingText("POST!", hitX, hitY, "#FFFFFF");
            addCollisionEffect(hitX, hitY, "ball");
            shakeAmount = Math.max(shakeAmount, 4);
            addEvent("post", team);
            Sound.tick(2.5);
            Sound.swell(0.05, 1.2);
        } else {
            addCollisionEffect(hitX, hitY, "wall");
        }
    }

    handleCollision(team1, team2);

    // Kale saha çemberi üzerinde dönüyor, kaleci topu takip ediyor
    goal.angle = (goal.angle + goal.speed) % 360;
    updateGoalPosition();
    updateKeeper();
}

function bounceOffWall(team, nx, ny) {
    const dot = team.dx * nx + team.dy * ny;
    if (dot <= 0) return;

    // Yansıt
    team.dx -= 2 * dot * nx;
    team.dy -= 2 * dot * ny;

    // Yönü rastgele saptır ki top hep aynı yolları çizmesin (sahanın içine doğru kalarak)
    const speed = Math.hypot(team.dx, team.dy);
    const deflection = randomBetween(-0.6, 0.6);
    rotateVelocity(team, deflection);
    if (team.dx * nx + team.dy * ny > -0.3 * speed) {
        rotateVelocity(team, -2 * deflection);
    }

    team.spin = randomBetween(-SPIN_MAX, SPIN_MAX);
    setSpeed(team, speed * WALL_BOOST);
}

// Kale ekseninde bir noktanın kale merkezine göre yan konumu
function offsetAlongGoal(x, y) {
    const radian = (goal.angle * Math.PI) / 180;
    return (x - goal.x) * Math.sin(radian) - (y - goal.y) * Math.cos(radian);
}

// Top duvara (hitX, hitY) noktasında çarptı: gol mü, kurtarış mı, direk mi?
function checkGoalHit(hitX, hitY) {
    const hitAngle = Math.atan2(hitY - CENTER, hitX - CENTER);
    const goalAngle = (goal.angle * Math.PI) / 180;
    const reach = (GOAL_HEIGHT / 2 + BALL_RADIUS) / FIELD_RADIUS;
    if (angleDifference(hitAngle, goalAngle) > reach) return null;

    const offset = offsetAlongGoal(hitX, hitY);
    if (Math.abs(offset) < GOAL_HEIGHT / 2) {
        // Top kalecinin gövdesine gelirse büyük ihtimalle kurtarılır, kenarına gelirse
        // parmak uçlarıyla kurtarılma şansı uzaklaştıkça azalır. Formu iyi kaleci daha geniş alanı kapatır.
        const distance = Math.abs(offset - keeper.pos);
        const body = (KEEPER_SIZE / 2 + BALL_RADIUS * 0.35) * keeper.form;
        const stretch = body + KEEPER_STRETCH * keeper.form;
        if (distance < body) return Math.random() < 0.92 ? "save" : "goal";
        if (distance < stretch && Math.random() < 0.6 * (1 - (distance - body) / (stretch - body))) return "great-save";
        return "goal";
    }
    if (Math.abs(offset) < GOAL_HEIGHT / 2 + BALL_RADIUS * 0.25) return "post";
    return null;
}

function updateKeeper() {
    // Kaleye en yakın topu takip et
    const nearest = [team1, team2].reduce((a, b) =>
        Math.hypot(a.x - goal.x, a.y - goal.y) < Math.hypot(b.x - goal.x, b.y - goal.y) ? a : b);
    // Kaleci topu biraz geriden görür (tepki süresi); formu iyiyse daha çabuk tepki verir ve daha hızlı kayar
    keeper.seen.push(offsetAlongGoal(nearest.x, nearest.y));
    const delay = Math.round(KEEPER_REACTION / keeper.form);
    while (keeper.seen.length > delay + 1) keeper.seen.shift();

    const limit = (GOAL_HEIGHT - KEEPER_SIZE) / 2;
    const target = Math.max(-limit, Math.min(limit, keeper.seen[0]));
    const speed = KEEPER_SPEED * keeper.form;
    keeper.pos += Math.max(-speed, Math.min(speed, target - keeper.pos));
}

function updateGoalPosition() {
    let radian = (goal.angle * Math.PI) / 180;
    goal.x = CENTER + Math.cos(radian) * FIELD_RADIUS;
    goal.y = CENTER + Math.sin(radian) * FIELD_RADIUS;
}

function scoreGoal(team) {
    score[team.index]++;
    matchGoals.push({ team: team.index, minute: clockLabel() });
    addEvent("goal", team);
    uiScoreChanged(team.index);

    Sound.goal();

    shakeAmount = 15;
    createGoalExplosion(goal.x, goal.y, team.color);
    createConfetti(team.color);
    celebration = { team: team, elapsed: 0 };

    // Kutlamadan sonra oyun devam eder (step içinde)
    gameState = "goalPause";
    stateTimer = GOAL_PAUSE_MS;
}

function updateEffects() {
    for (let i = collisionEffects.length - 1; i >= 0; i--) {
        let effect = collisionEffects[i];
        effect.radius += 0.7;
        effect.alpha -= 0.05;
        if (effect.alpha <= 0) collisionEffects.splice(i, 1);
    }

    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const t = floatingTexts[i];
        t.y -= 0.6;
        t.alpha -= 0.02;
        if (t.alpha <= 0) floatingTexts.splice(i, 1);
    }

    for (let i = goalParticles.length - 1; i >= 0; i--) {
        let p = goalParticles[i];
        p.x += p.dx;
        p.y += p.dy;
        p.life -= p.decay;
        if (p.life <= 0) goalParticles.splice(i, 1);
    }

    for (const piece of confetti) {
        piece.x += piece.dx + Math.sin(piece.y * 0.05) * 0.4;
        piece.y += piece.dy;
        piece.rotation += piece.spin;
    }

    if (shakeAmount > 0) {
        shakeAmount *= 0.9;
        if (shakeAmount < 0.5) shakeAmount = 0;
    }
}

function resetPositions() {
    team1.history = [];
    team2.history = [];

    // Toplar sahanın farklı yerlerinden, farklı yönlere başlar
    placeRandomly(team1, Math.PI);
    do {
        placeRandomly(team2, 0);
    } while (Math.hypot(team1.x - team2.x, team1.y - team2.y) < BALL_RADIUS * 2 + 10);

    goal.angle = Math.random() * 360;
    updateGoalPosition();
    keeper.pos = 0;
    keeper.seen = [];
}

// Topu sahanın bir yarısında rastgele bir noktaya koyar ve rastgele bir yöne gönderir
function placeRandomly(team, sideAngle) {
    const angle = sideAngle + randomBetween(-1.2, 1.2);
    const distance = randomBetween(20, 100);
    team.x = CENTER + Math.cos(angle) * distance;
    team.y = CENTER + Math.sin(angle) * distance;

    const direction = Math.random() * Math.PI * 2;
    const speed = randomBetween(BASE_SPEED, BASE_SPEED * 1.6);
    team.dx = Math.cos(direction) * speed;
    team.dy = Math.sin(direction) * speed;
    team.spin = randomBetween(-SPIN_MAX, SPIN_MAX);
}

function addFloatingText(text, x, y, color) {
    // Yazı sahanın biraz içinde çıksın
    floatingTexts.push({
        text: text,
        x: CENTER + (x - CENTER) * 0.75,
        y: CENTER + (y - CENTER) * 0.75,
        alpha: 1.0,
        color: color
    });
}

function addCollisionEffect(x, y, type) {
    collisionEffects.push({
        x: x,
        y: y,
        radius: type === "wall" ? 5 : 10,
        alpha: 1.0
    });
}

function createGoalExplosion(x, y, colors) {
    for (let i = 0; i < 40; i++) {
        goalParticles.push({
            x: x,
            y: y,
            dx: (Math.random() - 0.5) * 10,
            dy: (Math.random() - 0.5) * 10,
            radius: Math.random() * 4 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            life: 1.0,
            decay: Math.random() * 0.03 + 0.01
        });
    }
}

// Takım renklerinde, yukarıdan yağan konfeti
function createConfetti(colors) {
    const palette = [...colors, "#FFFFFF"];
    confetti = [];
    for (let i = 0; i < 70; i++) {
        confetti.push({
            x: Math.random() * WORLD_SIZE,
            y: -Math.random() * 200,
            dx: randomBetween(-0.6, 0.6),
            dy: randomBetween(1.8, 3.6),
            w: randomBetween(4, 7),
            h: randomBetween(8, 12),
            rotation: Math.random() * Math.PI,
            spin: randomBetween(-0.15, 0.15),
            color: palette[i % palette.length]
        });
    }
}

function handleCollision(ball1, ball2) {
    const dx = ball2.x - ball1.x;
    const dy = ball2.y - ball1.y;
    const distance = Math.hypot(dx, dy) || 0.01;
    const minDistance = BALL_RADIUS * 2;
    if (distance >= minDistance) return;

    const nx = dx / distance;
    const ny = dy / distance;

    // Topları birbirinden uzaklaştır (çakışmayı önle)
    const overlap = (minDistance - distance) / 2;
    ball1.x -= nx * overlap;
    ball1.y -= ny * overlap;
    ball2.x += nx * overlap;
    ball2.y += ny * overlap;

    // Sadece birbirlerine yaklaşıyorlarsa çarpıştır (bilardo gibi)
    const approach = (ball2.dx - ball1.dx) * nx + (ball2.dy - ball1.dy) * ny;
    if (approach >= 0) return;

    // Eşit kütleli esnek çarpışma: çarpışma doğrultusundaki hızlar yer değiştirir
    ball1.dx += approach * nx;
    ball1.dy += approach * ny;
    ball2.dx -= approach * nx;
    ball2.dy -= approach * ny;

    // Biraz rastgelelik, falso ve hızlanma
    for (const ball of [ball1, ball2]) {
        rotateVelocity(ball, randomBetween(-0.25, 0.25));
        ball.spin = randomBetween(-SPIN_MAX, SPIN_MAX) * 1.5;
        setSpeed(ball, Math.hypot(ball.dx, ball.dy) * BALL_BOOST);
    }

    const impactX = (ball1.x + ball2.x) / 2;
    const impactY = (ball1.y + ball2.y) / 2;
    addCollisionEffect(impactX, impactY, "ball");
    shakeAmount = Math.max(shakeAmount, Math.min(6, -approach));
    Sound.tick(-approach / 3);
}

// ---------- Oyun döngüsü ----------

function startLoop() {
    if (loopRunning) return;
    loopRunning = true;
    lastFrameTime = performance.now();
    accumulator = 0;
    requestAnimationFrame(gameLoop);
}

function gameLoop(now) {
    // Sekme arka plandan dönünce dev bir zaman atlaması olmasın
    accumulator += Math.min(now - lastFrameTime, STEP_MS * MAX_STEPS_PER_FRAME);
    lastFrameTime = now;

    while (accumulator >= STEP_MS) {
        step();
        accumulator -= STEP_MS;
    }

    render();

    // Maç bitip efektler sönünce döngüyü durdur
    const animating = gameState !== "ended" ||
        collisionEffects.length > 0 || goalParticles.length > 0 || floatingTexts.length > 0 || shakeAmount > 0;
    if (animating) {
        requestAnimationFrame(gameLoop);
    } else {
        loopRunning = false;
    }
}

// Ekran döndürme / boyut değişiminde canvas'ı yeniden boyutlandır
let resizeFrame = 0;
window.addEventListener("resize", function () {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(resizeCanvas);
});

resizeCanvas();

window.addEventListener("load", function () {
    loadAllTeams().catch(error => {
        console.error("Takımlar yüklenirken hata oluştu:", error);
    });
});
