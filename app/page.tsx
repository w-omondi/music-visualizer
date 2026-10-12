"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Expand,
  Minimize2,
  Music4,
  Pause,
  Play,
  Upload,
  Volume2,
} from "lucide-react";

import { VisualizerScene } from "@/components/VisualizerScene";
import { AudioAnalyzer, type VisualizerSettings } from "@/lib/audioAnalyzer";

const PRESETS: Array<{ name: string; settings: VisualizerSettings }> = [
  {
    name: "Aurora",
    settings: {
      intensity: 0.68,
      bassBoost: 0.75,
      midsBoost: 0.7,
      trebleBoost: 0.8,
      beatSensitivity: 0.72,
      cameraDrift: 0.52,
      glow: 0.78,
    },
  },
  {
    name: "Pulse",
    settings: {
      intensity: 0.82,
      bassBoost: 0.92,
      midsBoost: 0.6,
      trebleBoost: 0.68,
      beatSensitivity: 0.9,
      cameraDrift: 0.72,
      glow: 0.86,
    },
  },
  {
    name: "Horizon",
    settings: {
      intensity: 0.56,
      bassBoost: 0.58,
      midsBoost: 0.84,
      trebleBoost: 0.9,
      beatSensitivity: 0.64,
      cameraDrift: 0.35,
      glow: 0.62,
    },
  },
];

const SETTING_CONTROLS: Array<{ label: string; key: keyof VisualizerSettings }> = [
  { label: "Intensity", key: "intensity" },
  { label: "Bass", key: "bassBoost" },
  { label: "Mids", key: "midsBoost" },
  { label: "Treble", key: "trebleBoost" },
  { label: "Beat", key: "beatSensitivity" },
  { label: "Camera", key: "cameraDrift" },
  { label: "Glow", key: "glow" },
];

export default function Home() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [analyzer] = useState(() => new AudioAnalyzer());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedPreset, setSelectedPreset] = useState(PRESETS[0].name);
  const [settings, setSettings] = useState<VisualizerSettings>(PRESETS[0].settings);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);

  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) {
      return "0:00";
    }

    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60)
      .toString()
      .padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    void analyzer.attach(audio);

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [analyzer]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const audioLabel = useMemo(() => {
    if (!audioUrl) {
      return "No track loaded";
    }

    return "Loaded audio";
  }, [audioUrl]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      fileInputRef.current?.click();
      return;
    }

    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const isSupported = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/x-m4a"].includes(file.type)
      || /\.(mp3|wav|ogg|m4a)$/i.test(file.name);

    if (!isSupported) {
      alert("Please upload an MP3, WAV, OGG, or M4A file");
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(nextUrl);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);

    const audio = audioRef.current;
    if (audio) {
      audio.src = nextUrl;
      audio.load();
      void audio.play();
    }
  };

  const handleSeek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) {
      return;
    }

    audio.currentTime = value;
    setCurrentTime(value);
  };

  const handleVolumeChange = (value: number) => {
    const nextVolume = clamp(value, 0, 1);
    setVolume(nextVolume);
    if (audioRef.current) {
      audioRef.current.volume = nextVolume;
    }
  };

  const selectPreset = (presetName: string) => {
    const preset = PRESETS.find((item) => item.name === presetName);
    if (!preset) {
      return;
    }

    setSelectedPreset(preset.name);
    setSettings(preset.settings);
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      return;
    }

    await document.exitFullscreen();
  };

  const exportVideo = async () => {
    if (!canvasElement) {
      return;
    }

    setIsExporting(true);

    try {
      const stream = canvasElement.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "visualizer-export.webm";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setIsExporting(false);
      };

      recorder.start();
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          recorder.stop();
          resolve();
        }, 6000);
      });
    } catch (error) {
      console.error("Export failed", error);
      setIsExporting(false);
    }
  };

  return (
    <main className="relative h-dvh overflow-hidden bg-[#030711] text-white">
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a"
        className="hidden"
        onChange={handleFileChange}
      />

      <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.14),transparent_33%),radial-gradient(circle_at_bottom,_rgba(168,85,247,0.12),transparent_30%)]" />

      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-3 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-400/10 text-cyan-200 sm:h-10 sm:w-10">
              <Music4 className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div>
              <p className="text-[0.55rem] uppercase tracking-[0.2rem] text-slate-300/80 sm:text-[0.65rem] sm:tracking-[0.28rem]">Audio-reactive</p>
              <h1 className="text-base font-semibold text-white sm:text-lg">Luma Pulse</h1>
            </div>
          </div>

          <div className="flex max-w-[48%] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[0.65rem] text-slate-200 backdrop-blur-md sm:max-w-full sm:px-3 sm:py-2 sm:text-xs">
            <div className={`h-2 w-2 shrink-0 rounded-full ${isPlaying ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" : "bg-slate-500"}`} />
            <span className="truncate">{audioLabel}</span>
          </div>
        </header>

        <div className="app-content-grid relative grid min-h-0 flex-1 grid-cols-1 grid-rows-[clamp(7.5rem,23svh,13rem)_minmax(0,1fr)] gap-2 overflow-hidden px-2 pb-2 pt-1 sm:grid-rows-[clamp(9rem,28svh,18rem)_minmax(0,1fr)] sm:gap-3 sm:px-5 sm:pb-5 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:grid-rows-1 md:items-stretch lg:gap-4 lg:px-8 lg:pb-6">
          <div className="relative min-h-0 overflow-hidden rounded-[20px] border border-white/10 bg-slate-950/70 shadow-2xl shadow-cyan-950/30 backdrop-blur-md sm:rounded-[28px]">
            <VisualizerScene analyzer={analyzer} settings={settings} isPlaying={isPlaying} onCanvasReady={setCanvasElement} />
          </div>

          <aside className="visualizer-panel relative z-10 flex min-h-0 w-full min-w-0 flex-col justify-between overflow-hidden rounded-[20px] border border-white/10 bg-slate-950/65 p-3 shadow-xl shadow-slate-950/40 backdrop-blur-xl sm:rounded-[24px] sm:p-4 md:max-w-[355px] lg:p-5">
            <div className="visualizer-panel-top space-y-2 sm:space-y-3 lg:space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[0.6rem] uppercase tracking-[0.2rem] text-slate-400 sm:text-xs sm:tracking-[0.3rem]">Preset</p>
                  <h2 className="mt-0.5 text-base font-semibold text-white sm:mt-1 sm:text-lg">{selectedPreset}</h2>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-200 sm:p-2"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => selectPreset(preset.name)}
                    className={`rounded-lg border px-2 py-1.5 text-[0.65rem] font-medium transition sm:rounded-xl sm:py-2 sm:text-xs ${
                      selectedPreset === preset.name
                        ? "border-cyan-400/60 bg-cyan-400/15 text-cyan-100"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>

              <div className="visualizer-settings grid grid-cols-2 gap-x-4 gap-y-1 sm:gap-y-2 lg:gap-x-5">
                {SETTING_CONTROLS.map(({ label, key }) => (
                  <label key={key} className="block">
                    <div className="mb-0.5 flex items-center justify-between text-[0.58rem] uppercase tracking-[0.12rem] text-slate-300 sm:mb-1 sm:text-[0.68rem] sm:tracking-[0.16rem]">
                      <span>{label}</span>
                      <span>{settings[key].toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={settings[key]}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          [key]: Number(event.target.value),
                        }))
                      }
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400 sm:h-2"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="visualizer-panel-bottom mt-2 space-y-2 sm:mt-3 sm:space-y-3 lg:mt-4">
              <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/40 p-1.5 sm:gap-2 sm:rounded-2xl sm:p-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-100 transition hover:bg-cyan-500/30 sm:h-11 sm:w-11 sm:rounded-xl"
                  title="Upload audio"
                >
                  <Upload className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={togglePlayback}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/15 sm:h-11 sm:w-11 sm:rounded-xl"
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={exportVideo}
                  disabled={!canvasElement || isExporting}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-violet-100 transition hover:bg-violet-500/30 disabled:cursor-not-allowed disabled:opacity-50 sm:h-11 sm:w-11 sm:rounded-xl"
                  title="Export WebM"
                >
                  <Download className="h-4 w-4" />
                </button>

                <div className="ml-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 sm:gap-2 sm:rounded-xl sm:py-1.5">
                  <Volume2 className="h-3.5 w-3.5 text-cyan-200" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={volume}
                    onChange={(event) => handleVolumeChange(Number(event.target.value))}
                    className="h-1.5 w-16 accent-cyan-400 sm:w-20"
                    title="Volume"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/35 p-2 sm:rounded-2xl sm:p-3">
                <div className="mb-1.5 flex items-center justify-between text-[0.58rem] uppercase tracking-[0.12rem] text-slate-400 sm:mb-2 sm:text-[0.65rem] sm:tracking-[0.2rem]">
                  <span>Timeline</span>
                  <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.01}
                  value={currentTime}
                  onChange={(event) => handleSeek(Number(event.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400"
                  disabled={!audioUrl}
                />
              </div>

              <div className="visualizer-status rounded-xl border border-white/10 bg-gradient-to-r from-cyan-500/10 via-indigo-500/10 to-violet-500/10 p-2 text-[0.65rem] text-slate-200 sm:rounded-2xl sm:p-3 sm:text-xs">
                {!audioUrl ? "Upload a track to start the cinematic analysis." : "Scene is live. Use the controls to fine tune the mood."}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
