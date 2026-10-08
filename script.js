document.addEventListener('DOMContentLoaded', () => {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1000;
    filter.Q.value = 1;

    const delay = audioCtx.createDelay(2.0);
    delay.delayTime.value = 0.4;
    const delayFeedback = audioCtx.createGain();
    delayFeedback.gain.value = 0.0;
    const delayWet = audioCtx.createGain();
    delayWet.gain.value = 0.0;

    const distortion = audioCtx.createWaveShaper();
    distortion.oversample = '4x';

    function makeDistortionCurve(amount) {
        const samples = 44100;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; ++i) {
            const x = (i * 2) / samples - 1;
            curve[i] = (Math.PI + amount) * x / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }
    distortion.curve = makeDistortionCurve(0);

    filter.connect(distortion);
    distortion.connect(masterGain);
    distortion.connect(delay);
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    delay.connect(delayWet);
    delayWet.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    const noteFrequencies = {
        'C2': 65.41, 'F2': 87.31, 'G2': 98.00, 'A#2': 116.54, 'A2': 110.00,
        'C3': 130.81, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
        'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
        'C5': 523.25, 'D5': 587.33, 'D#5': 622.25, 'F#5': 739.99
    };

    const moodPresets = {
        calm: { baseWave: 'sine', baseFilter: 400, volume: 0.15, attack: 0.4, release: 3.0 },
        dream: { baseWave: 'triangle', baseFilter: 800, volume: 0.25, attack: 0.2, release: 2.0 },
        tension: { baseWave: 'sawtooth', baseFilter: 1500, volume: 0.3, attack: 0.05, release: 0.4 },
        chaos: { baseWave: 'sawtooth', baseFilter: 2000, volume: 0.35, attack: 0.01, release: 0.2 }
    };

    const moodPatterns = {
        calm: {
            notes: ['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3'],
            baseDuration: 3000
        },
        dream: {
            notes: ['E3', 'G3', 'B3', 'D4', 'G4', 'B4', 'D5', 'G4', 'D4', 'B3', 'G3', 'E3'],
            baseDuration: 1500
        },
        tension: {
            notes: ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3'],
            baseDuration: 800
        },
        chaos: {
            notes: ['C2', 'F#3', 'A#2', 'D4', 'G#3', 'C#4', 'F2', 'B3', 'E3', 'A2', 'D#3', 'G2'],
            baseDuration: 400
        }
    };

    const moodNames = {
        calm: 'спокойное',
        dream: 'мечтательное',
        tension: 'напряжённое',
        chaos: 'хаос'
    };

    const moodBalances = {
        calm: { calm: 60, dream: 20, tension: 10, chaos: 10 },
        dream: { calm: 20, dream: 60, tension: 10, chaos: 10 },
        tension: { calm: 10, dream: 15, tension: 60, chaos: 15 },
        chaos: { calm: 5, dream: 10, tension: 15, chaos: 70 }
    };

    let currentMood = null; // Изначально настроение не выбрано
    let activeOscillators = {};
    let backgroundTimeout = null;
    let currentNoteIndex = 0;

    const sliderValues = { brightness: 50, movement: 50, depth: 50, intensity: 50 };

    function getCurrentParams() {
        const brightness = sliderValues.brightness / 100;
        const movement = sliderValues.movement / 100;
        const depth = sliderValues.depth / 100;
        const intensity = sliderValues.intensity / 100;

        // Если настроение не выбрано, используем дефолтные параметры
        const preset = currentMood ? moodPresets[currentMood] : { baseWave: 'sine', baseFilter: 1000, volume: 0.2, attack: 0.2, release: 1.5 };
        const pattern = currentMood ? moodPatterns[currentMood] : { baseDuration: 1000 };

        const filterFreq = 200 + (brightness * 7800);
        const filterQ = 1 + (brightness * 14);

        let waveType = preset.baseWave;
        if (brightness < 0.3) waveType = 'sine';
        else if (brightness < 0.6) waveType = 'triangle';
        else if (brightness < 0.85) waveType = 'sawtooth';
        else waveType = 'square';

        const noteDuration = pattern.baseDuration - (movement * pattern.baseDuration * 0.5);

        const delayFeedbackVal = depth * 0.85;
        const delayWetVal = depth * 0.8;

        const volume = preset.volume + (intensity * 0.2);
        const attack = preset.attack - (intensity * preset.attack * 0.5);
        const release = preset.release - (intensity * preset.release * 0.5);
        const distortionAmount = intensity * 400;

        return {
            filterFreq, filterQ, waveType, noteDuration,
            delayFeedbackVal, delayWetVal,
            volume, attack, release, distortionAmount
        };
    }

    function playNote(freq, duration) {
        const params = getCurrentParams();
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();

        osc.type = params.waveType;
        osc.frequency.value = freq;

        const now = audioCtx.currentTime;
        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(params.volume, now + params.attack);
        env.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(env);
        env.connect(filter);
        osc.start(now);
        osc.stop(now + duration + 0.1);
    }

    function scheduleNextNote() {
        if (!currentMood) return; // Если настроение не выбрано, не играем

        const pattern = moodPatterns[currentMood];
        const params = getCurrentParams();
        const note = pattern.notes[currentNoteIndex];
        const freq = noteFrequencies[note] || 440;
        const duration = params.noteDuration / 1000;

        playNote(freq, duration);
        currentNoteIndex = (currentNoteIndex + 1) % pattern.notes.length;

        backgroundTimeout = setTimeout(scheduleNextNote, params.noteDuration);
    }

    function startBackgroundLoop(mood) {
        if (backgroundTimeout) clearTimeout(backgroundTimeout);
        currentNoteIndex = 0;
        scheduleNextNote();
    }

    function stopBackgroundLoop() {
        if (backgroundTimeout) {
            clearTimeout(backgroundTimeout);
            backgroundTimeout = null;
        }
    }

    function playKeyNote(note) {
        if (activeOscillators[note]) return;
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const freq = noteFrequencies[note] || 440;
        const params = getCurrentParams();
        const osc = audioCtx.createOscillator();
        const env = audioCtx.createGain();

        osc.type = params.waveType;
        osc.frequency.value = freq;

        const now = audioCtx.currentTime;
        const gain = params.volume * 0.8;

        env.gain.setValueAtTime(0, now);
        env.gain.linearRampToValueAtTime(gain, now + params.attack);

        osc.connect(env);
        env.connect(filter);
        osc.start(now);

        activeOscillators[note] = { osc, env, release: params.release };

        const keyEl = document.querySelector(`[data-note="${note}"]`);
        if (keyEl) keyEl.classList.add('active');

        const orb = document.getElementById('orb');
        orb.style.transform = 'scale(1.1)';
        setTimeout(() => { orb.style.transform = ''; }, 150);
    }

    function stopKeyNote(note) {
        const active = activeOscillators[note];
        if (!active) return;

        const { osc, env, release } = active;
        const now = audioCtx.currentTime;

        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(env.gain.value, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + release);

        osc.stop(now + release + 0.1);
        delete activeOscillators[note];

        const keyEl = document.querySelector(`[data-note="${note}"]`);
        if (keyEl) keyEl.classList.remove('active');
    }

    function updateSoundParams() {
        const params = getCurrentParams();
        filter.frequency.setTargetAtTime(params.filterFreq, audioCtx.currentTime, 0.05);
        filter.Q.setTargetAtTime(params.filterQ, audioCtx.currentTime, 0.05);
        delayFeedback.gain.setTargetAtTime(params.delayFeedbackVal, audioCtx.currentTime, 0.1);
        delayWet.gain.setTargetAtTime(params.delayWetVal, audioCtx.currentTime, 0.1);
        masterGain.gain.setTargetAtTime(params.volume, audioCtx.currentTime, 0.05);
        distortion.curve = makeDistortionCurve(params.distortionAmount);
    }

    function updateSliderVisuals(param, value) {
        sliderValues[param] = value;
        const thumb = document.getElementById('thumb-' + param);
        const fill = document.getElementById('fill-' + param);
        const val = document.getElementById('val-' + param);

        if (thumb) thumb.style.bottom = value + '%';
        if (fill) fill.style.height = value + '%';
        if (val) val.textContent = (value / 100).toFixed(2);

        updateSoundParams();
    }

    function updateBalance(mood) {
        if (!mood) {
            document.getElementById('bal-calm').textContent = '—';
            document.getElementById('bal-dream').textContent = '—';
            document.getElementById('bal-tension').textContent = '—';
            document.getElementById('bal-chaos').textContent = '—';
            return;
        }
        const b = moodBalances[mood];
        document.getElementById('bal-calm').textContent = b.calm;
        document.getElementById('bal-dream').textContent = b.dream;
        document.getElementById('bal-tension').textContent = b.tension;
        document.getElementById('bal-chaos').textContent = b.chaos;
    }

    const sliderParams = ['brightness', 'movement', 'depth', 'intensity'];

    function handleSliderInteraction(container, clientY) {
        const rect = container.getBoundingClientRect();
        const relativeY = rect.bottom - clientY;
        const percent = Math.max(0, Math.min(100, (relativeY / rect.height) * 100));
        const param = container.dataset.param;
        updateSliderVisuals(param, Math.round(percent));
    }

    sliderParams.forEach(param => {
        const container = document.querySelector(`[data-param="${param}"]`);
        let isDragging = false;

        container.addEventListener('mousedown', (e) => {
            isDragging = true;
            container.classList.add('dragging');
            handleSliderInteraction(container, e.clientY);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            handleSliderInteraction(container, e.clientY);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                container.classList.remove('dragging');
            }
        });

        container.addEventListener('touchstart', (e) => {
            isDragging = true;
            container.classList.add('dragging');
            handleSliderInteraction(container, e.touches[0].clientY);
        }, { passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            handleSliderInteraction(container, e.touches[0].clientY);
        }, { passive: true });

        document.addEventListener('touchend', () => {
            if (isDragging) {
                isDragging = false;
                container.classList.remove('dragging');
            }
        });
    });

    function setMood(mood, btnElement) {
        currentMood = mood;
        document.querySelectorAll('.mood-item').forEach(b => b.classList.remove('active'));
        if (btnElement) btnElement.classList.add('active');

        document.getElementById('orb').className = 'orb ' + mood;
        document.getElementById('modeText').textContent = moodNames[mood];
        document.getElementById('modeId').textContent = 'MOOD 0' + (['calm', 'dream', 'tension', 'chaos'].indexOf(mood) + 1);
        updateBalance(mood);

        startBackgroundLoop(mood);
        updateSoundParams();
    }

    function surpriseMe() {
        const moods = ['calm', 'dream', 'tension', 'chaos'];
        const randomMood = moods[Math.floor(Math.random() * moods.length)];
        const btn = document.querySelector(`.mood-item[data-mood="${randomMood}"]`);
        setMood(randomMood, btn);
        sliderParams.forEach(key => {
            const val = Math.floor(Math.random() * 80 + 10);
            updateSliderVisuals(key, val);
        });
    }

    document.getElementById('overlay').addEventListener('click', () => {
        audioCtx.resume();
        document.getElementById('overlay').style.display = 'none';
        // Фоновая мелодия не запускается, пока не выбрано настроение
    });

    document.querySelectorAll('.key').forEach(key => {
        key.addEventListener('mousedown', () => playKeyNote(key.dataset.note));
        key.addEventListener('mouseup', () => stopKeyNote(key.dataset.note));
        key.addEventListener('mouseleave', () => stopKeyNote(key.dataset.note));
    });

    const keyMap = { 'a': 'C4', 's': 'D4', 'd': 'E4', 'f': 'F4', 'g': 'G4', 'h': 'A4', 'j': 'B4', 'k': 'C5' };

    document.addEventListener('keydown', e => {
        const note = keyMap[e.key.toLowerCase()];
        if (note && !e.repeat) playKeyNote(note);
    });

    document.addEventListener('keyup', e => {
        const note = keyMap[e.key.toLowerCase()];
        if (note) stopKeyNote(note);
    });

    document.querySelectorAll('.mood-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            setMood(e.currentTarget.dataset.mood, e.currentTarget);
        });
    });

    document.getElementById('surpriseBtn').addEventListener('click', surpriseMe);

    // Инициализация: ничего не выбрано, слайдеры на 0.50
    updateBalance(null);
    updateSoundParams();
});