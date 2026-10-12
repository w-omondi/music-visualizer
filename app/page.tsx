'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Download,
    AudioLines,
    Expand,
    FileAudio2,
    CircleAlert,
    LoaderCircle,
    Minimize2,
    Music4,
    Pause,
    Play,
    Upload,
    Volume2,
} from 'lucide-react';

import { VisualizerScene, type VisualizerSceneName } from '@/components/VisualizerScene';
import { AudioAnalyzer, type VisualizerSettings } from '@/lib/audioAnalyzer';

const DEFAULT_TRACKS = [
    { name: 'Lifted', src: '/tracks/lifted.mp3' },
    { name: 'Zep', src: '/tracks/zep.mp3' },
] as const;

export default function Home() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [analyzer] = useState(() => new AudioAnalyzer());
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const audioUrlRef = useRef<string | null>(null);
    const analyzerMountCountRef = useRef(0);
    const exportRef = useRef<{
        recorder: MediaRecorder;
        stream: MediaStream;
        timeout: ReturnType<typeof setTimeout> | null;
    } | null>(null);
    const [settings, setSettings] = useState<VisualizerSettings>({ sensitivity: 2 });
    const [audioUrl, setAudioUrl] = useState<string | null>(DEFAULT_TRACKS[0].src);
    const [trackName, setTrackName] = useState<string | null>(DEFAULT_TRACKS[0].name);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoadingTrack, setIsLoadingTrack] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [selectedScene, setSelectedScene] = useState<VisualizerSceneName>('event-horizon');

    const formatTime = (value: number) => {
        if (!Number.isFinite(value) || value < 0) {
            return '0:00';
        }

        const minutes = Math.floor(value / 60);
        const seconds = Math.floor(value % 60)
            .toString()
            .padStart(2, '0');
        return `${minutes}:${seconds}`;
    };

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) {
            return;
        }

        const onPlay = () => setIsPlaying(true);
        const onPause = () => setIsPlaying(false);
        const onTimeUpdate = () => setCurrentTime(audio.currentTime);
        const onLoadedMetadata = () => {
            setDuration(audio.duration || 0);
            setIsLoadingTrack(false);
        };
        const onCanPlay = () => setIsLoadingTrack(false);
        const onAudioError = () => {
            setIsLoadingTrack(false);
            setStatusMessage('This audio file could not be loaded. Choose another file.');
        };
        const onEnded = () => setIsPlaying(false);

        audio.addEventListener('play', onPlay);
        audio.addEventListener('pause', onPause);
        audio.addEventListener('timeupdate', onTimeUpdate);
        audio.addEventListener('loadedmetadata', onLoadedMetadata);
        audio.addEventListener('canplay', onCanPlay);
        audio.addEventListener('error', onAudioError);
        audio.addEventListener('ended', onEnded);

        if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            setDuration(audio.duration || 0);
            setIsLoadingTrack(false);
        }

        return () => {
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('timeupdate', onTimeUpdate);
            audio.removeEventListener('loadedmetadata', onLoadedMetadata);
            audio.removeEventListener('canplay', onCanPlay);
            audio.removeEventListener('error', onAudioError);
            audio.removeEventListener('ended', onEnded);
        };
    }, [analyzer]);

    useEffect(() => {
        analyzerMountCountRef.current += 1;
        return () => {
            analyzerMountCountRef.current -= 1;
            queueMicrotask(() => {
                if (analyzerMountCountRef.current === 0) {
                    analyzer.dispose();
                }
            });
        };
    }, [analyzer]);

    useEffect(
        () => () => {
            const url = audioUrlRef.current;
            if (url) {
                URL.revokeObjectURL(url);
                audioUrlRef.current = null;
            }

            const activeExport = exportRef.current;
            if (activeExport) {
                if (activeExport.timeout) {
                    clearTimeout(activeExport.timeout);
                }
                activeExport.recorder.onstop = null;
                if (activeExport.recorder.state !== 'inactive') {
                    activeExport.recorder.stop();
                }
                activeExport.stream.getTracks().forEach((track) => track.stop());
                exportRef.current = null;
            }
        },
        [],
    );

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    useEffect(() => {
        const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    const audioLabel = useMemo(() => {
        if (!audioUrl) {
            return 'No track loaded';
        }

        return trackName ?? 'Loaded audio';
    }, [audioUrl, trackName]);

    const togglePlayback = async () => {
        const audio = audioRef.current;
        if (!audio || !audioUrl) {
            fileInputRef.current?.click();
            return;
        }

        if (audio.paused) {
            await startPlayback(audio);
        } else {
            audio.pause();
        }
    };

    const startPlayback = async (audio: HTMLAudioElement) => {
        let analysisReady = false;
        try {
            analysisReady = await analyzer.attach(audio);
            if (!analysisReady) {
                setStatusMessage(
                    'Audio analysis is unavailable in this browser; playback can still continue.',
                );
            }
        } catch (error) {
            console.error('Audio analysis setup failed', error);
            setStatusMessage('Audio analysis could not start; attempting audio playback.');
        }

        try {
            await audio.play();
            if (analysisReady) {
                setStatusMessage(null);
            }
        } catch (error) {
            console.error('Audio playback failed', error);
            setStatusMessage('Playback was blocked or failed. Try pressing play again.');
        }
    };

    const selectDefaultTrack = (track: (typeof DEFAULT_TRACKS)[number]) => {
        const audio = audioRef.current;
        if (!audio) {
            return;
        }

        if (audioUrl === track.src) {
            if (audio.paused) {
                void startPlayback(audio);
            }
            return;
        }

        const previousUrl = audioUrlRef.current;
        if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
            audioUrlRef.current = null;
        }

        setStatusMessage(null);
        setAudioUrl(track.src);
        setTrackName(track.name);
        setIsLoadingTrack(true);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);
        audio.src = track.src;
        audio.load();
        void startPlayback(audio);
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            return;
        }

        const isSupported =
            ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'].includes(
                file.type,
            ) || /\.(mp3|wav|ogg|m4a)$/i.test(file.name);

        if (!isSupported) {
            setStatusMessage('Please choose an MP3, WAV, OGG, or M4A audio file.');
            return;
        }

        const nextUrl = URL.createObjectURL(file);
        const previousUrl = audioUrlRef.current;
        audioUrlRef.current = nextUrl;
        if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
        }
        setStatusMessage(null);
        setAudioUrl(nextUrl);
        setTrackName(file.name);
        setIsLoadingTrack(true);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);

        const audio = audioRef.current;
        if (audio) {
            audio.src = nextUrl;
            audio.load();
            void startPlayback(audio);
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

    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            return;
        }

        await document.exitFullscreen();
    };

    const exportVideo = async () => {
        if (
            !canvasElement ||
            typeof canvasElement.captureStream !== 'function' ||
            typeof MediaRecorder === 'undefined'
        ) {
            setStatusMessage('Video export is not supported by this browser.');
            return;
        }

        setIsExporting(true);

        try {
            const stream = canvasElement.captureStream(30);
            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9'
                : MediaRecorder.isTypeSupported('video/webm')
                  ? 'video/webm'
                  : undefined;
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            const chunks: BlobPart[] = [];
            const activeExport = {
                recorder,
                stream,
                timeout: null as ReturnType<typeof setTimeout> | null,
            };
            exportRef.current = activeExport;

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: mimeType ?? recorder.mimeType });
                if (blob.size > 0) {
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = 'visualizer-export.webm';
                    anchor.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                } else {
                    setStatusMessage('The video export did not contain any recorded frames.');
                }
                stream.getTracks().forEach((track) => track.stop());
                if (exportRef.current === activeExport) {
                    exportRef.current = null;
                }
                setIsExporting(false);
            };

            recorder.start();
            activeExport.timeout = setTimeout(() => {
                if (recorder.state !== 'inactive') {
                    recorder.stop();
                }
            }, 6000);
        } catch (error) {
            console.error('Export failed', error);
            setStatusMessage('Video export failed. Try again in a supported browser.');
            exportRef.current?.stream.getTracks().forEach((track) => track.stop());
            exportRef.current = null;
            setIsExporting(false);
        }
    };

    return (
        <main className="relative min-h-dvh bg-background text-foreground md:h-dvh md:min-h-0 md:overflow-hidden">
            <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/x-m4a"
                className="hidden"
                onChange={handleFileChange}
            />

            <audio ref={audioRef} src={audioUrl ?? undefined} preload="auto" />

            <div className="relative z-10 flex min-h-dvh flex-col md:h-full md:min-h-0">
                <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-3 lg:px-8">
                    <div className="flex items-center gap-3">

                            <h1 className="text-base font-semibold text-foreground sm:text-lg">
                                Luma Pulse
                            </h1>

                    </div>

                    <div className="flex max-w-[55%] items-center gap-2 border-l border-border-subtle pl-3 text-xs text-text-muted sm:max-w-full sm:text-sm">
                        {audioUrl ? (
                            <FileAudio2
                                className="h-4 w-4 shrink-0 text-text-muted"
                                aria-hidden="true"
                            />
                        ) : (
                            <Music4
                                className="h-4 w-4 shrink-0 text-text-muted"
                                aria-hidden="true"
                            />
                        )}
                        <span className="truncate" title={audioLabel}>
                            {audioLabel}
                        </span>
                    </div>
                </header>

                <div className="app-content-grid relative grid flex-1 grid-cols-1 grid-rows-[minmax(16rem,43svh)_auto] content-start gap-2 overflow-visible px-2 pb-3 pt-1 sm:grid-rows-[clamp(9rem,28svh,18rem)_minmax(0,1fr)] sm:gap-3 sm:px-5 sm:pb-5 md:min-h-0 md:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] md:grid-rows-1 md:items-stretch md:overflow-hidden lg:gap-4 lg:px-8 lg:pb-6">
                    <div className="relative min-h-0 overflow-hidden rounded-xl border border-border-subtle bg-canvas sm:rounded-3xl">
                        <VisualizerScene
                            analyzer={analyzer}
                            settings={settings}
                            isPlaying={isPlaying}
                            selectedScene={selectedScene}
                            onCanvasReady={setCanvasElement}
                            onCanvasError={setStatusMessage}
                        />
                    </div>

                    <aside className="visualizer-panel relative z-10 flex w-full min-w-0 flex-col gap-3 overflow-visible rounded-xl border border-border-subtle bg-panel p-3 sm:rounded-3xl sm:p-4 md:min-h-0 md:gap-2.5 md:overflow-y-auto lg:p-4">
                        <div className="visualizer-panel-top relative shrink-0 space-y-2 sm:space-y-3">
                            <div className="flex items-start justify-between">
                                <div className="space-y-1">
                                    <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                                        Fine-tune your scene
                                    </h2>
                                </div>
                                <button
                                    type="button"
                                    className="rounded-lg border border-border-subtle bg-raised p-1.5 text-highlight-neutral transition hover:border-accent-cyan/50 hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:p-2"
                                    onClick={toggleFullscreen}
                                    title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                                    aria-label={
                                        isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'
                                    }
                                >
                                    {isFullscreen ? (
                                        <Minimize2 className="h-3.5 w-3.5" />
                                    ) : (
                                        <Expand className="h-3.5 w-3.5" />
                                    )}
                                </button>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <span className="shrink-0 text-xs font-medium text-highlight-neutral">
                                    Scene
                                </span>
                                <div
                                    className="flex min-w-0 gap-1 rounded-lg border border-border-subtle bg-background p-1"
                                    role="group"
                                    aria-label="Visualizer scene"
                                >
                                    {(
                                        [
                                            ['event-horizon', 'Event Horizon'],
                                            ['liquid-dimension', 'Liquid Dimension'],
                                        ] as const
                                    ).map(([scene, label]) => (
                                        <button
                                            key={scene}
                                            type="button"
                                            aria-pressed={selectedScene === scene}
                                            onClick={() => setSelectedScene(scene)}
                                            className={`min-w-0 truncate rounded-md px-2 py-1.5 text-[0.62rem] font-medium transition sm:text-xs ${
                                                selectedScene === scene
                                                    ? 'bg-raised text-accent-cyan'
                                                    : 'text-text-muted hover:bg-raised hover:text-foreground'
                                            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <label className="block rounded-lg border border-border-subtle bg-background p-2.5 sm:p-3">
                                <div className="mb-2 flex items-center justify-between">
                                    <div>
                                        <span className="text-xs font-medium text-highlight-neutral sm:text-sm">
                                            Sensitivity
                                        </span>
                                    </div>
                                    <span className="rounded-md border border-border-subtle bg-raised px-2 py-0.5 font-mono text-xs tabular-nums text-accent-cyan">
                                        {settings.sensitivity.toFixed(1)}×
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={3}
                                    step={0.1}
                                    value={settings.sensitivity}
                                    aria-label="Visualizer sensitivity"
                                    aria-valuetext={`${settings.sensitivity.toFixed(1)} times sensitivity`}
                                    onChange={(event) =>
                                        setSettings({ sensitivity: Number(event.target.value) })
                                    }
                                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-raised accent-cyan-300 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                                />
                                <div className="mt-1.5 flex justify-between text-[0.55rem] uppercase tracking-[0.08rem] text-text-muted sm:text-[0.6rem]">
                                    <span>Subtle</span>
                                    <span>Balanced</span>
                                    <span>Dynamic</span>
                                </div>
                            </label>

                            <div className="space-y-1.5">
                                <p className="px-1 text-[0.68rem] font-medium text-highlight-neutral">
                                    Sample tracks
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    {DEFAULT_TRACKS.map((track) => (
                                        <button
                                            key={track.src}
                                            type="button"
                                            aria-pressed={audioUrl === track.src}
                                            onClick={() => selectDefaultTrack(track)}
                                            className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan ${
                                                audioUrl === track.src
                                                    ? 'border-accent-cyan/50 bg-raised text-accent-cyan'
                                                    : 'border-border-subtle bg-background text-highlight-neutral hover:bg-raised'
                                            }`}
                                        >
                                            <FileAudio2
                                                className="h-4 w-4 shrink-0"
                                                aria-hidden="true"
                                            />
                                            <span className="truncate">{track.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {(statusMessage || isLoadingTrack || isPlaying || audioUrl) && (
                                <div
                                    className="flex min-h-9 items-center gap-2 rounded-lg border border-border-subtle bg-background px-2.5 py-2"
                                    aria-live="polite"
                                >
                                    {statusMessage ? (
                                        <CircleAlert
                                            className="h-4 w-4 shrink-0 text-amber-300"
                                            aria-hidden="true"
                                        />
                                    ) : isLoadingTrack ? (
                                        <LoaderCircle
                                            className="h-4 w-4 shrink-0 animate-spin text-text-muted"
                                            aria-hidden="true"
                                        />
                                    ) : isPlaying ? (
                                        <AudioLines
                                            className="h-4 w-4 shrink-0 text-accent-cyan"
                                            aria-hidden="true"
                                        />
                                    ) : audioUrl ? (
                                        <FileAudio2
                                            className="h-4 w-4 shrink-0 text-text-muted"
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                    <p
                                        className={`min-w-0 text-[0.68rem] sm:text-xs ${statusMessage ? 'text-amber-100' : 'text-text-muted'}`}
                                    >
                                        {statusMessage ??
                                            (isLoadingTrack
                                                ? 'Loading audio file…'
                                                : isPlaying
                                                  ? 'Playing · scene responding'
                                                  : 'Paused · ready to play')}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="visualizer-panel-bottom mt-0 shrink-0 space-y-2 md:mt-auto">
                            <div className="flex items-center gap-1.5 rounded-xl border border-border-subtle bg-raised p-1.5 sm:gap-2 sm:p-2">
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-panel text-accent-cyan transition hover:border-accent-cyan/50 hover:bg-accent-cyan/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:h-10 sm:w-10 sm:rounded-xl"
                                    title="Upload audio"
                                    aria-label="Upload audio"
                                >
                                    <Upload className="h-4 w-4" />
                                </button>

                                <button
                                    type="button"
                                    onClick={togglePlayback}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-panel text-highlight-neutral transition hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:h-10 sm:w-10 sm:rounded-xl"
                                    title={isPlaying ? 'Pause' : 'Play'}
                                    aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
                                >
                                    {isPlaying ? (
                                        <Pause className="h-4 w-4" />
                                    ) : (
                                        <Play className="h-4 w-4" />
                                    )}
                                </button>

                                <button
                                    type="button"
                                    onClick={exportVideo}
                                    disabled={!canvasElement || isExporting}
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-panel text-accent-violet transition hover:bg-accent-violet/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:w-10 sm:rounded-xl"
                                    title={isExporting ? 'Recording export' : 'Export WebM'}
                                    aria-label={isExporting ? 'Recording export' : 'Export WebM'}
                                >
                                    {isExporting ? (
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Download className="h-4 w-4" />
                                    )}
                                </button>

                                <div className="ml-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-panel px-2 py-1 text-xs text-highlight-neutral sm:gap-2 sm:rounded-xl sm:py-1.5">
                                    <Volume2 className="h-3.5 w-3.5 text-accent-cyan" />
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={volume}
                                        onChange={(event) =>
                                            handleVolumeChange(Number(event.target.value))
                                        }
                                        className="h-1.5 w-16 accent-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:w-20"
                                        title="Volume"
                                        aria-label="Volume"
                                    />
                                </div>
                            </div>

                            <div className="rounded-lg border border-border-subtle bg-panel p-2">
                                <div className="mb-1 flex items-center justify-between text-[0.58rem] uppercase tracking-[0.1rem] text-text-muted sm:text-[0.62rem]">
                                    <span>Timeline</span>
                                    <span>
                                        {formatTime(currentTime)} / {formatTime(duration)}
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={duration || 0}
                                    step={0.01}
                                    value={currentTime}
                                    onChange={(event) => handleSeek(Number(event.target.value))}
                                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-raised accent-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                                    aria-label="Seek audio"
                                    disabled={!audioUrl}
                                />
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
