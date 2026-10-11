import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ========================================
// WEB AUDIO API
// ========================================
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
    calm: { notes: ['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3'], baseDuration: 3000 },
    dream: { notes: ['E3', 'G3', 'B3', 'D4', 'G4', 'B4', 'D5', 'G4', 'D4', 'B3', 'G3', 'E3'], baseDuration: 1500 },
    tension: { notes: ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3'], baseDuration: 800 },
    chaos: { notes: ['C2', 'F#3', 'A#2', 'D4', 'G#3', 'C#4', 'F2', 'B3', 'E3', 'A2', 'D#3', 'G2'], baseDuration: 400 }
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

let currentMood = null;
let activeOscillators = {};
let backgroundTimeout = null;
let currentNoteIndex = 0;

const sliderValues = { brightness: 50, movement: 50, depth: 50, intensity: 50 };

function getCurrentParams() {
    const brightness = sliderValues.brightness / 100;
    const movement = sliderValues.movement / 100;
    const depth = sliderValues.depth / 100;
    const intensity = sliderValues.intensity / 100;

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
    if (!currentMood) return;

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

    if (mesh) {
        mesh.scale.set(1.1, 1.1, 1.1);
    }

    setTimeout(() => {
        if (mesh) mesh.scale.set(1, 1, 1);
    }, 150);
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

// ========================================
// THREE.JS ВИЗУАЛИЗАЦИЯ ОРБА
// ========================================

const vertexShader = `
  uniform float uTime;
  uniform float uNoiseScale;
  uniform float uNoiseAmp;
  uniform float uNoiseSpeed;
  
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPosition;
  
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  void main() {
    vNormal = normalize(normalMatrix * normal);
    
    vec3 pos = position;
    float noise = snoise(pos * uNoiseScale + uTime * uNoiseSpeed);
    float noise2 = snoise(pos * uNoiseScale * 2.0 + uTime * uNoiseSpeed * 1.5) * 0.5;
    
    pos += normal * (noise + noise2) * uNoiseAmp;
    
    vPosition = pos;
    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// НОВЫЙ шейдер с яркими светящимися прожилками
const fragmentShader = `
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uFresnelPower;
  uniform float uIridescenceSpeed;
  
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPosition;
  
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  
  // Ridged noise для ярких прожилок
  float ridgedNoise(vec3 p) {
    float n = snoise(p);
    return 1.0 - abs(n);
  }
  
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), uFresnelPower);
    
    // Иридесценция
    float iridescence = sin(vPosition.x * 3.0 + uTime * uIridescenceSpeed) * 
                        cos(vPosition.y * 3.0 + uTime * uIridescenceSpeed * 0.7) * 0.5 + 0.5;
    
    // МНОГО СЛОЁВ ПРОЖИЛОК для яркости
    float ridged1 = ridgedNoise(vPosition * 3.0 + uTime * 0.2);
    ridged1 = pow(ridged1, 2.0);
    
    float ridged2 = ridgedNoise(vPosition * 6.0 - uTime * 0.15);
    ridged2 = pow(ridged2, 3.0);
    
    float ridged3 = ridgedNoise(vPosition * 12.0 + uTime * 0.1);
    ridged3 = pow(ridged3, 4.0);
    
    // Комбинируем прожилки
    float veins = ridged1 * 0.6 + ridged2 * 0.3 + ridged3 * 0.1;
    
    // Основной цвет
    vec3 color = mix(uColor1, uColor2, iridescence);
    color = mix(color, uColor3, fresnel * 0.5);
    
    // Яркие светящиеся прожилки
    vec3 veinColor = vec3(0.9, 0.95, 1.0); // Почти белый с голубым
    color += veinColor * veins * 0.8;
    
    // Fresnel-контур
    vec3 fresnelColor = vec3(0.85, 0.92, 1.0);
    color = mix(color, fresnelColor, pow(fresnel, 1.8) * 0.7);
    
    // Тёмный центр (стеклянный эффект)
    float centerDark = pow(1.0 - fresnel, 1.5);
    color *= (0.25 + centerDark * 0.5);
    
    // Альфа: прозрачный в центре, яркий по краям
    float alpha = fresnel * 0.6 + veins * 0.4 + 0.1;
    
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
  }
`;

const moodSettings = {
    calm: {
        noiseScale: 1.5, noiseAmp: 0.15, noiseSpeed: 0.3,
        color1: [0.37, 0.78, 1.0], color2: [0.29, 0.42, 0.97], color3: [0.65, 0.55, 0.98],
        fresnelPower: 2.5, iridescenceSpeed: 0.2
    },
    dream: {
        noiseScale: 1.2, noiseAmp: 0.25, noiseSpeed: 0.4,
        color1: [0.5, 0.7, 1.0], color2: [0.65, 0.55, 0.98], color3: [0.8, 0.7, 1.0],
        fresnelPower: 2.2, iridescenceSpeed: 0.3
    },
    tension: {
        noiseScale: 2.5, noiseAmp: 0.3, noiseSpeed: 0.8,
        color1: [1.0, 0.4, 0.4], color2: [0.8, 0.2, 0.6], color3: [0.6, 0.1, 0.4],
        fresnelPower: 3.0, iridescenceSpeed: 0.5
    },
    chaos: {
        noiseScale: 3.0, noiseAmp: 0.4, noiseSpeed: 1.2,
        color1: [1.0, 0.8, 0.3], color2: [1.0, 0.5, 0.2], color3: [0.9, 0.3, 0.1],
        fresnelPower: 3.5, iridescenceSpeed: 0.8
    }
};

let scene, camera, renderer, composer, mesh, material;
let targetSettings = moodSettings.calm;
let animationId;

function initThreeOrb(container) {
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 4.5;

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // Прозрачный фон
    renderer.autoClear = true;
    container.appendChild(renderer.domElement);

    // Убираем любой фон у canvas
    renderer.domElement.style.background = 'transparent';

    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom для свечения прожилок
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.8,  // strength (увеличил для свечения)
        0.5,  // radius
        0.4   // threshold
    );
    composer.addPass(bloomPass);

    const geometry = new THREE.IcosahedronGeometry(1.3, 64);

    material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uNoiseScale: { value: moodSettings.calm.noiseScale },
            uNoiseAmp: { value: moodSettings.calm.noiseAmp },
            uNoiseSpeed: { value: moodSettings.calm.noiseSpeed },
            uColor1: { value: new THREE.Vector3(...moodSettings.calm.color1) },
            uColor2: { value: new THREE.Vector3(...moodSettings.calm.color2) },
            uColor3: { value: new THREE.Vector3(...moodSettings.calm.color3) },
            uFresnelPower: { value: moodSettings.calm.fresnelPower },
            uIridescenceSpeed: { value: moodSettings.calm.iridescenceSpeed }
        },
        transparent: true,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const clock = new THREE.Clock();

    function animate() {
        animationId = requestAnimationFrame(animate);

        const elapsed = clock.getElapsedTime();
        material.uniforms.uTime.value = elapsed;

        const lerpFactor = 0.02;
        material.uniforms.uNoiseScale.value += (targetSettings.noiseScale - material.uniforms.uNoiseScale.value) * lerpFactor;
        material.uniforms.uNoiseAmp.value += (targetSettings.noiseAmp - material.uniforms.uNoiseAmp.value) * lerpFactor;
        material.uniforms.uNoiseSpeed.value += (targetSettings.noiseSpeed - material.uniforms.uNoiseSpeed.value) * lerpFactor;
        material.uniforms.uFresnelPower.value += (targetSettings.fresnelPower - material.uniforms.uFresnelPower.value) * lerpFactor;
        material.uniforms.uIridescenceSpeed.value += (targetSettings.iridescenceSpeed - material.uniforms.uIridescenceSpeed.value) * lerpFactor;

        const c1 = material.uniforms.uColor1.value;
        const c2 = material.uniforms.uColor2.value;
        const c3 = material.uniforms.uColor3.value;
        c1.x += (targetSettings.color1[0] - c1.x) * lerpFactor;
        c1.y += (targetSettings.color1[1] - c1.y) * lerpFactor;
        c1.z += (targetSettings.color1[2] - c1.z) * lerpFactor;
        c2.x += (targetSettings.color2[0] - c2.x) * lerpFactor;
        c2.y += (targetSettings.color2[1] - c2.y) * lerpFactor;
        c2.z += (targetSettings.color2[2] - c2.z) * lerpFactor;
        c3.x += (targetSettings.color3[0] - c3.x) * lerpFactor;
        c3.y += (targetSettings.color3[1] - c3.y) * lerpFactor;
        c3.z += (targetSettings.color3[2] - c3.z) * lerpFactor;

        mesh.rotation.y += 0.002;
        mesh.rotation.x += 0.001;

        composer.render();
    }

    animate();

    window.addEventListener('resize', () => {
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        camera.aspect = newWidth / newHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(newWidth, newHeight);
        composer.setSize(newWidth, newHeight);
    });
}

function setMoodThree(mood) {
    if (moodSettings[mood]) {
        targetSettings = moodSettings[mood];
    }
}

// ========================================
// UI И ОБРАБОТЧИКИ СОБЫТИЙ
// ========================================

function setMood(mood, btnElement) {
    currentMood = mood;
    document.querySelectorAll('.mood-item').forEach(b => b.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    setMoodThree(mood);

    document.getElementById('modeText').textContent = mood ? moodNames[mood] : 'не выбрано';
    document.getElementById('modeId').textContent = mood ? 'MOOD 0' + (['calm', 'dream', 'tension', 'chaos'].indexOf(mood) + 1) : '—';
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

const orbContainer = document.getElementById('orbContainer');
if (orbContainer) {
    initThreeOrb(orbContainer);
}

updateBalance(null);
updateSoundParams();