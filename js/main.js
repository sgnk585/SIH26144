// ============================================================
// SIH26144 — Infrasound Sensor Simulation
// Module 1: Signal Generator
// Module 2: Pneumatic RC Filter
// Module 3: Realism Layer (noise + drift + compensation)
// Module 4: Spectral Analysis (noise floor PSD)
// ============================================================

import { generateSignal } from "./signal-generator.js";

import {
    highPassDifferential,
    cornerFrequencyHz,
    frequencyResponseMagnitude,
    logFrequencySweep,
    REFERENCE_DESIGN
} from "./pneumatic_filter.js";

import {
    addSensorNoise,
    simulateTemperatureDrift,
    compensateDrift,
    estimateNoiseFloor
} from "./realism-layer.js";

import {
    computePowerSpectrum,
    powerSpectrumToDb,
    logBinAverage
} from "./spectral-analysis.js";

import { TransducerScene, bindExplosionToScroll } from "./transducer-3d.js";


// ============================================================
// SIMULATION CONSTANTS
// ============================================================

const SAMPLE_RATE = 100;   // samples/second
const DEFAULT_DURATION = 60;
const DEFAULT_AMPLITUDE = 1.0;

// Standard acoustic reference: 20 µPa squared, in Pa²/Hz units.
// Used by powerSpectrumToDb() to produce dB SPL-style values.
const SPL_REFERENCE_PA2 = (20e-6) ** 2;


// Reference pneumatic design from pneumatic_filter.js
// let so slider interactions can update them at runtime
let R = REFERENCE_DESIGN.R;
let C = REFERENCE_DESIGN.C;

let FC = cornerFrequencyHz(R, C);


// ============================================================
// DOM REFERENCES
// ============================================================

const eventTypeElement  = document.getElementById("eventType");
const amplitudeElement  = document.getElementById("amplitude");
const durationElement   = document.getElementById("duration");
const generateButton    = document.getElementById("generateButton");

const portACanvas       = document.getElementById("portACanvas");
const diffCanvas        = document.getElementById("diffCanvas");
const bodeCanvas        = document.getElementById("bodeCanvas");
const realismCanvas     = document.getElementById("realismCanvas");
const spectrumCanvas    = document.getElementById("spectrumCanvas");

// Realism toggle
const realismToggle     = document.getElementById("realismToggle");

// Status / header
const statusPill        = document.getElementById("statusPill");
const statusLabel       = statusPill ? statusPill.querySelector(".status-label") : null;

// KPI cards
const kpiFcEl           = document.getElementById("kpiFc");
const kpiPeakAEl        = document.getElementById("kpiPeakA");
const kpiPeakDiffEl     = document.getElementById("kpiPeakDiff");
const kpiSamplesEl      = document.getElementById("kpiSamples");
const kpiNoiseFloorEl   = document.getElementById("kpiNoiseFloor");

/**
 * Animate a KPI card numeric value counting up from 0 to targetVal over ~700ms using anime.js v3.
 * Preserves the exact formatting and precision from formatFn.
 * Falls back to instant setting if anime.js is unavailable.
 */
function animateKpiNumber(el, targetVal, formatFn, duration = 700) {
    if (!el) return;
    if (typeof anime === 'undefined' || typeof targetVal !== 'number' || isNaN(targetVal)) {
        el.textContent = typeof targetVal === 'number' ? formatFn(targetVal) : String(targetVal);
        return;
    }
    if (el._activeKpiAnim) {
        try { el._activeKpiAnim.pause(); } catch (_) {}
    }
    const animObj = { val: 0 };
    el._activeKpiAnim = anime({
        targets: animObj,
        val: targetVal,
        duration: duration,
        easing: "easeOutCubic",
        update: () => {
            el.textContent = formatFn(animObj.val);
        },
        complete: () => {
            el.textContent = formatFn(targetVal);
            el._activeKpiAnim = null;
        }
    });
}

// Pneumatic model sliders
const rSlider           = document.getElementById("rSlider");
const cSlider           = document.getElementById("cSlider");

// Model values (sidebar)
const rValueEl          = document.getElementById("rValue");
const cValueEl          = document.getElementById("cValue");
const fcValueEl         = document.getElementById("fcValue");

// Metadata panel fields
const metaStateEl       = document.getElementById("metaState");
const metaEventEl       = document.getElementById("metaEvent");
const metaAmplitudeEl   = document.getElementById("metaAmplitude");
const metaDurationEl    = document.getElementById("metaDuration");
const metaModelMetaEl   = document.getElementById("metaModelMeta");
const metaTimestampEl   = document.getElementById("metaTimestamp");


// ============================================================
// POPULATE STATIC REFERENCE VALUES
// (fc KPI is static at page load; updatePneumaticModel keeps it live)
// ============================================================

if (kpiFcEl) kpiFcEl.textContent = FC.toFixed(4);


// ============================================================
// THEME COLOURS (matches CSS custom properties)
// ============================================================

const THEME = {
    bg:          "#0c0d10",
    grid:        "#1a1d24",
    gridMid:     "#222630",
    zeroline:    "#2e333e",
    labelMuted:  "#4a5060",
    labelDim:    "#7a8190",
    label:       "#dde1e8",
    portA:       "#c8d8f0",
    diff:        "#6ec99a",
    bode:        "#4c9eff",
    bodeShade:   "rgba(76, 158, 255, 0.07)",
    minus3db:    "#3a4050",
    fcLine:      "rgba(76, 158, 255, 0.55)",
    font:        "12px 'IBM Plex Mono', monospace"
};


// ============================================================
// STATUS HELPERS
// ============================================================

function setStatus(state, text) {
    if (!statusPill || !statusLabel) return;
    statusPill.dataset.state = state;
    statusLabel.textContent  = text;
}


// ============================================================
// CANVAS SETUP
// ============================================================

function prepareCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;

    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx, width: rect.width, height: rect.height };
}


// ============================================================
// WAVEFORM PLOT
// ============================================================

/**
 * Internal frame renderer: draws grid, axes, labels, border, and the
 * waveform line up to `revealCount` samples. All other callers use the
 * public wrappers below; this function is not exported.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[]|Float64Array} t      - time axis
 * @param {number[]|Float64Array} signal  - full signal array (range computed from ALL samples)
 * @param {string} color
 * @param {number} revealCount           - how many samples to actually draw (1..signal.length)
 */
function _drawWaveformFrame(canvas, t, signal, color, revealCount) {

    const { ctx, width, height } = prepareCanvas(canvas);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    const margin = { left: 68, right: 18, top: 24, bottom: 38 };
    const plotW  = width  - margin.left - margin.right;
    const plotH  = height - margin.top  - margin.bottom;

    // ---- signal range (always computed from the FULL signal so the
    //      axis scale does not shift during animation) ----
    let minVal =  Infinity;
    let maxVal = -Infinity;

    for (const v of signal) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
    }

    if (maxVal === minVal) { maxVal += 1; minVal -= 1; }

    const pad  = 0.12 * (maxVal - minVal);
    maxVal += pad;
    minVal -= pad;

    const scaleY = (v) =>
        margin.top + ((maxVal - v) / (maxVal - minVal)) * plotH;

    const scaleX = (i) =>
        margin.left + (i / (signal.length - 1)) * plotW;

    // ---- horizontal grid ----
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth   = 1;

    for (let i = 0; i <= 4; i++) {
        const y = margin.top + (i / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(width - margin.right, y);
        ctx.stroke();
    }

    // ---- vertical grid ----
    for (let i = 0; i <= 5; i++) {
        const x = margin.left + (i / 5) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, height - margin.bottom);
        ctx.stroke();
    }

    // ---- y-axis tick labels ----
    ctx.font      = THEME.font;
    ctx.fillStyle = THEME.labelDim;
    ctx.textAlign = "right";

    for (let i = 0; i <= 4; i++) {
        const v   = maxVal - (i / 4) * (maxVal - minVal);
        const y   = margin.top + (i / 4) * plotH;
        const txt = Math.abs(v) < 0.001
            ? v.toExponential(1)
            : v.toPrecision(3);
        ctx.fillText(txt, margin.left - 6, y + 4);
    }

    // ---- x-axis labels ----
    ctx.textAlign = "center";

    for (let i = 0; i <= 5; i++) {
        const x = margin.left + (i / 5) * plotW;
        const s = ((t[t.length - 1] * i) / 5).toFixed(1);
        ctx.fillText(s + " s", x, height - 8);
    }

    ctx.textAlign = "start";

    // ---- zero line ----
    if (minVal < 0 && maxVal > 0) {
        const zy = scaleY(0);
        ctx.strokeStyle = THEME.zeroline;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(margin.left, zy);
        ctx.lineTo(width - margin.right, zy);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ---- waveform (up to revealCount samples) ----
    const count = Math.max(1, Math.min(revealCount, signal.length));
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();

    for (let i = 0; i < count; i++) {
        const x = scaleX(i);
        const y = scaleY(signal[i]);
        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
    }

    ctx.stroke();

    // ---- border ----
    ctx.strokeStyle = THEME.gridMid;
    ctx.lineWidth   = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
}

/**
 * Instant (non-animated) full waveform draw. Behaviour is identical to
 * the previous drawWaveform — any caller that does not need animation
 * (e.g. the realism canvas) continues to use this.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[]|Float64Array} t
 * @param {number[]|Float64Array} signal
 * @param {string} color
 */
function drawWaveform(canvas, t, signal, color) {
    _drawWaveformFrame(canvas, t, signal, color, signal.length);
}


// ============================================================
// REALISM CANVAS — 3-series overlay
// ============================================================

/**
 * Draws the realism / drift-compensation panel with three overlaid
 * waveform series on a single canvas:
 *
 *   1. driftedSeries   (orange #f0b429) — differential + slow drift
 *   2. noisySeries     (cool-white #c8d8f0) — drifted + electronic noise
 *   3. compensated     (green  #6ec99a) — noisy with drift subtracted
 *
 * All three share the same Y-axis range (computed from the full extent
 * of all three series together) so their relative displacements are
 * immediately obvious.  A small in-canvas legend is rendered in the
 * top-left corner.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Float64Array|number[]} t             - time axis
 * @param {Float64Array|number[]} driftedSeries  - signal + drift
 * @param {Float64Array|number[]} noisySeries    - signal + drift + noise
 * @param {Float64Array|number[]} compensated    - drift-compensated
 */
function drawRealismCanvas(canvas, t, driftedSeries, noisySeries, compensated) {
    const { ctx, width, height } = prepareCanvas(canvas);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    const margin = { left: 68, right: 18, top: 44, bottom: 38 };
    const plotW  = width  - margin.left - margin.right;
    const plotH  = height - margin.top  - margin.bottom;

    // ---- unified Y-axis range across all three series ----
    let minVal =  Infinity;
    let maxVal = -Infinity;
    for (const s of [driftedSeries, noisySeries, compensated]) {
        for (const v of s) {
            if (v < minVal) minVal = v;
            if (v > maxVal) maxVal = v;
        }
    }
    if (maxVal === minVal) { maxVal += 1; minVal -= 1; }
    const pad = 0.10 * (maxVal - minVal);
    maxVal += pad;
    minVal -= pad;

    const scaleY = (v) => margin.top + ((maxVal - v) / (maxVal - minVal)) * plotH;
    const scaleX = (i) => margin.left + (i / (t.length - 1)) * plotW;

    // ---- horizontal grid ----
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 4; i++) {
        const y = margin.top + (i / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(width - margin.right, y);
        ctx.stroke();
    }

    // ---- vertical grid ----
    for (let i = 0; i <= 5; i++) {
        const x = margin.left + (i / 5) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, height - margin.bottom);
        ctx.stroke();
    }

    // ---- y-axis labels ----
    ctx.font      = THEME.font;
    ctx.fillStyle = THEME.labelDim;
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
        const v   = maxVal - (i / 4) * (maxVal - minVal);
        const y   = margin.top + (i / 4) * plotH;
        const txt = Math.abs(v) < 0.001 ? v.toExponential(1) : v.toPrecision(3);
        ctx.fillText(txt, margin.left - 6, y + 4);
    }

    // ---- x-axis labels ----
    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
        const x = margin.left + (i / 5) * plotW;
        const s = ((t[t.length - 1] * i) / 5).toFixed(1);
        ctx.fillText(s + " s", x, height - 8);
    }

    // ---- zero line ----
    if (minVal < 0 && maxVal > 0) {
        const zy = scaleY(0);
        ctx.strokeStyle = THEME.zeroline;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(margin.left, zy);
        ctx.lineTo(width - margin.right, zy);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Helper: draw one full series
    function _drawSeries(series, color, lineWidth = 1.2) {
        ctx.strokeStyle = color;
        ctx.lineWidth   = lineWidth;
        ctx.beginPath();
        for (let i = 0; i < series.length; i++) {
            const x = scaleX(i);
            const y = scaleY(series[i]);
            if (i === 0) ctx.moveTo(x, y);
            else         ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    // Series 1: drifted (draw first / lowest z-order)
    _drawSeries(driftedSeries, "#f0b429", 1.0);
    // Series 2: noisy (faint, drawn over drift)
    ctx.globalAlpha = 0.55;
    _drawSeries(noisySeries,   "#c8d8f0", 1.0);
    ctx.globalAlpha = 1.0;
    // Series 3: compensated (topmost, bold)
    _drawSeries(compensated,   "#6ec99a", 2.0);

    // ---- in-canvas legend (top-left, inside plot area) ----
    const legendItems = [
        { color: "#f0b429", label: "+ drift" },
        { color: "#c8d8f0", label: "+ noise" },
        { color: "#6ec99a", label: "compensated" },
    ];
    const lx = margin.left + 8;
    let ly = margin.top + 6;
    ctx.font = "11px 'IBM Plex Mono', monospace";
    for (const { color, label } of legendItems) {
        // swatch
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(lx, ly + 5);
        ctx.lineTo(lx + 18, ly + 5);
        ctx.stroke();
        // label
        ctx.fillStyle = THEME.labelDim;
        ctx.textAlign = "left";
        ctx.fillText(label, lx + 22, ly + 8);
        ly += 16;
    }

    // ---- border ----
    ctx.strokeStyle = THEME.gridMid;
    ctx.lineWidth   = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
}

// Map<HTMLCanvasElement, number> — tracks live requestAnimationFrame IDs
// so a new animation can cancel the previous one on the same canvas.
const _animRafIds = new Map();

/**
 * Animated oscilloscope-style waveform reveal: draws the signal
 * progressively left-to-right over `durationMs` milliseconds using
 * requestAnimationFrame. If an animation is already running on `canvas`
 * it is cancelled before the new one starts.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[]|Float64Array} t
 * @param {number[]|Float64Array} signal
 * @param {string} color
 * @param {number} [durationMs=900]  - total reveal duration in milliseconds
 * @param {Function} [onComplete]    - optional callback when animation ends
 */
function drawWaveformAnimated(canvas, t, signal, color, durationMs = 900, onComplete) {
    // Cancel any in-flight animation on this canvas.
    if (_animRafIds.has(canvas)) {
        cancelAnimationFrame(_animRafIds.get(canvas));
        _animRafIds.delete(canvas);
    }

    const n         = signal.length;
    let   startTime = null;

    function frame(timestamp) {
        if (startTime === null) startTime = timestamp;

        // Linear progress 0..1
        const progress    = Math.min((timestamp - startTime) / durationMs, 1);
        const revealCount = Math.round(progress * n);

        _drawWaveformFrame(canvas, t, signal, color, revealCount);

        if (progress < 1) {
            // Schedule next frame and remember the ID for cancellation.
            _animRafIds.set(canvas, requestAnimationFrame(frame));
        } else {
            // Animation complete — clean up and notify caller.
            _animRafIds.delete(canvas);
            if (typeof onComplete === "function") onComplete();
        }
    }

    _animRafIds.set(canvas, requestAnimationFrame(frame));
}


// ============================================================
// BODE PLOT
// ============================================================

function drawBode(canvas) {

    const { ctx, width, height } = prepareCanvas(canvas);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    const margin = { left: 58, right: 30, top: 24, bottom: 48 };
    const plotW  = width  - margin.left - margin.right;
    const plotH  = height - margin.top  - margin.bottom;

    // ---- frequency / magnitude data ----
    const frequencies = logFrequencySweep(0.005, 20, 300);

    const magnitude = frequencyResponseMagnitude(frequencies, R, C);

    const db = magnitude.map(
        (v) => 20 * Math.log10(Math.max(v, 1e-12))
    );

    const minDb  = -50;
    const maxDb  = 5;
    const logMin = Math.log10(frequencies[0]);
    const logMax = Math.log10(frequencies[frequencies.length - 1]);

    const scaleX = (f) =>
        margin.left + ((Math.log10(f) - logMin) / (logMax - logMin)) * plotW;

    const scaleY = (d) =>
        margin.top + ((maxDb - d) / (maxDb - minDb)) * plotH;

    // ---- shaded 0.01–20 Hz infrasound band ----
    const bandX1 = scaleX(0.01);
    const bandX2 = scaleX(20);

    ctx.fillStyle = THEME.bodeShade;
    ctx.fillRect(
        Math.max(bandX1, margin.left),
        margin.top,
        Math.min(bandX2, width - margin.right) - Math.max(bandX1, margin.left),
        plotH
    );

    // ---- horizontal dB grid lines ----
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth   = 1;
    ctx.font        = THEME.font;

    for (let d = -50; d <= 0; d += 10) {
        const y = scaleY(d);

        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(width - margin.right, y);
        ctx.stroke();

        ctx.fillStyle = THEME.labelDim;
        ctx.textAlign = "right";
        ctx.fillText(`${d} dB`, margin.left - 6, y + 4);
    }

    // ---- vertical frequency grid — major decades ----
    const decades = [-2, -1, 0, 1];   // 0.01, 0.1, 1, 10 Hz

    for (const dec of decades) {
        const f = 10 ** dec;
        const x = scaleX(f);
        if (x < margin.left || x > width - margin.right) continue;

        ctx.strokeStyle = THEME.gridMid;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, height - margin.bottom);
        ctx.stroke();

        // frequency label
        const lbl = f < 1 ? `${f} Hz` : `${f} Hz`;
        ctx.fillStyle = THEME.labelDim;
        ctx.textAlign = "center";
        ctx.fillText(lbl, x, height - margin.bottom + 14);
    }

    // ---- minor vertical grid (2–9 per decade) ----
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth   = 1;

    for (let dec = -3; dec <= 1; dec++) {
        for (let m = 2; m <= 9; m++) {
            const f = m * 10 ** dec;
            const x = scaleX(f);
            if (x < margin.left || x > width - margin.right) continue;

            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, height - margin.bottom);
            ctx.stroke();
        }
    }

    // ---- 0.01 Hz band edge label ----
    const band01X = scaleX(0.01);
    if (band01X > margin.left && band01X < width - margin.right) {
        ctx.strokeStyle = THEME.labelMuted;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(band01X, margin.top);
        ctx.lineTo(band01X, height - margin.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = THEME.labelMuted;
        ctx.textAlign = "center";
        ctx.fillText("0.01 Hz", band01X, height - margin.bottom + 28);
    }

    // ---- -3 dB horizontal dashed line ----
    const minus3Y = scaleY(-3);

    ctx.strokeStyle = THEME.minus3db;
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(margin.left, minus3Y);
    ctx.lineTo(width - margin.right, minus3Y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = THEME.labelDim;
    ctx.textAlign = "left";
    ctx.fillText("−3 dB", width - margin.right + 4, minus3Y + 4);

    // ---- corner-frequency vertical line ----
    const fcX = scaleX(FC);

    ctx.strokeStyle = THEME.fcLine;
    ctx.lineWidth   = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(fcX, margin.top);
    ctx.lineTo(fcX, height - margin.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // fc marker dot at −3 dB intersection
    const fcDotY = scaleY(-3);
    ctx.fillStyle   = THEME.bode;
    ctx.beginPath();
    ctx.arc(fcX, fcDotY, 3.5, 0, 2 * Math.PI);
    ctx.fill();

    // fc label
    ctx.fillStyle = THEME.bode;
    ctx.textAlign = "left";

    const fcLabelX = Math.min(fcX + 8, width - 150);
    ctx.fillText(`fc = ${FC.toFixed(4)} Hz`, fcLabelX, margin.top + 14);

    // ---- Bode curve ----
    ctx.strokeStyle = THEME.bode;
    ctx.lineWidth   = 2;
    ctx.beginPath();

    for (let i = 0; i < frequencies.length; i++) {
        const x = scaleX(frequencies[i]);
        const y = scaleY(db[i]);

        if (i === 0) ctx.moveTo(x, y);
        else         ctx.lineTo(x, y);
    }

    ctx.stroke();

    // ---- axis labels ----
    ctx.fillStyle = THEME.labelDim;
    ctx.textAlign = "center";

    // x-axis label
    ctx.fillText("Frequency (Hz)  —  log scale", margin.left + plotW / 2, height - 4);

    // y-axis label (rotated)
    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Magnitude (dB)", 0, 0);
    ctx.restore();

    // ---- plot border ----
    ctx.strokeStyle = THEME.gridMid;
    ctx.lineWidth   = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
}


// ============================================================
// SPECTRUM PLOT — Noise Floor PSD
// ============================================================

/**
 * Draws the one-sided power spectral density of `series` onto `canvas`,
 * using a log-frequency x-axis styled identically to drawBode().
 * Y-axis auto-scales to the dB range actually present in the data;
 * NaN bins (empty log-frequency bins from logBinAverage) cause the line
 * to be broken rather than connecting across gaps.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Float64Array|number[]} series   - input signal (Pa)
 * @param {number} sampleRateHz
 */
function drawSpectrum(canvas, series, sampleRateHz) {

    const { ctx, width, height } = prepareCanvas(canvas);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, width, height);

    const margin = { left: 58, right: 30, top: 24, bottom: 48 };
    const plotW  = width  - margin.left - margin.right;
    const plotH  = height - margin.top  - margin.bottom;

    // ---- compute PSD (Hann window, 100 log bins) ----
    const { frequencies, psd } = computePowerSpectrum(series, sampleRateHz);
    const { binFrequencies, binPsd } = logBinAverage(frequencies, psd, 100);
    const binDb = powerSpectrumToDb(binPsd, SPL_REFERENCE_PA2);

    // ---- dB y-axis auto-range (skip NaN bins) ----
    let minDb =  Infinity;
    let maxDb = -Infinity;
    for (let i = 0; i < binDb.length; i++) {
        if (!isNaN(binDb[i])) {
            if (binDb[i] < minDb) minDb = binDb[i];
            if (binDb[i] > maxDb) maxDb = binDb[i];
        }
    }
    // Guard against all-NaN (e.g. empty series)
    if (!isFinite(minDb) || !isFinite(maxDb)) { minDb = -120; maxDb = 0; }
    // Add a small margin above and below the data range
    const dbPad = Math.max(5, 0.1 * (maxDb - minDb));
    maxDb += dbPad;
    minDb -= dbPad;

    // ---- x-axis frequency limits: 0.005 Hz to Nyquist (capped at 20 Hz) ----
    const fMin = 0.005;
    const fMax = Math.min(sampleRateHz / 2, 20);
    const logFMin = Math.log10(fMin);
    const logFMax = Math.log10(fMax);

    const scaleX = (f) =>
        margin.left + ((Math.log10(f) - logFMin) / (logFMax - logFMin)) * plotW;

    const scaleY = (d) =>
        margin.top + ((maxDb - d) / (maxDb - minDb)) * plotH;

    // ---- shaded 0.01–20 Hz infrasound band (same as drawBode) ----
    ctx.fillStyle = THEME.bodeShade;
    ctx.fillRect(
        Math.max(scaleX(0.01), margin.left),
        margin.top,
        Math.min(scaleX(fMax), width - margin.right) - Math.max(scaleX(0.01), margin.left),
        plotH
    );

    // ---- horizontal dB grid lines (10 dB intervals, auto-aligned) ----
    ctx.font = THEME.font;
    const dbStep = 10;
    const dbGridStart = Math.ceil(minDb / dbStep) * dbStep;
    for (let d = dbGridStart; d <= maxDb; d += dbStep) {
        const y = scaleY(d);
        ctx.strokeStyle = THEME.grid;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(width - margin.right, y);
        ctx.stroke();

        ctx.fillStyle = THEME.labelDim;
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(d)} dB`, margin.left - 6, y + 4);
    }

    // ---- vertical frequency grid — major decades (same as drawBode) ----
    const decades = [-2, -1, 0, 1];   // 0.01, 0.1, 1, 10 Hz
    for (const dec of decades) {
        const f = 10 ** dec;
        const x = scaleX(f);
        if (x < margin.left || x > width - margin.right) continue;

        ctx.strokeStyle = THEME.gridMid;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, height - margin.bottom);
        ctx.stroke();

        ctx.fillStyle = THEME.labelDim;
        ctx.textAlign = "center";
        ctx.fillText(`${f} Hz`, x, height - margin.bottom + 14);
    }

    // ---- minor vertical grid (2–9 per decade, same as drawBode) ----
    ctx.strokeStyle = THEME.grid;
    ctx.lineWidth   = 1;
    for (let dec = -3; dec <= 1; dec++) {
        for (let m = 2; m <= 9; m++) {
            const f = m * 10 ** dec;
            const x = scaleX(f);
            if (x < margin.left || x > width - margin.right) continue;
            ctx.beginPath();
            ctx.moveTo(x, margin.top);
            ctx.lineTo(x, height - margin.bottom);
            ctx.stroke();
        }
    }

    // ---- 0.01 Hz band-edge dashed line (same as drawBode) ----
    const band01X = scaleX(0.01);
    if (band01X > margin.left && band01X < width - margin.right) {
        ctx.strokeStyle = THEME.labelMuted;
        ctx.lineWidth   = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(band01X, margin.top);
        ctx.lineTo(band01X, height - margin.bottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = THEME.labelMuted;
        ctx.textAlign = "center";
        ctx.fillText("0.01 Hz", band01X, height - margin.bottom + 28);
    }

    // ---- PSD curve — break the line at NaN bins ----
    // NaN bins are empty log-frequency intervals (no FFT points fell inside).
    // Connecting across them would be misleading, so the path is split.
    ctx.strokeStyle = THEME.bode;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    let inStroke = false; // true while the current sub-path segment is open

    for (let i = 0; i < binFrequencies.length; i++) {
        const f = binFrequencies[i];
        const d = binDb[i];

        // Skip bins outside the plotted frequency window or with no data.
        if (isNaN(d) || f < fMin || f > fMax) {
            inStroke = false; // lift pen — next valid point starts a new segment
            continue;
        }

        const x = scaleX(f);
        const y = scaleY(d);

        if (!inStroke) {
            ctx.moveTo(x, y);
            inStroke = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // ---- axis labels (same style as drawBode) ----
    ctx.fillStyle = THEME.labelDim;
    ctx.textAlign = "center";
    ctx.fillText("Frequency (Hz)  —  log scale", margin.left + plotW / 2, height - 4);

    ctx.save();
    ctx.translate(10, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("PSD (dB SPL / Hz)", 0, 0);
    ctx.restore();

    // ---- plot border ----
    ctx.strokeStyle = THEME.gridMid;
    ctx.lineWidth   = 1;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
}


// ============================================================
// MAIN SIMULATION
// ============================================================

function runSimulation() {

    const eventType = eventTypeElement.value;
    const amplitude = Number(amplitudeElement.value);
    const duration  = Number(durationElement.value);

    // ---- validation ----
    if (!Number.isFinite(amplitude) || amplitude <= 0) {
        setStatus("error", "Invalid amplitude");
        if (metaStateEl) metaStateEl.textContent = "Error — invalid amplitude";
        return;
    }

    if (!Number.isFinite(duration) || duration <= 0) {
        setStatus("error", "Invalid duration");
        if (metaStateEl) metaStateEl.textContent = "Error — invalid duration";
        return;
    }

    setStatus("running", "Simulating…");

    // ---- MODULE 1: generate Port A signal ----
    const generated = generateSignal(
        eventType,
        duration,
        amplitude,
        SAMPLE_RATE
    );

    // ---- MODULE 2: pneumatic RC filter ----
    const filtered = highPassDifferential(
        generated.y,
        1 / SAMPLE_RATE,
        R,
        C
    );

    const differential = filtered.differential;

    // ---- MODULE 3: realism layer (noise + drift + compensation) ----
    if (realismToggle && realismToggle.checked) {

        // Compute peak amplitude of the post-filter differential signal.
        // Noise and drift parameters are scaled relative to this so the
        // artefacts are always visually proportionate regardless of the
        // user-selected signal amplitude.
        let peakDiffAbs = 0;
        for (const v of differential) {
            const a = Math.abs(v);
            if (a > peakDiffAbs) peakDiffAbs = a;
        }
        // Guard: if peak is essentially zero (e.g. pure DC with fc > signal),
        // fall back to a nominal 1 Pa reference so we still show something.
        const refAmp = peakDiffAbs > 1e-9 ? peakDiffAbs : 1.0;

        // Scale factors (illustrative — see realism-layer.js comments):
        //   noise RMS  ≈ 3% of peak amplitude  [ILLUSTRATIVE]
        //   drift amp  ≈ 10% of peak amplitude [ILLUSTRATIVE]
        const whiteRmsPa       = 0.03 * refAmp;  // [ILLUSTRATIVE]
        const flickerAmpPa     = 0.015 * refAmp; // [ILLUSTRATIVE]
        const driftAmplitudePa = 0.10 * refAmp;  // [ILLUSTRATIVE]

        const driftResult = simulateTemperatureDrift(differential, SAMPLE_RATE, {
            amplitudePa: driftAmplitudePa,
        });
        const noisy = addSensorNoise(driftResult.drifted, {
            whiteRmsPa,
            flickerAmplitudePa: flickerAmpPa,
        });
        const compResult = compensateDrift(noisy, SAMPLE_RATE, {});

        // Draw all three series on the realism canvas.
        drawRealismCanvas(
            realismCanvas,
            generated.t,
            driftResult.drifted,
            noisy,
            compResult.compensated
        );

        // Noise-floor estimate on the first 10% of samples (treat as
        // the "quiet" baseline segment for this demo).
        const quietEnd   = Math.max(1, Math.floor(noisy.length * 0.1));
        const quietSlice = noisy.slice(0, quietEnd);
        const noiseFloor = estimateNoiseFloor(quietSlice);

        // KPI card: noise floor count-up
        if (kpiNoiseFloorEl) {
            animateKpiNumber(kpiNoiseFloorEl, noiseFloor.rms, v => v.toPrecision(4));
        }
    } else {
        // Realism off: clear the realism canvas and show a placeholder message.
        if (realismCanvas) {
            const { ctx, width, height } = prepareCanvas(realismCanvas);
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = THEME.bg;
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = THEME.labelMuted;
            ctx.font      = THEME.font;
            ctx.textAlign = "center";
            ctx.fillText(
                "Enable \"Apply sensor realism\" to see drift compensation",
                width / 2,
                height / 2
            );
        }
        if (kpiNoiseFloorEl) {
            if (kpiNoiseFloorEl._activeKpiAnim) {
                try { kpiNoiseFloorEl._activeKpiAnim.pause(); } catch (_) {}
            }
            kpiNoiseFloorEl.textContent = "—";
        }
    }

    // ---- draw waveforms (animated oscilloscope reveal) ----
    drawWaveformAnimated(portACanvas, generated.t, generated.y,  THEME.portA);
    drawWaveformAnimated(diffCanvas,  generated.t, differential, THEME.diff);
    drawBode(bodeCanvas);
    drawSpectrum(spectrumCanvas, differential, SAMPLE_RATE);

    // ---- KPI cards ----
    let peakA    = 0;
    let peakDiff = 0;

    for (const v of generated.y)  { const a = Math.abs(v); if (a > peakA)    peakA    = a; }
    for (const v of differential) { const a = Math.abs(v); if (a > peakDiff) peakDiff = a; }

    // Animation 2: KPI number count-up from 0 to final computed value (~700ms)
    animateKpiNumber(kpiFcEl, FC, v => v.toFixed(4));
    animateKpiNumber(kpiPeakAEl, peakA, v => v.toPrecision(4));
    animateKpiNumber(kpiPeakDiffEl, peakDiff, v => v.toPrecision(4));
    animateKpiNumber(kpiSamplesEl, generated.y.length, v => Math.round(v).toLocaleString());

    // ---- metadata panel ----
    const metadataText =
        generated.meta && Object.keys(generated.meta).length > 0
            ? JSON.stringify(generated.meta)
            : "none";

    const eventLabels = {
        explosion: "Explosion transient",
        drift:     "Weather drift",
        periodic:  "Periodic / Helmholtz",
        noise:     "Wind / Broadband noise"
    };

    if (metaStateEl)     metaStateEl.textContent     = "Complete";
    if (metaEventEl)     metaEventEl.textContent     = eventLabels[eventType] || eventType;
    if (metaAmplitudeEl) metaAmplitudeEl.textContent = `${amplitude} Pa`;
    if (metaDurationEl)  metaDurationEl.textContent  = `${duration} s`;
    if (metaModelMetaEl) metaModelMetaEl.textContent = metadataText;
    if (metaTimestampEl) metaTimestampEl.textContent = new Date().toLocaleTimeString();

    setStatus("done", "Complete");

    // ---- console diagnostics ----
    console.log("Simulation complete");
    console.log("Event:",           eventType);
    console.log("Amplitude:",       amplitude, "Pa");
    console.log("Duration:",        duration, "s");
    console.log("Corner frequency:", FC, "Hz");
    console.log("Metadata:",        generated.meta);
}


// ============================================================
// PNEUMATIC MODEL — slider-driven live update
// ============================================================

/**
 * Read the log-scale R/C sliders, recompute linear R, C, and FC,
 * refresh the sidebar value spans, and redraw the Bode plot.
 * Does NOT re-run the full signal simulation (too expensive for
 * every drag tick; use Generate Signal for that).
 */
function updatePneumaticModel() {
    R  = 10 ** Number(rSlider.value);
    C  = 10 ** Number(cSlider.value);
    FC = cornerFrequencyHz(R, C);

    if (rValueEl)  rValueEl.textContent  = `${R.toExponential(3)} Pa·s/m³`;
    if (cValueEl)  cValueEl.textContent  = `${C.toExponential(3)} m³/Pa`;
    if (fcValueEl) fcValueEl.textContent = `${FC.toFixed(4)} Hz`;
    if (kpiFcEl)   kpiFcEl.textContent   = FC.toFixed(4);

    drawBode(bodeCanvas);
}

rSlider.addEventListener("input", updatePneumaticModel);
cSlider.addEventListener("input", updatePneumaticModel);


// ============================================================
// BUTTON
// ============================================================

generateButton.addEventListener("click", runSimulation);
if (realismToggle) realismToggle.addEventListener("change", runSimulation);


// ============================================================
// SIMULATOR LAUNCH / REVEAL HANDLER (Stage 2 -> Stage 3)
// ============================================================

const launchSimulatorBtn = document.getElementById("launchSimulatorBtn");
const layoutShell        = document.querySelector(".layout-shell");

if (launchSimulatorBtn && layoutShell) {
    launchSimulatorBtn.addEventListener("click", () => {
        layoutShell.classList.remove("simulator-hidden");

        // Smooth scroll to the simulator dashboard
        layoutShell.scrollIntoView({ behavior: "smooth", block: "start" });

        // Animation 4: Simulator reveal transition with anime.js (scale 0.98 -> 1, opacity 0 -> 1, 500ms)
        if (typeof anime !== 'undefined') {
            layoutShell.style.animation = "none";
            anime({
                targets: layoutShell,
                scale: [0.98, 1],
                opacity: [0, 1],
                duration: 500,
                easing: "easeOutQuad"
            });
        }

        // On next animation frame, canvases have valid dimensions in layout.
        // Re-trigger simulation and pneumatic model so all 5 plots render sharply.
        requestAnimationFrame(() => {
            runSimulation();
            updatePneumaticModel();
        });
    });
}


// ============================================================
// LEARN THE PHYSICS DRAWER HANDLER
// ============================================================

const learnPhysicsBtn       = document.getElementById("learnPhysicsBtn");
const physicsDrawerOverlay  = document.getElementById("physicsDrawerOverlay");
const physicsDrawer         = document.getElementById("physicsDrawer");
const physicsDrawerCloseBtn = document.getElementById("physicsDrawerCloseBtn");

function openPhysicsDrawer() {
    if (!physicsDrawerOverlay) return;
    physicsDrawerOverlay.classList.add("is-open");
    physicsDrawerOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    // Animation 3: Physics side panel slide-in (translateX: 100% -> 0%, opacity: 0 -> 1, ~400ms, easeOutCubic)
    if (typeof anime !== 'undefined' && physicsDrawer) {
        physicsDrawer.style.transition = "none";
        anime.remove(physicsDrawer);
        anime({
            targets: physicsDrawer,
            translateX: ["100%", "0%"],
            opacity: [0, 1],
            duration: 400,
            easing: "easeOutCubic"
        });
    }
}

function closePhysicsDrawer() {
    if (!physicsDrawerOverlay) return;
    // Animation 3 (reversed): Physics side panel slide-out
    if (typeof anime !== 'undefined' && physicsDrawer && physicsDrawerOverlay.classList.contains("is-open")) {
        physicsDrawer.style.transition = "none";
        anime.remove(physicsDrawer);
        anime({
            targets: physicsDrawer,
            translateX: ["0%", "100%"],
            opacity: [1, 0],
            duration: 400,
            easing: "easeOutCubic",
            complete: () => {
                physicsDrawerOverlay.classList.remove("is-open");
                physicsDrawerOverlay.setAttribute("aria-hidden", "true");
                document.body.style.overflow = "";
                physicsDrawer.style.transform = "";
                physicsDrawer.style.opacity = "";
                physicsDrawer.style.transition = "";
            }
        });
    } else {
        physicsDrawerOverlay.classList.remove("is-open");
        physicsDrawerOverlay.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }
}

if (learnPhysicsBtn) {
    learnPhysicsBtn.addEventListener("click", openPhysicsDrawer);
}

if (physicsDrawerCloseBtn) {
    physicsDrawerCloseBtn.addEventListener("click", closePhysicsDrawer);
}

if (physicsDrawerOverlay) {
    physicsDrawerOverlay.addEventListener("click", (e) => {
        if (e.target === physicsDrawerOverlay) {
            closePhysicsDrawer();
        }
    });
}

window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && physicsDrawerOverlay && physicsDrawerOverlay.classList.contains("is-open")) {
        closePhysicsDrawer();
    }
});


// ============================================================
// INITIAL RUN
// ============================================================

// If simulator is visible on load, run simulation; otherwise wait for Launch click
if (!layoutShell || !layoutShell.classList.contains("simulator-hidden")) {
    requestAnimationFrame(() => {
        runSimulation();
    });
}

// Mechanical Transducer 3D Visualization (scroll-driven exploded view)
const transducerContainer = document.getElementById("transducerCanvasContainer");
if (transducerContainer) {
    const transducerScene = new TransducerScene(transducerContainer);
    transducerScene.resize();

    const transducerScrollWrapper = document.getElementById("transducerScrollWrapper");
    const transducerCaptionLabel = document.getElementById("transducerCaptionLabel");
    const transducerCaptionDesc = document.getElementById("transducerCaptionDesc");

    if (transducerScrollWrapper) {
        bindExplosionToScroll(transducerScene, transducerScrollWrapper, {
            onActivePartChange(part) {
                if (transducerCaptionLabel && part && part.label) {
                    transducerCaptionLabel.textContent = part.label;
                }
                if (transducerCaptionDesc && part && part.description) {
                    transducerCaptionDesc.textContent = part.description;
                }
            }
        });
    }
}

// Sync sliders → displayed values and Bode plot on first load
updatePneumaticModel();

// ============================================================
// ANIMATION 1: LANDING CHIPS STAGGER REVEAL
// ============================================================

/**
 * Animation 1: Landing page chip row stagger.
 * Fades up and in (.landing-chip elements inside .landing-chip-row) with a staggered
 * delay (translateY: 15px -> 0, opacity: 0 -> 1, ~500ms, anime.stagger(80))
 * once the landing section scrolls into view.
 * If anime.js is unavailable, chips remain displayed normally without interruption.
 */
function initLandingChipsAnimation() {
    if (typeof anime === 'undefined') return;

    const chips = document.querySelectorAll(".landing-chip-row .landing-chip");
    if (chips.length === 0) return;

    // Set initial state: translated down 15px, opacity 0
    anime.set(chips, { opacity: 0, translateY: 15 });

    const playChipsAnimation = () => {
        anime({
            targets: chips,
            translateY: [15, 0],
            opacity: [0, 1],
            duration: 500,
            delay: anime.stagger(80),
            easing: "easeOutQuad"
        });
    };

    if ("IntersectionObserver" in window) {
        const landingSection = document.getElementById("landingSection") || document.querySelector(".landing-chip-row");
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    playChipsAnimation();
                    obs.disconnect();
                }
            });
        }, { threshold: 0.1 });

        if (landingSection) {
            observer.observe(landingSection);
        } else {
            playChipsAnimation();
        }
    } else {
        playChipsAnimation();
    }
}

initLandingChipsAnimation();

console.log("SIH26144 simulator loaded: Modules 1 + 2 + 3");