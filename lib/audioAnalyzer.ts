export interface AudioFeatures {
  bass: number;
  mids: number;
  treble: number;
  energy: number;
  beat: number;
  frequency: Uint8Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;
}

export interface VisualizerSettings {
  intensity: number;
  bassBoost: number;
  midsBoost: number;
  trebleBoost: number;
  beatSensitivity: number;
  cameraDrift: number;
  glow: number;
}

function createDefaultFeatures(): AudioFeatures {
  return {
    bass: 0,
    mids: 0,
    treble: 0,
    energy: 0,
    beat: 0,
    frequency: new Uint8Array(new ArrayBuffer(1024)),
    waveform: new Float32Array(new ArrayBuffer(1024)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export class AudioAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private frequencyData: Uint8Array<ArrayBuffer>;
  private waveformData: Float32Array<ArrayBuffer>;
  private smoothedEnergy = 0;
  private lastBeatAt = 0;
  private beatHold = 0;

  constructor() {
    this.frequencyData = new Uint8Array(new ArrayBuffer(2048));
    this.waveformData = new Float32Array(new ArrayBuffer(2048));
  }

  public async attach(audio: HTMLAudioElement | null) {
    if (!audio) {
      return;
    }

    this.audio = audio;

    const AudioContextClass =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    if (!this.context) {
      this.context = new AudioContextClass();
    }

    const ctx = this.context;

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (!this.source) {
      this.source = ctx.createMediaElementSource(audio);
    }

    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.source.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    }
  }

  public dispose() {
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.context) {
      void this.context.close();
      this.context = null;
    }
  }

  public update(): AudioFeatures {
    if (!this.analyser || !this.context) {
      return createDefaultFeatures();
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getFloatTimeDomainData(this.waveformData);

    const sampleRate = this.context.sampleRate || 44100;
    const nyquist = sampleRate / 2;
    const totalBins = this.frequencyData.length;

    const bandAverage = (minHz: number, maxHz: number) => {
      const maxIndex = clamp(Math.ceil((maxHz / nyquist) * totalBins), 1, totalBins - 1);
      const minIndex = clamp(Math.floor((minHz / nyquist) * totalBins), 0, maxIndex - 1);

      let sum = 0;
      for (let i = minIndex; i < maxIndex; i += 1) {
        sum += this.frequencyData[i] / 255;
      }

      return (sum / Math.max(1, maxIndex - minIndex)) || 0;
    };

    const bass = bandAverage(20, 250);
    const mids = bandAverage(250, 4000);
    const treble = bandAverage(4000, 20000);

    let waveformEnergy = 0;
    for (let i = 0; i < this.waveformData.length; i += 1) {
      waveformEnergy += Math.abs(this.waveformData[i]);
    }

    const waveform = clamp((waveformEnergy / this.waveformData.length) * 5, 0, 1);
    const energy = clamp(bass * 0.45 + mids * 0.35 + treble * 0.2 + waveform * 0.55, 0, 1);
    const smoothed = this.smoothedEnergy === 0 ? energy : this.smoothedEnergy * 0.85 + energy * 0.15;
    this.smoothedEnergy = smoothed;

    const delta = energy - smoothed;
    const beatThreshold = 0.12 + smoothed * 0.55;
    const now = performance.now();
    let beat = 0;

    if (delta > beatThreshold && now - this.lastBeatAt > 180) {
      beat = 1;
      this.lastBeatAt = now;
      this.beatHold = 1;
    } else {
      this.beatHold = Math.max(0, this.beatHold - 0.08);
      beat = this.beatHold;
    }

    return {
      bass: clamp(bass, 0, 1),
      mids: clamp(mids, 0, 1),
      treble: clamp(treble, 0, 1),
      energy: clamp(energy, 0, 1),
      beat: clamp(beat, 0, 1),
      frequency: this.frequencyData,
      waveform: this.waveformData,
    };
  }
}
