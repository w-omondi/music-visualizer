export interface VisualResponseProfile {
    readonly subBassCore: number;
    readonly bassFolds: number;
    readonly lowMidWaves: number;
    readonly midPatterns: number;
    readonly upperMidTendrils: number;
    readonly presenceFlash: number;
    readonly brillianceParticles: number;
    readonly rmsEnergy: number;
    readonly onsetImpact: number;
}

export const LIQUID_DIMENSION_PROFILE: VisualResponseProfile = {
    subBassCore: 0.3,
    bassFolds: 0.24,
    lowMidWaves: 0.16,
    midPatterns: 0.12,
    upperMidTendrils: 0.18,
    presenceFlash: 0.5,
    brillianceParticles: 0.75,
    rmsEnergy: 0.08,
    onsetImpact: 0.18,
};

export const EVENT_HORIZON_PROFILE: VisualResponseProfile = {
    subBassCore: 0.44,
    bassFolds: 0.48,
    lowMidWaves: 0.34,
    midPatterns: 0.3,
    upperMidTendrils: 0.62,
    presenceFlash: 0.72,
    brillianceParticles: 0.82,
    rmsEnergy: 0.18,
    onsetImpact: 0.62,
};
