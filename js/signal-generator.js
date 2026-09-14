/**
 * signal-generator.js
 *
 * Port A signal generator for the SIH26144 infrasound sensor simulation.
 * Direct JS port of python-prototyping/signal_generator.py — same models,
 * same cited sources, same parameter names, so the two stay easy to
 * cross-check against each other.
 *
 * Each event type is based on a published, citable physical model rather
 * than an arbitrary waveform shape:
 *
 * 1. Explosion transient  -> Modified Friedlander equation
 *    Friedlander (1946); modified form standardized in Baker, "Explosion
 *    Hazards and Evaluation" (1973).
 *
 * 2. Weather drift        -> Slow oscillation below the synoptic/
 *    meteorological cutoff frequency (~0.01 Hz).
 *    Bedard & Georges (2000), "Atmospheric Infrasound," Physics Today 53, 32.
 *
 * 3. Periodic signal      -> Helmholtz resonance model (volcanic conduit /
 *    cavity resonance), a real documented periodic infrasound source.
 *    Goto & Johnson (2011), "Monotonic infrasound and Helmholtz resonance
 *    at Volcan Villarrica (Chile)," Geophys. Res. Lett. 38, L06301.
 *
 * 4. Broadband/wind noise -> von Karman turbulence spectrum shaping
 *    (Kolmogorov -5/3 slope in the inertial range) applied to white noise,
 *    instead of flat white noise.
 *    von Karman turbulence model (NACA report, 1957).
 */

export const SAMPLE_RATE_HZ = 100.0; // samples per second

/**
 * Modified Friedlander equation for blast pressure-time history.
 *
 * P(t) = p_max * (1 - (t - t_arrival)/t_duration) * exp(-alpha*(t - t_arrival)/t_duration)
 * for t >= t_arrival, else 0.
 *
 * @param {Float64Array|number[]} t
 * @param {number} tArrival
 * @param {number} pMax
 * @param {number} tDuration
 * @param {number} [decayAlpha=1.5]
 * @returns {Float64Array}
 */
export function friedlanderExplosion(t, tArrival, pMax, tDuration, decayAlpha = 1.5) {
  const y = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) {
    if (t[i] >= tArrival) {
      const tau = (t[i] - tArrival) / tDuration;
      y[i] = pMax * (1 - tau) * Math.exp(-decayAlpha * tau);
    }
  }
  return y;
}

/**
 * Slow synoptic-scale pressure oscillation, kept below the ~0.01 Hz
 * meteorological/infrasound band boundary (Bedard & Georges, 2000).
 *
 * @param {Float64Array|number[]} t
 * @param {number} amplitude
 * @param {number} [fDriftHz=0.005]
 * @param {number} [phase=0.0]
 * @returns {Float64Array}
 */
export function weatherDrift(t, amplitude, fDriftHz = 0.005, phase = 0.0) {
  const y = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) {
    y[i] = amplitude * Math.sin(2 * Math.PI * fDriftHz * t[i] + phase);
  }
  return y;
}

/**
 * Solve for the effective neck length L that reproduces a documented,
 * field-observed Helmholtz resonance frequency given real vent area and
 * cavity volume.
 *
 * Rearranging f0 = (c / 2*pi) * sqrt(S / (V * L)):
 *     L = S / (V * (2*pi*f0/c)^2)
 *
 * This calibration step mirrors a real limitation noted in Goto & Johnson
 * (2011): the idealized Helmholtz formula requires an effective neck
 * length correction (accounting for end effects at a short/wide neck) to
 * match field-observed frequencies. We are not inventing a fudge factor;
 * we are solving for the same effective-length correction the source
 * paper itself describes as necessary.
 *
 * @param {number} speedOfSound
 * @param {number} ventAreaM2
 * @param {number} cavityVolumeM3
 * @param {number} targetF0Hz
 * @returns {number}
 */
export function solveEffectiveNeckLength(speedOfSound, ventAreaM2, cavityVolumeM3, targetF0Hz) {
  const omegaOverC = (2 * Math.PI * targetF0Hz) / speedOfSound;
  return ventAreaM2 / (cavityVolumeM3 * omegaOverC ** 2);
}

// Real published geometry: Goto & Johnson (2011), Volcan Villarrica, Chile.
// Observed monotonic infrasound at 0.77 Hz; cavity volume 105 m^3; vent
// diameter 10 m (roof opening above the lava lake / spatter roof).
export const VILLARRICA_SPEED_OF_SOUND = 340.0; // m/s
export const VILLARRICA_VENT_RADIUS_M = 5.0; // from reported 10 m vent diameter
export const VILLARRICA_VENT_AREA_M2 = Math.PI * VILLARRICA_VENT_RADIUS_M ** 2;
export const VILLARRICA_CAVITY_VOLUME_M3 = 105.0;
export const VILLARRICA_OBSERVED_F0_HZ = 0.77;
export const VILLARRICA_EFFECTIVE_NECK_LENGTH_M = solveEffectiveNeckLength(
  VILLARRICA_SPEED_OF_SOUND,
  VILLARRICA_VENT_AREA_M2,
  VILLARRICA_CAVITY_VOLUME_M3,
  VILLARRICA_OBSERVED_F0_HZ
);

/**
 * Periodic infrasound from Helmholtz (cavity) resonance, following
 * Goto & Johnson (2011), "Monotonic infrasound and Helmholtz resonance at
 * Volcan Villarrica (Chile)," Geophys. Res. Lett. 38, L06301.
 *
 * f0 = (c / 2*pi) * sqrt(S / (V * L))
 *
 * Defaults reproduce the paper's actual documented case: real vent area
 * and cavity volume from field observation, with the effective neck
 * length calibrated (per the paper's own noted correction) to land on
 * the reported 0.77 Hz observed frequency. No display clamping needed
 * since this reflects a genuine, traceable physical case.
 *
 * @param {Float64Array|number[]} t
 * @param {number} amplitude
 * @param {object} [opts]
 * @returns {{y: Float64Array, f0: number}}
 */
export function helmholtzPeriodic(t, amplitude, opts = {}) {
  const {
    speedOfSound = VILLARRICA_SPEED_OF_SOUND,
    ventAreaM2 = VILLARRICA_VENT_AREA_M2,
    cavityVolumeM3 = VILLARRICA_CAVITY_VOLUME_M3,
    neckLengthM = VILLARRICA_EFFECTIVE_NECK_LENGTH_M,
  } = opts;

  const f0 = (speedOfSound / (2 * Math.PI)) * Math.sqrt(ventAreaM2 / (cavityVolumeM3 * neckLengthM));

  const y = new Float64Array(t.length);
  for (let i = 0; i < t.length; i++) {
    y[i] = amplitude * Math.sin(2 * Math.PI * f0 * t[i]);
  }
  return { y, f0 };
}

// ---- Minimal FFT (radix-2, iterative) + helpers for von Karman shaping ----
// signal_generator.py leans on numpy.fft; the browser has no FFT built in,
// so this is the smallest correct radix-2 implementation needed to
// reproduce the same rfft -> shape -> irfft round trip. n is rounded up to
// the next power of two internally and the result is trimmed back down,
// same effective behavior as numpy's fixed-length transform.

function nextPow2(n) {
  return 2 ** Math.ceil(Math.log2(n));
}

/** In-place iterative Cooley-Tukey FFT. re/im are Float64Arrays of length = power of 2. */
function fftInPlace(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1;
      let curWi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * curWr - im[i + j + len / 2] * curWi;
        const vi = re[i + j + len / 2] * curWi + im[i + j + len / 2] * curWr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nextWr = curWr * wr - curWi * wi;
        curWi = curWr * wi + curWi * wr;
        curWr = nextWr;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/**
 * Broadband turbulence noise shaped by the von Karman spectrum
 * (Kolmogorov -5/3 slope in the inertial subrange), rather than flat
 * white noise.
 *
 * Implemented by filtering white noise in the frequency domain with
 * Phi(k) ~ (1 + (k/k0)^2)^(-17/6), same as the Python version.
 *
 * @param {number} nSamples
 * @param {number} amplitude
 * @param {number} [sampleRate=SAMPLE_RATE_HZ]
 * @param {number} [k0=0.1]
 * @param {() => number} [randn] optional standard-normal generator (Box-Muller by default)
 * @returns {Float64Array} length nSamples
 */
export function vonKarmanNoise(nSamples, amplitude, sampleRate = SAMPLE_RATE_HZ, k0 = 0.1, randn = boxMuller) {
  const nFft = nextPow2(nSamples);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  for (let i = 0; i < nFft; i++) re[i] = i < nSamples ? randn() : 0;

  fftInPlace(re, im, false);

  // Frequency for each FFT bin (full spectrum, matches numpy.fft.fftfreq).
  for (let i = 0; i < nFft; i++) {
    let bin = i <= nFft / 2 ? i : i - nFft;
    let freq = Math.abs((bin * sampleRate) / nFft);
    if (i === 0) freq = sampleRate / nFft; // avoid div-by-zero at DC, mirrors python freqs[0] = freqs[1]

    const ratio = freq / k0;
    const spectrum = ratio ** 2 / (1 + ratio ** 2) ** (17 / 12); // sqrt of E(k) ~ k^4/(1+k^2)^(17/6)
    re[i] *= spectrum;
    im[i] *= spectrum;
  }

  fftInPlace(re, im, true);

  const shaped = re.slice(0, nSamples);

  // Normalize to requested amplitude (RMS-based scaling), same as Python.
  let sumSq = 0;
  for (let i = 0; i < nSamples; i++) sumSq += shaped[i] * shaped[i];
  const rms = Math.sqrt(sumSq / nSamples) + 1e-12;
  for (let i = 0; i < nSamples; i++) {
    shaped[i] = (shaped[i] / rms) * amplitude * 0.5;
  }
  return shaped;
}

/** Standard normal via Box-Muller transform (stand-in for numpy's default_rng().normal). */
function boxMuller() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Generate a Port A signal for the requested event type.
 *
 * @param {"explosion"|"drift"|"periodic"|"noise"} eventType
 * @param {number} durationS
 * @param {number} amplitude
 * @param {number} [sampleRate=SAMPLE_RATE_HZ]
 * @returns {{t: Float64Array, y: Float64Array, meta: object}}
 */
export function generateSignal(eventType, durationS, amplitude, sampleRate = SAMPLE_RATE_HZ) {
  const n = Math.floor(durationS * sampleRate);
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = (i * durationS) / n;

  let y;
  const meta = {};

  if (eventType === "explosion") {
    const tArrival = durationS * 0.3;
    const tDur = Math.max(durationS * 0.15, 0.5);
    y = friedlanderExplosion(t, tArrival, amplitude, tDur);
    meta.t_arrival_s = tArrival;
    meta.positive_phase_s = tDur;
  } else if (eventType === "drift") {
    const fDrift = 1.0 / (durationS * 1.5); // keep well below 0.01 Hz band edge conceptually
    const fDriftClamped = Math.min(fDrift, 0.009);
    y = weatherDrift(t, amplitude, fDriftClamped, 1.2);
    meta.f_drift_hz = fDriftClamped;
  } else if (eventType === "periodic") {
    const result = helmholtzPeriodic(t, amplitude);
    y = result.y;
    meta.f0_hz = result.f0;
  } else if (eventType === "noise") {
    y = vonKarmanNoise(n, amplitude, sampleRate);
  } else {
    throw new Error(`Unknown event_type: ${eventType}`);
  }

  // Small measurement-noise floor added to every signal (not the star of
  // the show, just realism) — matches the Python version's rng.normal(0, amplitude*0.02, n).
  for (let i = 0; i < n; i++) {
    y[i] += boxMuller() * amplitude * 0.02;
  }

  return { t, y, meta };
}