// Tiny synthesised interface sounds. Off by default; no audio files needed.
import { settings } from '../core/st.js';

let audio;

const PATTERNS = {
    click: [[880, 0.03]],
    boot: [[220, 0.08], [330, 0.08], [440, 0.08], [660, 0.14]],
    alert: [[620, 0.16], [440, 0.16], [620, 0.16], [440, 0.16]],
    jump: [[110, 0.2], [165, 0.2], [247, 0.2], [370, 0.3]],
    error: [[160, 0.12], [120, 0.18]],
};

export function blip(name) {
    if (!settings().sfx) return;
    try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        let t = audio.currentTime;
        for (const [freq, dur] of PATTERNS[name] ?? PATTERNS.click) {
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.type = name === 'alert' ? 'square' : 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            osc.connect(gain).connect(audio.destination);
            osc.start(t);
            osc.stop(t + dur + 0.02);
            t += dur;
        }
    } catch { /* audio unavailable */ }
}
