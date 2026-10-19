// Ses: rahatsız etmeyecek seviyede, sadece atmosfer için.
// Tüm sesler Web Audio ile çalınır; tribün uğultusu dosya kullanmadan üretilir.
// Tarayıcılar sesi ancak bir dokunuştan sonra açar; bu yüzden unlock() "Kick off" tıklamasında çağrılır.
// (iPhone Safari <audio> ile çalınan sesleri dokunuştan birkaç saniye sonra engelliyor ve
// ses seviyesini yok sayıyor; Web Audio'da ikisi de sorun değil.)
const Sound = (() => {
    const CLIPS = {
        whistle: { file: "./sounds/whistle.mp3", volume: 0.2 },
        goal: { file: "./sounds/goal.mp3", volume: 0.28 }
    };

    const CROWD_LEVEL = 0.035; // Maç boyunca uğultu seviyesi

    let muted = false;
    try {
        muted = localStorage.getItem("rotascore-muted") === "1";
    } catch (error) {
        // Gizli sekmede localStorage olmayabilir
    }

    let context = null;
    let master = null;
    let crowd = null;
    let noiseBuffer = null;
    let crowdOn = false;
    let lastTick = 0;
    let playing = []; // Çalmakta olan düdük/gol sesleri (sessize alınınca durdurulur)

    function unlock() {
        if (context) {
            if (context.state === "suspended") context.resume();
            return;
        }
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        context = new AudioContext();
        master = context.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(context.destination);

        // 2 saniyelik "kahverengi" gürültü: uzaktan gelen tribün sesine benzer
        noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            data[i] = last * 3.5;
        }

        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        const band = context.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 500;
        band.Q.value = 0.6;
        crowd = context.createGain();
        crowd.gain.value = 0;
        source.connect(band).connect(crowd).connect(master);
        source.start();

        // Düdük ve gol seslerini bir kere indirip çözümle
        for (const clip of Object.values(CLIPS)) {
            fetch(clip.file)
                .then(response => response.arrayBuffer())
                .then(data => new Promise((resolve, reject) => context.decodeAudioData(data, resolve, reject)))
                .then(buffer => { clip.buffer = buffer; })
                .catch(() => {});
        }
    }

    function rampCrowd(level, seconds) {
        if (!crowd) return;
        const now = context.currentTime;
        crowd.gain.cancelScheduledValues(now);
        crowd.gain.setValueAtTime(crowd.gain.value, now);
        crowd.gain.linearRampToValueAtTime(level, now + seconds);
    }

    function startCrowd() {
        crowdOn = true;
        rampCrowd(CROWD_LEVEL, 1.5);
    }

    function stopCrowd() {
        crowdOn = false;
        rampCrowd(0, 2.5);
    }

    // Heyecanlı anlarda tribün kısa bir süre yükselir
    function swell(amount, seconds) {
        if (!crowd || !crowdOn) return;
        const now = context.currentTime;
        crowd.gain.cancelScheduledValues(now);
        crowd.gain.setValueAtTime(crowd.gain.value, now);
        crowd.gain.linearRampToValueAtTime(CROWD_LEVEL + amount, now + 0.15);
        crowd.gain.linearRampToValueAtTime(CROWD_LEVEL, now + 0.15 + seconds);
    }

    // Toplar çarpışınca çok kısa, yumuşak bir "tık"
    function tick(strength) {
        if (!context || muted) return;
        const nowMs = performance.now();
        if (nowMs - lastTick < 90) return;
        lastTick = nowMs;

        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1400;
        filter.Q.value = 1.2;
        const gain = context.createGain();
        const now = context.currentTime;
        gain.gain.setValueAtTime(Math.min(0.25, 0.08 * strength), now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        source.connect(filter).connect(gain).connect(master);
        source.start(now, Math.random());
        source.stop(now + 0.07);
    }

    // maxMs verilirse ses o kadar çalar ve kısa bir geçişle kısılır
    function playClip(clip, maxMs) {
        if (!context || !clip.buffer || muted) return;
        const now = context.currentTime;
        const source = context.createBufferSource();
        source.buffer = clip.buffer;
        const gain = context.createGain();
        gain.gain.setValueAtTime(clip.volume, now);
        source.connect(gain).connect(master);
        source.start(now);
        if (maxMs) {
            const end = now + maxMs / 1000;
            gain.gain.setValueAtTime(clip.volume, end - 0.15);
            gain.gain.linearRampToValueAtTime(0, end);
            source.stop(end);
        }
        playing.push(source);
        source.onended = () => {
            playing = playing.filter(item => item !== source);
        };
    }

    return {
        unlock,
        startCrowd,
        stopCrowd,
        swell,
        tick,
        // Başlama ve devre arası kısa, maç sonu uzun düdük
        whistle(kind) {
            playClip(CLIPS.whistle, kind === "end" ? 0 : kind === "half" ? 1400 : 900);
        },
        goal() {
            playClip(CLIPS.goal, 0);
            swell(0.1, 3);
        },
        isMuted() {
            return muted;
        },
        toggleMute() {
            muted = !muted;
            if (master) master.gain.value = muted ? 0 : 1;
            if (muted) {
                playing.forEach(source => source.stop());
                playing = [];
            }
            try {
                localStorage.setItem("rotascore-muted", muted ? "1" : "0");
            } catch (error) {
                // yoksay
            }
            return muted;
        }
    };
})();
