/**
 * spectral-analysis.js
 *
 * Module 4 (partial) — Spectral Analysis / Noise Floor Spectrum (SIH26144).
 *
 * Computes a one-sided Power Spectral Density (PSD) FROM DATA via FFT —
 * distinct from the analytical Bode magnitude curve in pneumatic_filter.js,
 * which evaluates the theoretical transfer function |Hhp(jω)| without
 * touching any actual signal samples.  This module takes a real measured
 * (or simulated) series and returns its empirical spectrum, suitable for
 * the "noise floor spectrum" plot goal in docs/Software_Stack.md §5.
 *
 * Method summary
 * ──────────────
 * 1. Windowing
 *    Before the FFT the input is multiplied sample-by-sample by a Hann
 *    window.  This is standard practice for non-periodic finite segments:
 *    a time-limited signal that does not start and end at the same value
 *    appears to the DFT as if it were periodically repeated, which
 *    introduces large-amplitude sidelobes (spectral leakage) from sharp
 *    edges at the segment boundaries.  The Hann window tapers the signal
 *    smoothly to zero at both ends, greatly reducing leakage.  See, e.g.,
 *    Harris (1978), "On the Use of Windows for Harmonic Analysis with the
 *    Discrete Fourier Transform," Proc. IEEE 66 — the canonical reference.
 *    The 'none' option disables windowing for callers that have already
 *    windowed externally or are processing a known periodic segment.
 *
 * 2. FFT (radix-2, Cooley-Tukey, iterative)
 *    Input is zero-padded to the next power of two.  The FFT is computed
 *    in-place on separate real and imaginary arrays (no complex-number
 *    objects, for cache efficiency).  The implementation here is fully
 *    self-contained and has no dependency on any other module in this
 *    repo — in particular it does NOT reuse the spectral-shaping logic
 *    inside signal-generator.js.
 *
 * 3. One-sided PSD normalisation
 *    For a real input of length N (after padding), the FFT produces N
 *    complex coefficients.  The one-sided PSD for bin k (k = 0 … N/2) is:
 *
 *      PSD[k] = (2 / (fs · S2)) · |X[k]|²     for k = 1 … N/2 − 1
 *      PSD[0] = (1 / (fs · S2)) · |X[0]|²      (DC, not doubled)
 *      PSD[N/2] = (1 / (fs · S2)) · |X[N/2]|²  (Nyquist, not doubled)
 *
 *    where  fs = sampleRateHz,  S2 = Σ w[n]²  (sum of squared window
 *    coefficients, the window's "power normalisation" factor).
 *
 *    This normalisation follows the convention adopted in most scientific
 *    software (e.g. numpy.fft + manual normalisation, scipy.signal.welch
 *    with scaling='density'), so that integrating PSD over frequency
 *    recovers approximately the signal variance for white noise input —
 *    this is the standard correctness check.
 *
 *    APPROXIMATION NOTE: this is a SINGLE-SEGMENT periodogram, not a
 *    multi-segment Welch estimate.  A single periodogram has high variance
 *    (each spectral estimate fluctuates by ~100% even in the large-N
 *    limit).  The logBinAverage() export below reduces visual noise by
 *    averaging within log-spaced frequency bins, but it is NOT a
 *    statistically equivalent substitute for Welch averaging over
 *    independent overlapping segments.  A proper Welch estimate would be
 *    a natural future improvement — flag this for the team if time permits
 *    before the demo.
 *
 * All exports are pure functions; no global state, no DOM access.
 *
 * References:
 *   Harris (1978), Proc. IEEE 66(1) — windowing for DFT.
 *   Cooley & Tukey (1965), Math. Comput. 19 — radix-2 FFT.
 *   docs/Software_Stack.md §5 — noise floor spectrum goal.
 */

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Returns the smallest power of two that is >= n.
 * Returns 1 for n <= 1.
 *
 * @param {number} n - positive integer
 * @returns {number}
 */
function _nextPow2(n) {
    if (n <= 1) return 1;
    let p = 1;
    while (p < n) p <<= 1;
    return p;
}

/**
 * Bit-reversal permutation in place on arrays re[] and im[] of length n
 * (n must be a power of two).
 *
 * @param {Float64Array} re
 * @param {Float64Array} im
 * @param {number} n
 */
function _bitReversal(re, im, n) {
    let j = 0;
    for (let i = 1; i < n; i++) {
        let bit = n >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            // Swap re
            const tr = re[i]; re[i] = re[j]; re[j] = tr;
            // Swap im
            const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
    }
}

/**
 * Iterative, in-place radix-2 Cooley-Tukey FFT (DIT, decimation-in-time).
 * Operates on separate real/imaginary Float64Arrays of length n (power of 2).
 * After this call, re[k] and im[k] hold the real and imaginary parts of X[k].
 *
 * Sign convention: X[k] = Σ x[n] · e^{-j 2π k n / N}  (forward DFT).
 *
 * @param {Float64Array} re - real part of input/output
 * @param {Float64Array} im - imaginary part of input/output (pass all-zeros for real input)
 * @param {number} n        - transform length, must be a power of two
 */
function _fftInPlace(re, im, n) {
    _bitReversal(re, im, n);

    // Butterfly stages: len = 2, 4, 8, … n
    for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        // Twiddle factor step angle: -2π / len
        const angleStep = -2 * Math.PI / len;
        const wRe = Math.cos(angleStep);
        const wIm = Math.sin(angleStep);

        for (let i = 0; i < n; i += len) {
            // Start each group with the trivial twiddle W^0 = 1 + 0j
            let curRe = 1.0;
            let curIm = 0.0;

            for (let k = 0; k < halfLen; k++) {
                const u = i + k;
                const v = u + halfLen;

                // Butterfly: (re[u], im[u]) and (re[v], im[v]) with twiddle cur
                const tRe = curRe * re[v] - curIm * im[v];
                const tIm = curRe * im[v] + curIm * re[v];

                re[v] = re[u] - tRe;
                im[v] = im[u] - tIm;
                re[u] = re[u] + tRe;
                im[u] = im[u] + tIm;

                // Advance twiddle: cur *= w
                const nextRe = curRe * wRe - curIm * wIm;
                curIm       = curRe * wIm + curIm * wRe;
                curRe       = nextRe;
            }
        }
    }
}

/**
 * Generate Hann window coefficients of length n.
 * w[k] = 0.5 · (1 − cos(2π k / (n−1)))
 *
 * For n=1 returns [1.0] as a degenerate edge case.
 *
 * @param {number} n
 * @returns {Float64Array}
 */
function _hannWindow(n) {
    const w = new Float64Array(n);
    if (n === 1) { w[0] = 1.0; return w; }
    const scale = (2 * Math.PI) / (n - 1);
    for (let i = 0; i < n; i++) {
        w[i] = 0.5 * (1 - Math.cos(scale * i));
    }
    return w;
}

/**
 * Sum of squared window coefficients (the "power normalisation" S2).
 * Used to compensate for the amplitude attenuation introduced by windowing
 * so that the PSD retains the correct power units.
 *
 * @param {Float64Array} w
 * @returns {number}
 */
function _windowPowerSum(w) {
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i] * w[i];
    return s;
}

// ── Exported functions ───────────────────────────────────────────────────────

/**
 * Computes a one-sided Power Spectral Density (PSD) from a real-valued
 * time-domain series using a single-segment periodogram.
 *
 * APPROXIMATION: this is a single-segment FFT periodogram, NOT a multi-
 * segment Welch estimate.  Each individual spectral bin has high variance
 * (~100% relative standard deviation regardless of series length) — the
 * result looks noisy on a frequency axis, especially on a log scale.
 * Use logBinAverage() to smooth the output for display purposes.
 * For a proper Welch estimate (lower variance, better for noise-floor
 * characterisation), split the series into overlapping segments and
 * average their periodograms — a natural improvement if time permits.
 *
 * @param {Float64Array|number[]} series
 *   Real-valued input signal (Pa), e.g. the output of
 *   addSensorNoise() in realism-layer.js, or the raw differential
 *   output from pneumatic_filter.js.
 * @param {number} sampleRateHz
 *   Sample rate in Hz.  Determines the frequency axis scaling and the
 *   PSD units (Pa²/Hz).
 * @param {object} [options]
 * @param {'hann'|'none'} [options.windowFn='hann']
 *   Windowing function applied before the FFT.  'hann' (default) reduces
 *   spectral leakage from non-periodic finite segments; 'none' disables
 *   windowing (appropriate only if the caller has already applied a window
 *   or the segment is guaranteed to be periodic).
 * @returns {{ frequencies: Float64Array, psd: Float64Array }}
 *   frequencies — one-sided frequency axis, 0 … sampleRateHz/2 (Hz),
 *                 length N/2 + 1 where N is the next power-of-two >= input.
 *   psd         — one-sided PSD, units Pa²/Hz (linear scale, not dB).
 *                 Use powerSpectrumToDb() to convert for display.
 */
export function computePowerSpectrum(series, sampleRateHz, options = {}) {
    const windowFn = options.windowFn ?? 'hann';
    const inputLen = series.length;

    if (inputLen === 0) {
        return { frequencies: new Float64Array(0), psd: new Float64Array(0) };
    }

    // ---- 1. Pad to next power of two ----
    const N = _nextPow2(inputLen);

    // Build real/imaginary arrays (imaginary is all-zero for real input)
    const re = new Float64Array(N);  // zero-padded
    const im = new Float64Array(N);  // always zero (real signal)

    // ---- 2. Apply window and copy into re[] ----
    let windowSumSq; // S2: window power-normalisation factor

    if (windowFn === 'hann') {
        // Window length matches the actual data length (not the padded length),
        // so the taper is applied to the meaningful samples only; the
        // zero-padded tail is already zero and needs no windowing.
        const w = _hannWindow(inputLen);
        windowSumSq = _windowPowerSum(w);
        for (let i = 0; i < inputLen; i++) {
            re[i] = series[i] * w[i];
        }
    } else {
        // No windowing — equivalent to a rectangular window.
        // S2 for a rectangular window of length inputLen is inputLen.
        windowSumSq = inputLen;
        for (let i = 0; i < inputLen; i++) {
            re[i] = series[i];
        }
    }

    // ---- 3. Forward FFT ----
    _fftInPlace(re, im, N);

    // ---- 4. One-sided PSD, normalised for Pa²/Hz ----
    //
    //   The normalisation factor  1 / (fs · S2)  comes from two steps:
    //     a) Parseval-style energy normalisation: divide |X[k]|² by N².
    //     b) Convert from energy spectral density to power spectral density:
    //        multiply by N/fs (the segment duration T = N/fs).
    //   Combined: (1/N²) * (N/fs) = 1/(N·fs).
    //   Replacing N by S2 (window power sum) accounts for the window's
    //   amplitude attenuation, giving 1/(fs·S2).
    //   The factor of 2 for two-sided→one-sided doubling (applied to all
    //   bins except DC and Nyquist which have no mirror) is included below.
    //
    //   Correctness check: for white noise with variance σ², the expected
    //   PSD is a flat σ²/(fs/2) across 0…fs/2, and integrating this PSD
    //   over frequency (multiplying each bin by its width Δf = fs/N, summing)
    //   should recover approximately σ².  Small deviations arise from the
    //   window's imperfect passband and the zero-padding extending N beyond
    //   the actual data length.

    const numPositiveBins = (N >> 1) + 1; // N/2 + 1 bins: 0, Δf, 2Δf, … fs/2
    const normFactor = 1.0 / (sampleRateHz * windowSumSq);

    const frequencies = new Float64Array(numPositiveBins);
    const psd         = new Float64Array(numPositiveBins);

    const df = sampleRateHz / N; // frequency resolution (Hz per bin)

    for (let k = 0; k < numPositiveBins; k++) {
        frequencies[k] = k * df;

        const magSq = re[k] * re[k] + im[k] * im[k];

        if (k === 0 || k === N >> 1) {
            // DC and Nyquist: no two-sided mirror, do NOT double.
            psd[k] = normFactor * magSq;
        } else {
            // All other bins: double to fold the negative-frequency energy
            // into the one-sided representation.
            psd[k] = 2.0 * normFactor * magSq;
        }
    }

    return { frequencies, psd };
}

/**
 * Converts a linear-scale PSD array to decibels relative to a reference value.
 *
 * Result[k] = 10 · log10( psd[k] / referenceValue )
 *
 * Any psd value below 1e-300 is clamped before the logarithm to prevent
 * -Infinity from propagating into plot renderers.
 *
 * The conventional reference for sound-pressure-level-style plots is
 * 20 µPa² (i.e. referenceValue = (20e-6)² ≈ 4e-10), but for this
 * simulator a reference of 1 Pa²/Hz is a reasonable dimensionless baseline.
 * Pass the reference appropriate for whatever citation the team is matching.
 *
 * @param {Float64Array|number[]} psd
 *   Linear-scale PSD in Pa²/Hz from computePowerSpectrum().
 * @param {number} [referenceValue=1]
 *   Reference power spectral density (Pa²/Hz) for the dB calculation.
 * @returns {Float64Array} dB values, same length as input
 */
export function powerSpectrumToDb(psd, referenceValue = 1) {
    const n = psd.length;
    const out = new Float64Array(n);
    const invRef = 1.0 / referenceValue;

    for (let i = 0; i < n; i++) {
        // Clamp to avoid log10(0) = -Infinity.
        const val = Math.max(psd[i], 1e-300);
        out[i] = 10 * Math.log10(val * invRef);
    }

    return out;
}

/**
 * Averages a linear-scale PSD into log-spaced frequency bins, producing a
 * smooth spectrum suitable for display on a logarithmic frequency axis.
 *
 * APPROXIMATION NOTE: this is a simple bin-averaging operation applied to
 * a single-segment periodogram.  It reduces visual noise by grouping many
 * raw FFT bins together in each displayed point, but it is NOT statistically
 * equivalent to a Welch/Bartlett multi-segment estimate (which achieves
 * variance reduction through averaging over independent time segments rather
 * than over frequency bins).  The two approaches have different trade-offs:
 *   - Log-bin averaging:  good frequency resolution at high frequencies,
 *     poor at low frequencies; uses all available data in one shot.
 *   - Welch (multi-segment): uniform frequency resolution; reduces variance
 *     at the cost of a shorter effective window per segment.
 * A proper Welch estimate would be a natural future improvement for the
 * team's noise-characterisation pipeline.
 *
 * Empty bins (frequency ranges with no FFT bin falling inside them, which
 * can occur at very low frequencies with short series) are filled with
 * NaN so callers can skip them when plotting or computing statistics.
 *
 * @param {Float64Array} frequencies
 *   Frequency axis from computePowerSpectrum(), in Hz.
 * @param {Float64Array} psd
 *   Linear-scale PSD from computePowerSpectrum(), same length as frequencies.
 * @param {number} numBins
 *   Number of log-spaced output bins.  Practical values: 50–200 for display.
 *   Larger values retain more frequency detail; smaller values produce a
 *   smoother curve.
 * @returns {{ binFrequencies: Float64Array, binPsd: Float64Array }}
 *   binFrequencies — geometric centre frequency of each bin (Hz)
 *   binPsd         — mean linear-scale PSD within each bin (Pa²/Hz);
 *                    NaN for empty bins (no FFT points fell inside)
 */
export function logBinAverage(frequencies, psd, numBins) {
    const n = frequencies.length;

    if (n === 0 || numBins <= 0) {
        return {
            binFrequencies: new Float64Array(0),
            binPsd:         new Float64Array(0)
        };
    }

    // Determine the frequency range, skipping the DC bin (f = 0) since
    // log10(0) is undefined.  fMin is the first positive frequency bin.
    let fMin = Infinity;
    let fMax = -Infinity;
    for (let i = 0; i < n; i++) {
        if (frequencies[i] > 0) {
            if (frequencies[i] < fMin) fMin = frequencies[i];
            if (frequencies[i] > fMax) fMax = frequencies[i];
        }
    }

    if (!isFinite(fMin) || !isFinite(fMax) || fMin >= fMax) {
        // Degenerate case (e.g. only a DC bin): return all-NaN.
        const binFrequencies = new Float64Array(numBins).fill(NaN);
        const binPsd         = new Float64Array(numBins).fill(NaN);
        return { binFrequencies, binPsd };
    }

    // Log-spaced bin edges: numBins + 1 edges spanning [fMin, fMax].
    const logFMin = Math.log10(fMin);
    const logFMax = Math.log10(fMax);
    const logStep = (logFMax - logFMin) / numBins;

    const binFrequencies = new Float64Array(numBins);
    const binPsd         = new Float64Array(numBins).fill(NaN);

    // Geometric centre of each bin: 10^(logEdge_k + logStep/2)
    for (let b = 0; b < numBins; b++) {
        binFrequencies[b] = 10 ** (logFMin + (b + 0.5) * logStep);
    }

    // Accumulate FFT bins into the log bins by sum + count, then average.
    const sums   = new Float64Array(numBins).fill(0);
    const counts = new Uint32Array(numBins).fill(0);

    for (let i = 0; i < n; i++) {
        const f = frequencies[i];
        if (f <= 0 || f < fMin || f > fMax) continue;  // skip DC and out-of-range

        // Find which log-bin this frequency falls into via floored log index.
        const b = Math.min(
            Math.floor((Math.log10(f) - logFMin) / logStep),
            numBins - 1
        );
        sums[b]   += psd[i];
        counts[b] += 1;
    }

    for (let b = 0; b < numBins; b++) {
        if (counts[b] > 0) {
            binPsd[b] = sums[b] / counts[b];
        }
        // If counts[b] === 0, binPsd[b] stays NaN (set in fill above).
    }

    return { binFrequencies, binPsd };
}
