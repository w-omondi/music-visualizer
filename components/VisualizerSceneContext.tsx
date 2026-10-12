'use client';

import { createContext, useContext } from 'react';

import type { AudioAnalyzer, VisualizerSettings } from '@/lib/audioAnalyzer';

export type VisualizerSceneContextValue = {
    analyzer: AudioAnalyzer | null;
    settings: VisualizerSettings;
    isPlaying: boolean;
    reducedMotion: boolean;
    barsRef: { current: Array<HTMLDivElement | null> };
};

const VisualizerSceneContext = createContext<VisualizerSceneContextValue | null>(null);

export const VisualizerSceneProvider = VisualizerSceneContext.Provider;

export function useVisualizerSceneContext() {
    const context = useContext(VisualizerSceneContext);
    if (!context) {
        throw new Error('Scene components must be rendered inside VisualizerSceneProvider.');
    }
    return context;
}
