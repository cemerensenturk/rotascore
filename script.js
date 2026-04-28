const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const whistleSound = new Audio('./sounds/whistle.mp3');
const goalSound = new Audio('./sounds/goal.mp3');

canvas.width = 400;
canvas.height = 400;

function getRandomSpeed() {
    const minSpeed = 1.0;
    const speed = (Math.random() * 2 - 1) * 2.4;
    return Math.sign(speed) * Math.max(Math.abs(speed), minSpeed);
}

let team1 = { x: 170, y: 200, dx: getRandomSpeed(), dy: getRandomSpeed(), history: [] };
let team2 = { x: 230, y: 200, dx: getRandomSpeed(), dy: getRandomSpeed(), history: [] };
let goal = { x: 200, y: 50, width: 30, height: 10, angle: 0, speed: 0.8 };
let score = [0, 0];
let time = 0;
let goalParticles = [];
let shakeAmount = 0;
let isPaused = false;
let timeInterval;
let gameRunning = false;
let ballRadius = 30;
let goalWidth = 25;  // Kale genişliği
let goalHeight = 70; // Kale yüksekliği
let goalRadius = 180; // Kale merkezinin dönme mesafesi

// Takımları yüklemek için temsili bir nesne
let teamsDatabase = {};

// Tüm JSON dosyalarını yükleyip teamsDatabase'e ekleyen fonksiyon
async function loadAllTeams() {
    const jsonFiles = [
        'worldcup.json',
        'premier.json',
        'laliga.json',
        'bundesliga.json',
        'seriea.json',
        'ligue1.json',
        'trendyol.json',
        'others.json'
    ];

    // Tüm dosyaları sırayla yükle
    for (const file of jsonFiles) {
        try {
            const response = await fetch(`./json/${file}`);
            if (!response.ok) throw new Error(`${file} yüklenemedi: ${response.status}`);

            const data = await response.json();
            // Her bir takımı teamsDatabase'e ekle
            for (const teamId in data) {
                teamsDatabase[teamId] = data[teamId];
            }
        } catch (error) {
            console.error(`${file} yüklenirken hata oluştu:`, error);
        }
    }

    // Tüm takımlar yüklendikten sonra arayüzü güncelle
    filterTeams();
}

function startGame() {
    if (gameRunning) return;

    resizeCanvas();

    let team1Name = document.getElementById("team1-select").value;
    let team2Name = document.getElementById("team2-select").value;

    // Veritabanımızdan takım özelliklerini al
    team1.color = teamsDatabase[team1Name].colors;
    team1.initial = teamsDatabase[team1Name].initial;

    team2.color = teamsDatabase[team2Name].colors;
    team2.initial = teamsDatabase[team2Name].initial;

    document.getElementById("goal-history").innerHTML = "<h3>Goal History</h3>";

    whistleSound.play();

    gameRunning = true;
    isPaused = false;
    score = [0, 0];
    time = 0;
    updateScore();
    document.getElementById("time").innerText = `${time}`;

    clearInterval(timeInterval);
    timeInterval = setInterval(updateTime, 500);
    resetPositions();
    gameLoop();
}

function drawDualColorCircle(x, y, radius, colors, teamInitial) {
    ctx.save();

    // Neon glow effect for the ball
    ctx.shadowBlur = 15;
    ctx.shadowColor = colors[0] !== "#FFFFFF" ? colors[0] : (colors[1] !== "#000000" ? colors[1] : "#00FFFF");
    if (ctx.shadowColor === "#000000") ctx.shadowColor = "#FF00FF"; // fallback for pure black teams

    // Üst yarıyı çiz
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI, true);
    ctx.fillStyle = colors[0];
    ctx.fill();

    // Alt yarıyı çiz
    ctx.beginPath();
    ctx.arc(x, y, radius, Math.PI, 2 * Math.PI, true);
    ctx.fillStyle = colors[1];
    ctx.fill();

    // Harfi çiz
    ctx.shadowBlur = 0; // Disable shadow for text
    ctx.fillStyle = (colors.includes("#FFFFFF")) ? "black" : "white";
    ctx.font = `bold ${radius * 0.6}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(teamInitial, x, y);

    ctx.restore();
}

function drawTrail(team) {
    if (!team.history || team.history.length < 2) return;
    for (let i = 0; i < team.history.length; i++) {
        let alpha = 0.8 * (1 - i / team.history.length);
        let r = ballRadius * (1 - (i / team.history.length) * 0.6);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(team.history[i].x, team.history[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = team.color[0];
        ctx.fill();
        ctx.restore();
    }
}

function drawTeams() {
    drawTrail(team1);
    drawTrail(team2);
    drawDualColorCircle(team1.x, team1.y, ballRadius, team1.color, team1.initial);
    drawDualColorCircle(team2.x, team2.y, ballRadius, team2.color, team2.initial);
}

function changeBackground(category) {
    const canvas = document.getElementById("gameCanvas");

    // Önce mevcut geçiş animasyonu tamamlansın
    canvas.style.transition = "background-image 1s ease";

    // Kategori/lige göre arkaplan resmini belirle
    let newBackground = "url(./img/rota.png)";

    switch (category) {
        case "premier-league":
            newBackground = "url(./img/pl.png)";
            break;
        case "la-liga":
            newBackground = "url(./img/ll.png)";
            break;
        case "bundesliga":
            newBackground = "url(./img/bl.png)";
            break;
        case "super-lig":
            newBackground = "url(./img/tsl.png)";
            break;
        case "serie-a":
            newBackground = "url(./img/sa.png)";
            break;
        case "ligue-1":
            newBackground = "url(./img/l1.png)";
            break;
        case "ucl":
            newBackground = "url(./img/ucl.png)";
            break;
        case "uel":
            newBackground = "url(./img/uel.png)";
            break;
        case "uecl":
            newBackground = "url(./img/uecl.png)";
            break;
        case "worldcup":
            newBackground = "url(./img/fc26.png)";
            break;

        default:
            newBackground = "url(./img/rota.png)";
    }

    canvas.style.backgroundImage = newBackground;
}

function filterTeams() {
    const selectedCategory = document.getElementById("filter-category").value;
    const team1Select = document.getElementById("team1-select");
    const team2Select = document.getElementById("team2-select");

    // Mevcut seçimleri kaydet
    const team1Current = team1Select.value;
    const team2Current = team2Select.value;

    // Seçim kutularını temizle
    team1Select.innerHTML = "";
    team2Select.innerHTML = "";

    // Filtreleme ve ekleme
    for (const teamId in teamsDatabase) {
        const team = teamsDatabase[teamId];

        // Tüm takımlar seçildiğinde veya takım bu kategoride ise
        if (selectedCategory === "all" ||
            team.league === selectedCategory ||
            team.competitions.includes(selectedCategory)) {

            // Takım 1 seçim kutusuna ekle
            const option1 = document.createElement("option");
            option1.value = teamId;
            option1.textContent = team.name;
            team1Select.appendChild(option1);

            // Takım 2 seçim kutusuna ekle
            const option2 = document.createElement("option");
            option2.value = teamId;
            option2.textContent = team.name;
            team2Select.appendChild(option2);
        }
    }

    // Önceki seçimleri korumaya çalış (eğer hala filtrelenen takımlar arasındaysa)
    if (Array.from(team1Select.options).some(opt => opt.value === team1Current)) {
        team1Select.value = team1Current;
    }

    if (Array.from(team2Select.options).some(opt => opt.value === team2Current)) {
        team2Select.value = team2Current;
    }

    changeBackground(selectedCategory);
}

function drawGoal() {
    let radian = (goal.angle * Math.PI) / 180;

    // Kale merkezinin konumunu hesapla
    goal.x = 200 + Math.cos(radian) * goalRadius;
    goal.y = 200 + Math.sin(radian) * goalRadius;

    ctx.save();
    ctx.translate(goal.x, goal.y);

    // Kalenin açısını, merkeze bakacak şekilde ayarla
    let angleToCenter = Math.atan2(200 - goal.y, 200 - goal.x);
    ctx.rotate(angleToCenter);

    // Kalenin arka plan kısmı (isteğe bağlı, ağ etkisi için)
    ctx.beginPath();
    ctx.rect(-goalWidth / 2, -goalHeight / 2, goalWidth, goalHeight);
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)"; // Yarı saydam beyaz (ağ etkisi)
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.rect(-goalWidth / 2, -goalHeight / 2, goalWidth, 3);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.rect(-goalWidth / 2, -goalHeight / 2, 3, goalHeight);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.rect(-goalWidth / 2, goalHeight / 2 - 3, goalWidth, 3);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.closePath();


    ctx.restore();
}

function updateGoalAngle() {
    // Kaleyi her zaman orijine bakacak şekilde döndür
    let angleToOrigin = Math.atan2(goal.y - 200, goal.x - 200);
    goal.angle = angleToOrigin * 180 / Math.PI;  // Açıyı dereceye çevir
}

function updateScore(scorer = null) {
    // Temel skor güncellemesi
    document.getElementById("score").innerText = `${score[0]} - ${score[1]}`;

    // Eğer golü atan belirtilmemişse sadece skoru güncelle ve çık
    if (!scorer) return;

    // Gol geçmişini güncelle
    const goalHistory = document.getElementById("goal-history");

    // Yeni gol kaydını oluştur
    const goalEntry = document.createElement("p");
    goalEntry.style.margin = "5px 0";
    goalEntry.style.textAlign = "left";
    goalEntry.style.padding = "5px 10px";
    goalEntry.classList.add("goal-entry-anim");

    // Golü atan takımın tam adını bul
    let scorerTeamName = "";
    let scorerColor = "#ffffff";
    for (let teamId in teamsDatabase) {
        if (teamsDatabase[teamId].initial === scorer) {
            scorerTeamName = teamsDatabase[teamId].name;
            scorerColor = teamsDatabase[teamId].colors[0];
            break;
        }
    }

    goalEntry.innerHTML = `${time}' ${scorerTeamName} scores!`;
    goalHistory.appendChild(goalEntry);
    
    // Otomatik olarak en alta kaydır
    goalHistory.scrollTop = goalHistory.scrollHeight;

    // Pulse the scoreboard
    let scoreSpan = document.getElementById("score");
    scoreSpan.style.setProperty('--pulse-color', scorerColor);
    scoreSpan.classList.remove("score-pulse");
    void scoreSpan.offsetWidth; // trigger reflow
    scoreSpan.classList.add("score-pulse");
}

function updatePositions() {
    // Topların hareketini güncelliyoruz
    [team1, team2].forEach(team => {
        if (!team.history) team.history = [];
        team.history.unshift({ x: team.x, y: team.y });
        if (team.history.length > 15) team.history.pop();

        team.x += team.dx;
        team.y += team.dy;

        // Yalnızca hız limiti kontrolü, rastgele "rüzgar" efekti kaldırıldı
        let speed = Math.hypot(team.dx, team.dy);
        if (speed > 2.5) {
            team.dx = (team.dx / speed) * 2.5;
            team.dy = (team.dy / speed) * 2.5;
        } else if (speed < 1.0 && speed > 0) {
            team.dx = (team.dx / speed) * 1.0;
            team.dy = (team.dy / speed) * 1.0;
        }

        let distance = Math.hypot(team.x - goal.x, team.y - goal.y);
        if (distance < 25 && Math.random() < 0.4) {
            if (team === team1) {
                score[0]++;
                updateScore(team1.initial);
            } else {
                score[1]++;
                updateScore(team2.initial);
            }

            goalSound.play();

            shakeAmount = 15;
            createGoalExplosion(goal.x, goal.y, team.color);

            isPaused = true;

            // Kısa bir beklemeden sonra oyunu devam ettiriyoruz
            setTimeout(() => {
                resetPositions();
                if (time < 90) { // Süre bitmemişse oyunu devam ettir
                    isPaused = false;
                } else {
                    gameRunning = false;
                }
            }, 3000);
        }

        // Sahadan çıkmasını engelliyoruz ve çemberden yansıtıyoruz
        let centerX = canvas.width / 2;
        let centerY = canvas.height / 2;
        let distanceToCenter = Math.hypot(team.x - centerX, team.y - centerY);

        if (distanceToCenter >= goalRadius) {
            let nx = (team.x - centerX) / distanceToCenter;
            let ny = (team.y - centerY) / distanceToCenter;

            let dotProduct = team.dx * nx + team.dy * ny;

            if (dotProduct > 0) {
                team.dx = team.dx - 2 * dotProduct * nx + (Math.random() - 0.5);
                team.dy = team.dy - 2 * dotProduct * ny + (Math.random() - 0.5);
                team.dx *= 1.05;
                team.dy *= 1.05;
            }

            team.x = centerX + nx * (goalRadius - 1);
            team.y = centerY + ny * (goalRadius - 1);

            addCollisionEffect(team.x, team.y, "wall");
        }
    });

    // Kalenin yönünü orijine bakacak şekilde güncelliyoruz
    updateGoalAngle();

    handleCollision(team1, team2);
    goal.angle += goal.speed;
}

function resetPositions() {
    team1.history = [];
    team2.history = [];

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    let randomOffsetY1 = (Math.random() - 0.5) * 80;
    let randomOffsetY2 = (Math.random() - 0.5) * 80;

    team1.x = centerX - 40;
    team1.y = centerY + randomOffsetY1;
    team1.dx = getRandomSpeed();
    team1.dy = getRandomSpeed();

    team2.x = centerX + 40;
    team2.y = centerY + randomOffsetY2;
    team2.dx = getRandomSpeed();
    team2.dy = getRandomSpeed();

    goal.angle = 0;
}

// Çarpışma efekti için değişkenler
let collisionEffects = [];

function addCollisionEffect(x, y, type) {
    let effect = {
        x: x,
        y: y,
        type: type, // "wall" veya "ball"
        radius: type === "wall" ? 5 : 10,
        alpha: 1.0,
        color: type === "wall" ? "#ffffff" : "#ffcc00"
    };
    collisionEffects.push(effect);
}

function updateAndDrawEffects() {
    ctx.beginPath();
    for (let i = collisionEffects.length - 1; i >= 0; i--) {
        let effect = collisionEffects[i];
        effect.radius += 0.7;
        effect.alpha -= 0.05;

        ctx.moveTo(effect.x + effect.radius, effect.y);
        ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);

        if (effect.alpha <= 0) {
            collisionEffects.splice(i, 1);
        }
    }

    if (collisionEffects.length > 0) {
        ctx.strokeStyle = `rgba(255,204,0,0.5)`;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Draw goal particles
    for (let i = goalParticles.length - 1; i >= 0; i--) {
        let p = goalParticles[i];
        p.x += p.dx;
        p.y += p.dy;
        p.life -= p.decay;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.restore();

        if (p.life <= 0) goalParticles.splice(i, 1);
    }
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

// Oyun değişkenleri arasına bu değişkenleri ekleyelim
let minDeflectionAngle = 0.15;  // Minimum sapma açısı (radyan)
let maxDeflectionAngle = 0.65;  // Maksimum sapma açısı (radyan)

function handleCollision(ball1, ball2) {
    let dx = ball2.x - ball1.x;
    let dy = ball2.y - ball1.y;
    let distance = Math.hypot(dx, dy);
    let minDistance = ballRadius * 2;

    if (distance < minDistance) {
        // Çarpışma başına rastgele sapma açıları üret
        // Her çarpışmada farklı açılar kullanarak hareketin doğrusallığını kır
        let random1 = minDeflectionAngle + Math.random() * (maxDeflectionAngle - minDeflectionAngle);
        let random2 = minDeflectionAngle + Math.random() * (maxDeflectionAngle - minDeflectionAngle);

        // Açıları pozitif veya negatif yapma şansı
        random1 *= Math.random() > 0.5 ? 1 : -1;
        random2 *= Math.random() > 0.5 ? 1 : -1;

        // Çarpışma açısını hesapla
        let angle = Math.atan2(dy, dx);

        // Hızların büyüklüğünü hesapla
        let speed1 = Math.hypot(ball1.dx, ball1.dy);
        let speed2 = Math.hypot(ball2.dx, ball2.dy);

        // Yeni hızları ata - dinamik açı eklemeli
        ball1.dx = Math.cos(angle + Math.PI + random1) * speed1 * 1.05;
        ball1.dy = Math.sin(angle + Math.PI + random1) * speed1 * 1.05;

        ball2.dx = Math.cos(angle + random2) * speed2 * 1.05;
        ball2.dy = Math.sin(angle + random2) * speed2 * 1.05;

        // Sabit çarpışma döngüsünden kaçınmak için hafif rastgele sapma
        ball1.dx += (Math.random() - 0.5) * 0.4;
        ball1.dy += (Math.random() - 0.5) * 0.4;
        ball2.dx += (Math.random() - 0.5) * 0.4;
        ball2.dy += (Math.random() - 0.5) * 0.4;

        // Topları birbirinden uzaklaştır (çakışmayı önle)
        let overlap = minDistance - distance;
        let adjustX = (overlap * dx) / distance * 0.5;
        let adjustY = (overlap * dy) / distance * 0.5;

        ball1.x -= adjustX;
        ball1.y -= adjustY;
        ball2.x += adjustX;
        ball2.y += adjustY;

        // Top çarpışma efekti ekle
        let collisionX = (ball1.x + ball2.x) / 2;
        let collisionY = (ball1.y + ball2.y) / 2;
        addCollisionEffect(collisionX, collisionY, "ball");
    }
}

function updateTime() {
    if (isPaused) return;
    if (time < 90) {
        time++;
        document.getElementById("time").innerText = `${time}`;
    } else {
        // 90. dakikada oyunu durduruyoruz
        clearInterval(timeInterval);
        gameRunning = false;
        whistleSound.play();
    }
}

function gameLoop() {
    if (!gameRunning && !isPaused) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (shakeAmount > 0) {
        let dx = (Math.random() - 0.5) * shakeAmount;
        let dy = (Math.random() - 0.5) * shakeAmount;
        ctx.translate(dx, dy);
        shakeAmount *= 0.9;
        if (shakeAmount < 0.5) shakeAmount = 0;
    }

    // Draw field circle with dynamic radius based on canvas size
    const fieldRadius = Math.min(canvas.width, canvas.height) * 0.45;
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00FFFF"; // Neon cyan
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, fieldRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    drawGoal();
    drawTeams();
    if (!isPaused) {
        updatePositions();
    }
    updateAndDrawEffects(); // Efektleri çiz

    ctx.restore();
    requestAnimationFrame(gameLoop);
}

// Add this new function to handle responsive canvas
function resizeCanvas() {
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // On mobile, make the canvas square and fit the viewport width
        const size = Math.min(window.innerWidth * 0.95, 400);
        canvas.width = size;
        canvas.height = size;

        // Adjust game elements for the new canvas size
        goalRadius = size * 0.45;  // 45% of canvas size
        ballRadius = size * 0.075; // 7.5% of canvas size
        goalWidth = size * 0.0625; // 6.25% of canvas size  
        goalHeight = size * 0.175; // 17.5% of canvas size
    } else {
        // On desktop, use original dimensions
        canvas.width = 400;
        canvas.height = 400;
        goalRadius = 180;
        ballRadius = 30;
        goalWidth = 25;
        goalHeight = 70;
    }
}

// Add window resize event listener
window.addEventListener('resize', function () {
    if (gameRunning) {
        // If game is running, handle resize
        resizeCanvas();
    }
});

window.addEventListener("load", function () {
    loadAllTeams().then(() => {
        console.log("Tüm takımlar yüklendi!");
    }).catch(error => {
        console.error("Takımlar yüklenirken hata oluştu:", error);
    });
});