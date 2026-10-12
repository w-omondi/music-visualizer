export interface AudioFeatures {
    subBass: number;
    bass: number;
    lowMids: number;
    mids: number;
    upperMids: number;
    presence: number;
    brilliance: number;
    rms: number;
    energy: number;
    onset: number;
    sampleRate: number;
    frequency: Uint8Array<ArrayBuffer>;
}

export interface VisualizerSettings {
    sensitivity: number;
}

export const AUDIO_FREQUENCY_BANDS = [
    { key: 'subBass', minHz: 20, maxHz: 60 },
    { key: 'bass', minHz: 60, maxHz: 250 },
    { key: 'lowMids', minHz: 250, maxHz: 500 },
    { key: 'mids', minHz: 500, maxHz: 2000 },
    { key: 'upperMids', minHz: 2000, maxHz: 4000 },
    { key: 'presence', minHz: 4000, maxHz: 6000 },
    { key: 'brilliance', minHz: 6000, maxHz: 16000 },
] as const satisfies ReadonlyArray<{
    key: keyof Pick<
        AudioFeatures,
        'subBass' | 'bass' | 'lowMids' | 'mids' | 'upperMids' | 'presence' | 'brilliance'
    >;
    minHz: number;
    maxHz: number;
}>;

const FFT_SIZE = 8192;
const MIN_DB = -90;
const MAX_DB = -20;
const NORMALIZATION_FLOOR_DB = -82;
const NORMALIZATION_CEILING_DB = -34;
const BAND_ATTACK_SECONDS = 0.045;
const BAND_RELEASE_SECONDS = 0.24;
const ONSET_RELEASE_SECONDS = 0.2;
const ONSET_RETRIGGER_SECONDS = 0.085;

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function normalizeDecibels(decibels: number) {
    if (!Number.isFinite(decibels) || decibels <= NORMALIZATION_FLOOR_DB) {
        return 0;
    }

    const normalized = clamp(
        (decibels - NORMALIZATION_FLOOR_DB) / (NORMALIZATION_CEILING_DB - NORMALIZATION_FLOOR_DB),
        0,
        1,
    );
    return normalized * normalized * (3 - 2 * normalized);
}

export class AudioAnalyzer {
    private context: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private source: MediaElementAudioSourceNode | null = null;
    private frequencyData = new Uint8Array(new ArrayBuffer(FFT_SIZE / 2));
    private decibelData = new Float32Array(new ArrayBuffer(FFT_SIZE / 2));
    private waveformData = new Float32Array(new ArrayBuffer(FFT_SIZE));
    private previousMagnitudes = new Float32Array(FFT_SIZE / 2);
    private smoothedBands = new Float32Array(AUDIO_FREQUENCY_BANDS.length);
    private features: AudioFeatures = {
        subBass: 0,
        bass: 0,
        lowMids: 0,
        mids: 0,
        upperMids: 0,
        presence: 0,
        brilliance: 0,
        rms: 0,
        energy: 0,
        onset: 0,
        sampleRate: 44100,
        frequency: this.frequencyData,
    };
    private averageFlux = 0;
    private onsetEnvelope = 0;
    private lastOnsetAt = 0;

    public async attach(audio: HTMLAudioElement): Promise<boolean> {
        const AudioContextClass =
            window.AudioContext ||
            (
                window as typeof window & {
                    webkitAudioContext?: typeof AudioContext;
                }
            ).webkitAudioContext;

        if (!AudioContextClass) {
            return false;
        }

        if (!this.context) {
            this.context = new AudioContextClass();
        }

        if (!this.source) {
            this.source = this.context.createMediaElementSource(audio);
            this.analyser = this.context.createAnalyser();
            this.analyser.fftSize = FFT_SIZE;
            this.analyser.minDecibels = MIN_DB;
            this.analyser.maxDecibels = MAX_DB;
            this.analyser.smoothingTimeConstant = 0;
            this.source.connect(this.analyser);
            this.analyser.connect(this.context.destination);
        }

        if (this.context.state === 'suspended') {
            await this.context.resume();
        }

        return true;
    }

    public dispose() {
        this.analyser?.disconnect();
        this.source?.disconnect();
        this.analyser = null;
        this.source = null;

        const context = this.context;
        this.context = null;
        if (context && context.state !== 'closed') {
            void context.close().catch((error: unknown) => {
                console.error('Failed to close audio context', error);
            });
        }
    }

    public update(deltaSeconds = 1 / 60, active = true): AudioFeatures {
        const analyser = this.analyser;
        const context = this.context;
        if (!active || !analyser || !context || context.state === 'closed') {
            this.frequencyData.fill(0);
            this.previousMagnitudes.fill(0);
            this.decayFeatures(deltaSeconds);
            return this.features;
        }

        analyser.getByteFrequencyData(this.frequencyData);
        analyser.getFloatFrequencyData(this.decibelData);
        analyser.getFloatTimeDomainData(this.waveformData);

        const sampleRate = context.sampleRate;
        const binWidth = sampleRate / FFT_SIZE;
        const nyquist = sampleRate / 2;
        let rmsSquares = 0;

        for (let i = 0; i < this.waveformData.length; i += 1) {
            const sample = this.waveformData[i];
            rmsSquares += sample * sample;
        }

        const rms = Math.sqrt(rmsSquares / this.waveformData.length);
        const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
        const energy = normalizeDecibels(rmsDb);
        let flux = 0;
        let magnitudeTotal = 0;

        for (let i = 0; i < this.decibelData.length; i += 1) {
            const decibels = this.decibelData[i];
            const magnitude = Number.isFinite(decibels) ? Math.pow(10, decibels / 20) : 0;
            const previous = this.previousMagnitudes[i];
            flux += Math.max(0, magnitude - previous);
            magnitudeTotal += magnitude;
            this.previousMagnitudes[i] = magnitude;
        }

        const normalizedFlux = magnitudeTotal > 0 ? flux / magnitudeTotal : 0;
        const fluxBaseline = this.averageFlux;
        const onsetThreshold = Math.max(0.12, fluxBaseline * 1.8);
        const now = performance.now();
        if (
            energy > 0.025 &&
            normalizedFlux > onsetThreshold &&
            now - this.lastOnsetAt >= ONSET_RETRIGGER_SECONDS * 1000
        ) {
            const onsetStrength = clamp((normalizedFlux - onsetThreshold) * 3.2, 0, 1);
            this.onsetEnvelope = Math.max(this.onsetEnvelope, onsetStrength);
            this.lastOnsetAt = now;
        }

        const dt = clamp(deltaSeconds, 0, 0.1);
        const baselineAlpha = 1 - Math.exp(-dt / 1.5);
        this.averageFlux += (normalizedFlux - this.averageFlux) * baselineAlpha;
        this.onsetEnvelope *= Math.exp(-dt / ONSET_RELEASE_SECONDS);

        for (let bandIndex = 0; bandIndex < AUDIO_FREQUENCY_BANDS.length; bandIndex += 1) {
            const band = AUDIO_FREQUENCY_BANDS[bandIndex];
            const lowerBin = Math.max(1, Math.ceil(band.minHz / binWidth));
            const upperBin = Math.min(
                this.decibelData.length,
                Math.ceil(Math.min(band.maxHz, nyquist) / binWidth),
            );
            let power = 0;
            let binCount = 0;

            for (let bin = lowerBin; bin < upperBin; bin += 1) {
                const decibels = this.decibelData[bin];
                if (Number.isFinite(decibels) && decibels > MIN_DB) {
                    const amplitude = Math.pow(10, decibels / 20);
                    power += amplitude * amplitude;
                    binCount += 1;
                }
            }

            const bandRms = binCount > 0 ? Math.sqrt(power / binCount) : 0;
            const bandDb = bandRms > 0 ? 20 * Math.log10(bandRms) : -Infinity;
            const target = normalizeDecibels(bandDb);
            const current = this.smoothedBands[bandIndex];
            const tau = target > current ? BAND_ATTACK_SECONDS : BAND_RELEASE_SECONDS;
            const alpha = 1 - Math.exp(-dt / tau);
            this.smoothedBands[bandIndex] = current + (target - current) * alpha;

            const smoothed = this.smoothedBands[bandIndex];
            switch (band.key) {
                case 'subBass':
                    this.features.subBass = smoothed;
                    break;
                case 'bass':
                    this.features.bass = smoothed;
                    break;
                case 'lowMids':
                    this.features.lowMids = smoothed;
                    break;
                case 'mids':
                    this.features.mids = smoothed;
                    break;
                case 'upperMids':
                    this.features.upperMids = smoothed;
                    break;
                case 'presence':
                    this.features.presence = smoothed;
                    break;
                case 'brilliance':
                    this.features.brilliance = smoothed;
                    break;
            }
        }

        this.features.rms = rms;
        this.features.energy = energy;
        this.features.onset = this.onsetEnvelope;
        this.features.sampleRate = sampleRate;
        return this.features;
    }

    private decayFeatures(deltaSeconds: number) {
        const dt = clamp(deltaSeconds, 0, 0.1);
        const alpha = 1 - Math.exp(-dt / BAND_RELEASE_SECONDS);

        for (let i = 0; i < this.smoothedBands.length; i += 1) {
            this.smoothedBands[i] += (0 - this.smoothedBands[i]) * alpha;
        }

        this.features.subBass = this.smoothedBands[0];
        this.features.bass = this.smoothedBands[1];
        this.features.lowMids = this.smoothedBands[2];
        this.features.mids = this.smoothedBands[3];
        this.features.upperMids = this.smoothedBands[4];
        this.features.presence = this.smoothedBands[5];
        this.features.brilliance = this.smoothedBands[6];
        this.features.rms = 0;
        this.features.energy = 0;
        this.features.onset *= Math.exp(-dt / ONSET_RELEASE_SECONDS);
    }
}
