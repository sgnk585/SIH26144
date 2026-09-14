/**
 * realism-layer.js
 *
 * Module 3 — Realism Layer (SIH26144).
 *
 * Sits between the Pneumatic Filter's DeltaP output (Module 2) and the
 * Live Dashboard / ML Classifier stages (Modules 4–5).  It represents the
 * instrument-grade analog front-end path of an MPX5010DP-class differential
 * pressure sensor, adding the noise and drift artefacts a real sensor
 * introduces before its ADC samples the signal.
 *
 * Physical model summary
 * ──────────────────────
 * 1. Thermal / analog-front-end noise
 *    Real low-noise analog front ends exhibit two dominant noise regimes:
 *      a) White (Johnson-Nyquist / thermal) noise — flat power spectral
 *         density, independent of frequency.  In a well-designed AFE the
 *         dominant contribution in the infrasound band is usually the
 *         transducer and first op-amp stage.
 *      b) Flicker (1/f) noise — power spectral density ∝ 1/f, dominant
 *         at very low frequencies.  For infrasound sensors this matters
 *         because the signal band (0.01 Hz – 20 Hz) overlaps the 1/f knee
 *         of most analog devices.
 *
 *    CITATION NOTE: the qualitative two-regime noise model is standard
 *    analogue-electronics theory (e.g. Horowitz & Hill, "The Art of
 *    Electronics"; Motchenbacher & Connelly, "Low-Noise Electronic System
 *    Design").  The specific noise-floor RMS number chosen as the default
 *    below is an illustrative order-of-magnitude placeholder — it has NOT
 *    been read from a specific equation or table in the Marcillo et al.
 *    (2012) JTECH paper.  The team should replace it with a value derived
 *    from whichever published noise-floor figure they decide to cite
 *    (e.g. the self-noise level quoted in the MPX5010DP datasheet, or
 *    the noise floor spectrum in Marcillo et al. Fig. 5).
 *
 * 2. Temperature-drift artefact (backing-volume thermal expansion)
 *    The sealed backing volume behind Port B expands and contracts with
 *    ambient temperature.  A slow temperature change ΔT causes a slow
 *    apparent pressure offset in the differential output — the same
 *    thermal false-signal failure mode described in
 *    docs/Infrasound_Simulation_Build_Context.md and Hardware_Layout.md.
 *    We model it as a slow sinusoid (one dominant thermal cycle) or a
 *    slow random walk, both clearly illustrative until tuned against
 *    real measured drift data.
 *
 * 3. Firmware-style drift compensation
 *    A long-window moving average (or equivalently, a very-low-corner
 *    high-pass IIR filter) estimates the slow drift component and
 *    subtracts it.  This is the same conceptual approach used in
 *    firmware compensation routines (distinct from the pneumatic RC
 *    high-pass in Module 2 — here the "filter" is applied in software
 *    after ADC sampling, not in the analog/pneumatic domain).
 *
 * All exports are pure functions; no global state, no DOM access.
 * No external RNG dependency — Box-Muller standard-normal generator
 * is implemented inline.
 *
 * References:
 *   Marcillo, Johnson & Hart (2012), J. Atmos. Oceanic Technol. 29 —
 *     the primary cited reference for the overall sensor design.
 *   MPX5010DP datasheet (NXP / Freescale) — MPX5010DP-class reference design.
 */

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Box-Muller transform: produces a pair of independent standard-normal
 * (mean=0, std=1) random samples from two uniform(0,1) samples.
 *
 * Guaranteed to be finite as long as u1 is strictly positive, which is
 * ensured by clamping below.
 *
 * @returns {{ z0: number, z1: number }}
 */
function _boxMuller() {
  // Clamp u1 away from zero to avoid log(0).
  const u1 = Math.max(Number.EPSILON, Math.random());
  const u2 = Math.random();
  const mag = Math.sqrt(-2.0 * Math.log(u1));
  const z0 = mag * Math.cos(2 * Math.PI * u2);
  const z1 = mag * Math.sin(2 * Math.PI * u2);
  return { z0, z1 };
}

/**
 * Fill a Float64Array with independent standard-normal samples,
 * consuming Box-Muller pairs two-at-a-time for efficiency.
 *
 * @param {number} length
 * @returns {Float64Array}
 */
function _standardNormalArray(length) {
  const out = new Float64Array(length);
  for (let i = 0; i < length; i += 2) {
    const { z0, z1 } = _boxMuller();
    out[i] = z0;
    if (i + 1 < length) out[i + 1] = z1;
  }
  return out;
}

// ── Default / illustrative constants ────────────────────────────────────────

/**
 * Default white-noise RMS level in Pascals.
 *
 * ILLUSTRATIVE PLACEHOLDER — NOT sourced from a specific equation or
 * table in Marcillo et al. (2012) or the MPX5010DP datasheet.
 * 1e-4 Pa = 0.1 mPa is an order-of-magnitude consistent with
 * low-noise infrasound sensors (self-noise of 10–100 mPa integrated
 * over the 0.01–20 Hz band is typical for MEMS-based designs), but
 * the team MUST replace this with a value traced to a specific cited
 * published figure before presenting characterisation results.
 */
const DEFAULT_WHITE_NOISE_RMS_PA = 1e-4; // [ILLUSTRATIVE]

/**
 * Default 1/f noise amplitude in Pascals (peak contribution at the
 * lowest representable frequency).
 *
 * ILLUSTRATIVE PLACEHOLDER — 1/f noise is real and well-documented in
 * analog front-ends (standard op-amp noise model), but the numerical
 * amplitude here has NOT been fitted to any published measurement.
 * Treat as a qualitative shape parameter only.
 */
const DEFAULT_FLICKER_AMPLITUDE_PA = 5e-5; // [ILLUSTRATIVE]

/**
 * Default thermal-drift sinusoid amplitude in Pascals.
 *
 * ILLUSTRATIVE PLACEHOLDER — real temperature drift magnitude depends
 * on backing-volume geometry, ambient temperature swing, and seal quality
 * (see docs/Infrasound_Simulation_Build_Context.md §4).  This default
 * is an order-of-magnitude guess for a small indoor enclosure; tune
 * against real measurements before citing.
 */
const DEFAULT_DRIFT_AMPLITUDE_PA = 2e-3; // [ILLUSTRATIVE]

/**
 * Default thermal-drift period in seconds.
 *
 * ILLUSTRATIVE PLACEHOLDER — a ~5-minute (300 s) thermal cycle is
 * plausible for a small enclosure responding to HVAC fluctuations, but
 * has NOT been measured or cited from a reference.
 */
const DEFAULT_DRIFT_PERIOD_S = 300; // [ILLUSTRATIVE]

/**
 * Default long-window length (in seconds) used by compensateDrift.
 *
 * Should be ≥ one full drift period to fully capture the slow component.
 * Chosen to be ~2× the default drift period as a conservative default.
 * ILLUSTRATIVE PLACEHOLDER — tune to the expected drift timescale.
 */
const DEFAULT_COMPENSATION_WINDOW_S = 600; // [ILLUSTRATIVE]

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Adds realistic analog-front-end noise to a differential-pressure series.
 *
 * Models two noise regimes:
 *   - White (thermal) noise: flat power-spectral-density added as
 *     independent Gaussian samples at each time step.
 *   - Optional 1/f-style low-frequency noise component: approximated by
 *     integrating white noise and then normalising, which yields a noise
 *     whose power spectral density falls as ~1/f².  This is a qualitative
 *     approximation of the standard 1/f AFE behaviour — NOT a fitted
 *     model.  For a more accurate 1/f spectrum (PSD ∝ 1/f rather than
 *     1/f²) a fractional Brownian motion generator or a spectral-shaping
 *     filter would be needed; mark that as a future improvement if the
 *     team decides to pursue it.
 *
 * @param {Float64Array|number[]} series
 *   Input DeltaP series (Pa), e.g. the differential output from
 *   pneumatic_filter.js → highPassDifferential().
 * @param {object} [options]
 * @param {number} [options.whiteRmsPa=DEFAULT_WHITE_NOISE_RMS_PA]
 *   RMS amplitude of the white-noise floor in Pascals.
 *   ILLUSTRATIVE DEFAULT — see constant comment above.
 * @param {boolean} [options.includeFlicker=true]
 *   Whether to add a 1/f-style low-frequency noise component.
 * @param {number} [options.flickerAmplitudePa=DEFAULT_FLICKER_AMPLITUDE_PA]
 *   Peak amplitude of the flicker noise contribution at the lowest
 *   representable frequency.  ILLUSTRATIVE DEFAULT — see constant comment.
 * @returns {Float64Array} noisy series, same length as input
 */
export function addSensorNoise(series, options = {}) {
  const n = series.length;
  const whiteRms = options.whiteRmsPa ?? DEFAULT_WHITE_NOISE_RMS_PA;
  const includeFlicker = options.includeFlicker ?? true;
  const flickerAmp = options.flickerAmplitudePa ?? DEFAULT_FLICKER_AMPLITUDE_PA;

  // --- White noise ---
  const whiteNoise = _standardNormalArray(n);
  for (let i = 0; i < n; i++) {
    whiteNoise[i] *= whiteRms; // scale to desired RMS
  }

  // --- 1/f-style noise (optional) ---
  // Cumulative sum of Gaussian increments produces a random walk whose
  // PSD ∝ 1/f²; this is the simplest qualitative surrogate for 1/f noise
  // in the infrasound band.  It is NOT a precision 1/f model — flagged
  // clearly here so it is not mistaken for one in the PR template.
  const flickerNoise = new Float64Array(n);
  if (includeFlicker && n > 1) {
    const rawFlicker = _standardNormalArray(n);
    let cumSum = 0;
    let maxAbs = 1e-300; // prevent divide-by-zero on degenerate input
    for (let i = 0; i < n; i++) {
      cumSum += rawFlicker[i];
      flickerNoise[i] = cumSum;
      if (Math.abs(cumSum) > maxAbs) maxAbs = Math.abs(cumSum);
    }
    // Normalise so the peak excursion equals flickerAmp.
    for (let i = 0; i < n; i++) {
      flickerNoise[i] = (flickerNoise[i] / maxAbs) * flickerAmp;
    }
  }

  // --- Combine ---
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = series[i] + whiteNoise[i] + flickerNoise[i];
  }
  return out;
}

/**
 * Adds a slow thermal-drift artefact to a DeltaP series.
 *
 * Models the physical failure mode where the sealed air in the backing
 * volume (Port B side) slowly changes pressure as the enclosure
 * temperature drifts, producing a slow apparent offset in the
 * differential output.  Two modes are available:
 *
 *   - 'sinusoid' (default): a single slow sinusoidal oscillation,
 *     mimicking a repeating HVAC or diurnal thermal cycle.  Parameters:
 *     amplitude and period.  ILLUSTRATIVE — not tuned to measured data.
 *   - 'randomwalk': a Brownian random walk low-pass filtered to the
 *     drift timescale, representing aperiodic temperature variation.
 *     ILLUSTRATIVE — not tuned to measured data.
 *
 * In both cases the model is clearly an approximation.  Real drift
 * characterisation would require placing the sensor in a temperature-
 * controlled environment and measuring the offset vs. time; see
 * docs/Infrasound_Simulation_Build_Context.md §4 for the physical
 * motivation.
 *
 * @param {Float64Array|number[]} series
 *   Input DeltaP series (Pa).
 * @param {number} sampleRateHz
 *   Sample rate of the series in Hz.
 * @param {object} [options]
 * @param {'sinusoid'|'randomwalk'} [options.mode='sinusoid']
 *   Drift waveform shape.
 * @param {number} [options.amplitudePa=DEFAULT_DRIFT_AMPLITUDE_PA]
 *   Peak drift amplitude in Pascals.  ILLUSTRATIVE DEFAULT.
 * @param {number} [options.periodS=DEFAULT_DRIFT_PERIOD_S]
 *   Thermal-cycle period in seconds (sinusoid mode).  ILLUSTRATIVE DEFAULT.
 * @param {number} [options.phaseRad=0]
 *   Initial phase offset for the sinusoid (radians).  Allows generating
 *   varied training examples with different drift phases.
 * @returns {{ drifted: Float64Array, driftComponent: Float64Array }}
 *   drifted          — input series with drift added (Pa)
 *   driftComponent   — the drift artefact alone (Pa), for dashboard
 *                      visualisation of "what was added"
 */
export function simulateTemperatureDrift(series, sampleRateHz, options = {}) {
  const n = series.length;
  const mode = options.mode ?? 'sinusoid';
  const amplitude = options.amplitudePa ?? DEFAULT_DRIFT_AMPLITUDE_PA;
  const periodS = options.periodS ?? DEFAULT_DRIFT_PERIOD_S;
  const phaseRad = options.phaseRad ?? 0;

  const dt = 1 / sampleRateHz;
  const driftComponent = new Float64Array(n);

  if (mode === 'sinusoid') {
    // Slow sinusoidal thermal cycle.
    // ILLUSTRATIVE — a single sinusoid is the simplest model of a
    // repeating thermal source (e.g. HVAC cycling).  Real drift may
    // be multi-periodic or aperiodic.
    const omega = (2 * Math.PI) / periodS;
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      driftComponent[i] = amplitude * Math.sin(omega * t + phaseRad);
    }
  } else if (mode === 'randomwalk') {
    // Random-walk (Brownian) drift, low-pass filtered to the drift
    // timescale so the walk only moves on timescales >= periodS.
    // Implemented as exponentially-smoothed increments:
    //   drift[i] = drift[i-1] + alpha*(increment[i] - drift[i-1])
    // where alpha corresponds to the drift-period corner frequency.
    // ILLUSTRATIVE — not fitted to measured thermal data.
    const RC = periodS / (2 * Math.PI); // convert period to RC time constant
    const alpha = dt / (RC + dt);       // discrete-time smoothing coefficient
    const increments = _standardNormalArray(n);
    // Scale increments so the long-run RMS is close to amplitude / sqrt(2).
    const incrementScale = amplitude * Math.sqrt(2 * alpha);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      prev = prev + alpha * (increments[i] * incrementScale - prev);
      driftComponent[i] = prev;
    }
  } else {
    throw new Error(
      `simulateTemperatureDrift: unknown mode "${mode}". Use 'sinusoid' or 'randomwalk'.`
    );
  }

  const drifted = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    drifted[i] = series[i] + driftComponent[i];
  }
  return { drifted, driftComponent };
}

/**
 * Firmware-style drift compensation: estimates the slow thermal-drift
 * component using a long-window causal moving average, then subtracts
 * it to recover the signal.
 *
 * Design rationale:
 *   A causal moving average over W samples acts as a low-pass filter
 *   with a corner frequency fc ≈ 1 / (pi * W * dt).  When the window is
 *   much longer than the infrasound signals of interest (≤ 20 Hz) but
 *   covers the drift timescale (hundreds of seconds), it isolates the
 *   drift component in the estimate, which is then subtracted.
 *
 *   This is conceptually equivalent to a very-low-corner-frequency
 *   high-pass filter applied in firmware after ADC sampling — distinct
 *   from the pneumatic RC high-pass in pneumatic_filter.js, which
 *   operates in the analog/pneumatic domain before digitisation.
 *
 *   At the start of the series (fewer than windowSamples samples
 *   available) the average is computed over the available prefix, which
 *   can introduce a brief transient in the first window length.  This
 *   is intentional and realistic — a real firmware algorithm would have
 *   the same cold-start behaviour.
 *
 * @param {Float64Array|number[]} series
 *   DeltaP series that may contain a slow drift artefact (Pa).
 * @param {number} sampleRateHz
 *   Sample rate in Hz.
 * @param {object} [options]
 * @param {number} [options.windowS=DEFAULT_COMPENSATION_WINDOW_S]
 *   Moving-average window length in seconds.  Should be >= one full
 *   drift period to fully capture the slow component.
 *   ILLUSTRATIVE DEFAULT — tune to the expected drift timescale.
 * @returns {{ compensated: Float64Array, estimatedDrift: Float64Array }}
 *   compensated    — drift-compensated series (Pa)
 *   estimatedDrift — the estimated drift that was removed (Pa), returned
 *                    so the dashboard can plot "drift removed" for the demo
 */
export function compensateDrift(series, sampleRateHz, options = {}) {
  const n = series.length;
  const windowS = options.windowS ?? DEFAULT_COMPENSATION_WINDOW_S;
  const windowSamples = Math.max(1, Math.round(windowS * sampleRateHz));

  const estimatedDrift = new Float64Array(n);
  const compensated = new Float64Array(n);

  // Causal moving average computed incrementally in O(n) using a
  // running sum.  At sample i, the average covers
  // samples [max(0, i - windowSamples + 1) .. i].
  let runningSum = 0;
  for (let i = 0; i < n; i++) {
    runningSum += series[i];
    if (i >= windowSamples) {
      // Remove the sample that just fell out of the window.
      runningSum -= series[i - windowSamples];
    }
    const count = Math.min(i + 1, windowSamples);
    estimatedDrift[i] = runningSum / count;
    compensated[i] = series[i] - estimatedDrift[i];
  }

  return { compensated, estimatedDrift };
}

/**
 * Estimates the noise floor of a quiet (no-signal) DeltaP series.
 *
 * Returns mean, standard deviation, and RMS — the same three statistics
 * used in sensor characterisation tables (e.g. the characterisation goal
 * in docs/Software_Stack.md §5 "noise floor spectrum").  When called on
 * a quiet stretch of the simulated signal these numbers should match the
 * injected noise parameters in addSensorNoise(), providing a
 * self-consistency check for the demo.
 *
 * RMS is the true root-mean-square (includes DC offset if any), while
 * std is the zero-mean standard deviation.  For a pure zero-mean noise
 * process they are equal; if there is a residual DC offset, RMS > std.
 *
 * @param {Float64Array|number[]} series
 *   A quiet segment of the DeltaP series (Pa) — ideally a stretch with
 *   no simulated infrasound event and no thermal drift applied.
 * @returns {{ mean: number, std: number, rms: number }}
 */
export function estimateNoiseFloor(series) {
  const n = series.length;
  if (n === 0) {
    return { mean: 0, std: 0, rms: 0 };
  }

  // Mean
  let sum = 0;
  for (let i = 0; i < n; i++) sum += series[i];
  const mean = sum / n;

  // Variance (Bessel-corrected for n > 1, uncorrected for n === 1)
  let sumSqDev = 0;
  for (let i = 0; i < n; i++) {
    const dev = series[i] - mean;
    sumSqDev += dev * dev;
  }
  const variance = n > 1 ? sumSqDev / (n - 1) : sumSqDev;
  const std = Math.sqrt(variance);

  // True RMS (includes DC component)
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += series[i] * series[i];
  const rms = Math.sqrt(sumSq / n);

  return { mean, std, rms };
}
