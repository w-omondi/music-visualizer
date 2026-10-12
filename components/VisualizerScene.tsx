'use client';

import { Canvas, type RootState } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';

import { EventHorizonScene } from '@/components/EventHorizonScene';
import { LiquidDimensionScene } from '@/components/LiquidDimensionScene';
import { VisualizerSceneProvider } from '@/components/VisualizerSceneContext';
import type { AudioAnalyzer, VisualizerSettings } from '@/lib/audioAnalyzer';

type VisualizerSceneProps = {
    analyzer: AudioAnalyzer | null;
    settings: VisualizerSettings;
    isPlaying: boolean;
    onCanvasReady?: (canvas: HTMLCanvasElement) => void;
    onCanvasError?: (message: string) => void;
};

function useReducedMotionPreference() {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updatePreference = () => setReducedMotion(preference.matches);
        updatePreference();
        preference.addEventListener('change', updatePreference);
        return () => preference.removeEventListener('change', updatePreference);
    }, []);

    return reducedMotion;
}

export function VisualizerScene({
    analyzer,
    settings,
    isPlaying,
    onCanvasReady,
    onCanvasError,
}: VisualizerSceneProps) {
    const barsRef = useRef<Array<HTMLDivElement | null>>([]);
    const cleanupCanvasRef = useRef<(() => void) | null>(null);
    const [shaderFailed, setShaderFailed] = useState(false);
    const [selectedScene, setSelectedScene] = useState<'event-horizon' | 'liquid-dimension'>(
        'event-horizon',
    );
    const reducedMotion = useReducedMotionPreference();

    const handleCanvasCreated = useCallback(
        ({ gl }: RootState) => {
            gl.setClearColor('#030611');
            gl.debug.onShaderError = (context, program, vertex, fragment) => {
                console.error('Visualizer shader compilation failed', {
                    program: context.getProgramInfoLog(program),
                    vertex: context.getShaderInfoLog(vertex),
                    fragment: context.getShaderInfoLog(fragment),
                });
                setShaderFailed(true);
                onCanvasError?.(
                    'A shader failed to compile; showing the lightweight scene fallback.',
                );
            };

            const canvas = gl.domElement;
            const handleContextLost = (event: Event) => {
                event.preventDefault();
                setShaderFailed(true);
                onCanvasError?.('WebGL became unavailable; audio playback remains available.');
            };
            canvas.addEventListener('webglcontextlost', handleContextLost);
            cleanupCanvasRef.current = () => {
                canvas.removeEventListener('webglcontextlost', handleContextLost);
            };
            onCanvasReady?.(canvas);
        },
        [onCanvasError, onCanvasReady],
    );

    useEffect(
        () => () => {
            cleanupCanvasRef.current?.();
            cleanupCanvasRef.current = null;
        },
        [],
    );

    return (
        <div className="relative h-full w-full">
            <Canvas
                camera={{ position: [0, 0, 7.8], fov: 42, near: 0.1, far: 80 }}
                dpr={reducedMotion ? 1 : [1, 1.5]}
                gl={{
                    antialias: !reducedMotion,
                    alpha: true,
                    powerPreference: 'high-performance',
                }}
                fallback={
                    <div
                        className="absolute inset-0 grid place-items-center bg-canvas px-6 text-center text-sm text-text-muted"
                        role="status"
                    >
                        3D rendering is unavailable. Audio playback and controls remain active.
                    </div>
                }
                onCreated={handleCanvasCreated}
            >
                <VisualizerSceneProvider
                    value={{
                        analyzer,
                        settings,
                        isPlaying,
                        reducedMotion,
                        barsRef,
                    }}
                >
                    {shaderFailed ? (
                        <>
                            <color attach="background" args={['#030611']} />
                            <mesh>
                                <icosahedronGeometry args={[1.25, 2]} />
                                <meshBasicMaterial
                                    color="#00c8d7"
                                    wireframe
                                    transparent
                                    opacity={0.65}
                                />
                            </mesh>
                        </>
                    ) : selectedScene === 'event-horizon' ? (
                        <EventHorizonScene />
                    ) : (
                        <LiquidDimensionScene />
                    )}
                </VisualizerSceneProvider>
            </Canvas>
            <div
                className="absolute right-3 top-3 z-10 flex gap-1 rounded-lg border border-border-subtle bg-panel p-1 sm:right-4 sm:top-4"
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
                        className={`rounded-md px-2 py-1.5 text-[0.58rem] font-medium transition sm:px-2.5 sm:text-[0.65rem] ${
                            selectedScene === scene
                                ? 'bg-raised text-accent-cyan'
                                : 'text-text-muted hover:bg-raised hover:text-foreground'
                        } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan`}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div
                className="pointer-events-none absolute bottom-3 left-3 z-10 w-44 max-w-[calc(100%-1.5rem)] rounded-lg border border-border-subtle bg-panel/95 px-2 py-1.5 sm:bottom-4 sm:left-4 sm:w-64 sm:px-3.5 sm:py-2.5"
                role="img"
                aria-label="Live audio frequency spectrum from 20 hertz to 16 kilohertz"
            >
                <div className="mb-1 flex items-center justify-between sm:mb-2">
                    <span className="text-[0.5rem] font-medium uppercase tracking-[0.14rem] text-text-muted sm:text-[0.55rem] sm:tracking-[0.18rem]">
                        Frequency spectrum
                    </span>
                    <span className="hidden text-[0.55rem] text-text-muted sm:inline">
                        20 Hz–16 kHz
                    </span>
                </div>
                <div className="flex h-6 items-end gap-0.75 sm:h-12" aria-hidden="true">
                    {Array.from({ length: 32 }, (_, index) => (
                        <div
                            key={index}
                            ref={(element) => {
                                barsRef.current[index] = element;
                            }}
                            className={`h-full min-w-0 flex-1 origin-bottom rounded-t-sm transition-transform duration-75 ${
                                index < 4
                                    ? 'bg-accent-violet'
                                    : index < 12
                                      ? 'bg-accent-cyan'
                                      : index < 23
                                        ? 'bg-accent-blue'
                                        : 'bg-highlight-neutral'
                            }`}
                            style={{ transform: 'scaleY(0.018)' }}
                        />
                    ))}
                </div>
                <div className="mt-1.5 hidden justify-between text-[0.5rem] text-text-muted sm:flex">
                    <span>20</span>
                    <span>250</span>
                    <span>1k</span>
                    <span>4k</span>
                    <span>16k Hz</span>
                </div>
            </div>
            {shaderFailed && (
                <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-border-subtle bg-panel px-2.5 py-1.5 text-[0.62rem] text-amber-200">
                    Lightweight 3D fallback
                </div>
            )}
        </div>
    );
}
