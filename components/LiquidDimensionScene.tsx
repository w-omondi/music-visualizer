'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { AUDIO_FREQUENCY_BANDS, type AudioFeatures } from '@/lib/audioAnalyzer';
import { useVisualizerSceneContext } from '@/components/VisualizerSceneContext';
import { LIQUID_DIMENSION_PROFILE, type VisualResponseProfile } from '@/lib/visualResponseProfiles';

const VERTEX_SHADER = `
uniform float uTime;
uniform float uSensitivity;
uniform float uSubBass;
uniform float uBass;
uniform float uLowMids;
uniform float uMids;
uniform float uUpperMids;
uniform float uPresence;
uniform float uBrilliance;
uniform float uEnergy;
uniform float uOnset;
uniform float uReducedMotion;
varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vEdgeActivity;
varying float vImpact;

void main() {
    vec3 p = position;
    float slowWave = sin(p.x * 3.1 + p.z * 1.8 + uTime * 0.38)
        * cos(p.y * 2.7 - uTime * 0.28);
    float rollingFold = sin(p.y * 5.4 + p.x * 2.2 + uTime * 0.22);
    float detailWave = sin(p.z * 13.0 + p.y * 7.0 - uTime * 0.5);
    float asymmetry = sin(p.x * 4.2 + p.y * 1.7) * cos(p.z * 3.6 - p.y);

    float displacement = slowWave * (0.035 + uEnergy * 0.025)
        + asymmetry * uLowMids * 0.16
        + rollingFold * uMids * 0.11
        + detailWave * uUpperMids * 0.035
        + asymmetry * uSubBass * 0.22
        + rollingFold * uBass * 0.19
        + uOnset * (0.12 + 0.08 * slowWave);
    displacement *= uSensitivity * (1.0 - uReducedMotion * 0.72);
    p += normal * displacement;

    vec4 worldPosition = modelMatrix * vec4(p, 1.0);
    vWorldPosition = worldPosition.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vEdgeActivity = clamp(
        0.45 + 0.55 * sin(p.x * 7.0 + p.y * 5.0 + uTime * 0.7),
        0.0,
        1.0
    );
    vImpact = uOnset;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const FRAGMENT_SHADER = `
uniform float uTime;
uniform float uBrilliance;
uniform float uPresence;
uniform float uMids;
uniform float uOnset;
varying vec3 vWorldPosition;
varying vec3 vNormal;
varying float vEdgeActivity;
varying float vImpact;

void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.4);
    float flow = 0.5 + 0.5 * sin(
        vWorldPosition.y * 2.1 + vWorldPosition.x * 1.7 + uTime * 0.18
    );
    vec3 silver = vec3(0.66, 0.78, 0.88);
    vec3 cyan = vec3(0.08, 0.72, 0.88);
    vec3 blue = vec3(0.11, 0.32, 0.72);
    vec3 violet = vec3(0.43, 0.25, 0.78);
    vec3 base = mix(silver, cyan, smoothstep(0.2, 0.9, flow));
    base = mix(base, blue, smoothstep(0.45, 0.95, flow) * 0.55);
    base = mix(base, violet, smoothstep(0.68, 1.0, flow) * 0.4);

    float directionalLight = max(dot(normal, normalize(vec3(-0.4, 0.8, 0.9))), 0.0);
    float specular = pow(max(dot(reflect(-normalize(vec3(-0.4, 0.8, 0.9)), normal), viewDirection), 0.0), 28.0);
    float glint = vEdgeActivity * (0.24 + 0.76 * step(0.58, flow));
    vec3 color = base * (0.3 + directionalLight * 0.7);
    color += vec3(0.38, 0.82, 0.96) * (fresnel * 0.72 + glint * uPresence * 0.85);
    color += vec3(0.84, 0.94, 1.0) * specular * (0.22 + uBrilliance * 0.5);
    color += vec3(0.48, 0.68, 1.0) * uMids * 0.14;
    color += vec3(0.58, 0.34, 0.98) * vImpact * 0.42;
    color *= 0.82 + uOnset * 0.35;
    gl_FragColor = vec4(color, 0.98);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const RIBBON_VERTEX_SHADER = `
uniform float uTime;
uniform float uMotion;
uniform float uBand;
uniform float uSensitivity;
uniform float uOnset;
varying float vMotion;
varying vec3 vNormal;

void main() {
    vec3 p = position;
    float phase = uv.x * 16.0 - uTime * (0.2 + uBand * 0.55);
    float wave = sin(phase) * cos(uv.x * 7.0 + uTime * 0.13);
    float ripple = sin(uv.x * 32.0 - uTime * 0.8) * uMotion * 0.012;
    float displacement = wave * (0.035 + uMotion * 0.11)
        + ripple + uOnset * 0.045;
    p += normal * displacement * uSensitivity;
    vMotion = uMotion;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const RIBBON_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uMotion;
uniform float uPresence;
uniform float uBrilliance;
uniform float uPhase;
varying float vMotion;
varying vec3 vNormal;

void main() {
    float sheen = 0.5 + 0.5 * sin(uTime * 0.25 + uPhase + vMotion * 3.0);
    float edge = pow(1.0 - abs(normalize(vNormal).z), 2.0);
    vec3 steel = vec3(0.48, 0.64, 0.78);
    vec3 tint = mix(vec3(0.12, 0.72, 0.86), vec3(0.45, 0.31, 0.84), sheen);
    vec3 color = mix(steel, tint, 0.25 + vMotion * 0.48);
    color += vec3(0.52, 0.84, 0.98) * edge * (0.18 + uPresence * 0.45);
    color += vec3(0.76, 0.88, 1.0) * uBrilliance * 0.12;
    gl_FragColor = vec4(color, 0.48 + vMotion * 0.35);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const PARTICLE_VERTEX_SHADER = `
uniform float uTime;
uniform float uBrilliance;
uniform float uOnset;
uniform float uEnergy;
uniform float uReducedMotion;
varying float vAlpha;

void main() {
    vec3 p = position;
    float seed = dot(position, vec3(12.9898, 78.233, 37.719));
    float drift = sin(seed + uTime * 0.12) * (0.008 + uEnergy * 0.02);
    p += normalize(position) * drift * (1.0 - uReducedMotion * 0.8);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(
        (1.0 + uBrilliance * 2.0 + uOnset * 1.5) * (170.0 / -viewPosition.z),
        1.0,
        5.0
    );
    vAlpha = 0.18 + uBrilliance * 0.58 + uOnset * 0.24;
}
`;

const PARTICLE_FRAGMENT_SHADER = `
varying float vAlpha;

void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float distanceFromCenter = length(centered);
    float alpha = smoothstep(0.5, 0.05, distanceFromCenter) * vAlpha;
    if (alpha < 0.015) discard;
    gl_FragColor = vec4(vec3(0.68, 0.88, 1.0), alpha);
}
`;

type ShaderUniforms = Record<string, THREE.IUniform<number>>;

function createCentralUniforms(): ShaderUniforms {
    return {
        uTime: { value: 0 },
        uSensitivity: { value: 1 },
        uSubBass: { value: 0 },
        uBass: { value: 0 },
        uLowMids: { value: 0 },
        uMids: { value: 0 },
        uUpperMids: { value: 0 },
        uPresence: { value: 0 },
        uBrilliance: { value: 0 },
        uEnergy: { value: 0 },
        uOnset: { value: 0 },
        uReducedMotion: { value: 0 },
    };
}

type RibbonDefinition = {
    curve: THREE.CatmullRomCurve3;
    bandKey: (typeof AUDIO_FREQUENCY_BANDS)[number]['key'];
    phase: number;
    radius: number;
};

function createParticlePositions(count: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        const seed = i + 1;
        const u = ((seed * 0.61803398875) % 1) * 2 - 1;
        const angle = seed * 2.39996322973;
        const radius = 2.4 + ((seed * 0.754877666) % 1) * 2.2;
        const ring = Math.sqrt(1 - u * u);
        positions[i * 3] = Math.cos(angle) * ring * radius;
        positions[i * 3 + 1] = u * radius;
        positions[i * 3 + 2] = Math.sin(angle) * ring * radius;
    }
    return positions;
}

function setFeatureUniform(uniforms: ShaderUniforms, key: string, value: number) {
    uniforms[key].value = value;
}

export function LiquidDimensionScene({
    profile = LIQUID_DIMENSION_PROFILE,
}: {
    profile?: VisualResponseProfile;
} = {}) {
    const { analyzer, settings, isPlaying, reducedMotion, barsRef } = useVisualizerSceneContext();
    const timeRef = useRef(0);
    const spectrumLevelsRef = useRef(new Float32Array(32));
    const centralUniforms = useMemo(() => createCentralUniforms(), []);
    const ribbonUniforms = useMemo(
        () =>
            [0, 1, 2].map((): ShaderUniforms => ({
                uTime: { value: 0 },
                uMotion: { value: 0 },
                uBand: { value: 0 },
                uSensitivity: { value: 1 },
                uOnset: { value: 0 },
                uPresence: { value: 0 },
                uBrilliance: { value: 0 },
                uPhase: { value: 0 },
            })),
        [],
    );
    const particleUniforms = useMemo<ShaderUniforms>(
        () => ({
            uTime: { value: 0 },
            uBrilliance: { value: 0 },
            uOnset: { value: 0 },
            uEnergy: { value: 0 },
            uReducedMotion: { value: 0 },
        }),
        [],
    );
    const particlePositions = useMemo(
        () => createParticlePositions(reducedMotion ? 280 : 720),
        [reducedMotion],
    );
    const centralMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const ribbonMaterialRefs = useRef<Array<THREE.ShaderMaterial | null>>([]);
    const particleMaterialRef = useRef<THREE.ShaderMaterial>(null);

    const ribbons = useMemo<RibbonDefinition[]>(
        () => [
            {
                curve: new THREE.CatmullRomCurve3([
                    new THREE.Vector3(-0.7, -1.5, 0.12),
                    new THREE.Vector3(-1.45, -0.55, 0.3),
                    new THREE.Vector3(-0.82, 0.22, -0.1),
                    new THREE.Vector3(0.04, 0.8, 0.25),
                    new THREE.Vector3(0.55, 1.52, 0.12),
                ]),
                bandKey: 'bass',
                phase: 0.2,
                radius: 0.075,
            },
            {
                curve: new THREE.CatmullRomCurve3([
                    new THREE.Vector3(0.82, -1.42, -0.2),
                    new THREE.Vector3(1.38, -0.58, 0.06),
                    new THREE.Vector3(0.78, 0.1, 0.32),
                    new THREE.Vector3(-0.05, 0.66, -0.12),
                    new THREE.Vector3(-0.5, 1.4, -0.25),
                ]),
                bandKey: 'upperMids',
                phase: 2.1,
                radius: 0.045,
            },
            {
                curve: new THREE.CatmullRomCurve3([
                    new THREE.Vector3(-1.4, 0.5, -0.52),
                    new THREE.Vector3(-0.65, 1.12, -0.24),
                    new THREE.Vector3(0.12, 1.48, -0.05),
                    new THREE.Vector3(0.94, 1.2, -0.32),
                    new THREE.Vector3(1.46, 0.55, -0.5),
                ]),
                bandKey: 'lowMids',
                phase: 4.1,
                radius: 0.055,
            },
        ],
        [],
    );

    useFrame((_, delta) => {
        const features = analyzer?.update(delta, isPlaying) ?? EMPTY_FEATURES;
        const time = (timeRef.current += delta);
        const motionScale = reducedMotion ? 0.28 : 1;
        const sensitivity = THREE.MathUtils.clamp(settings.sensitivity / 2, 0, 1.5);
        const event = THREE.MathUtils.clamp(features.onset * sensitivity, 0, 1);

        const uniforms = centralMaterialRef.current?.uniforms;
        if (uniforms) {
            setFeatureUniform(uniforms, 'uTime', time * motionScale);
            setFeatureUniform(uniforms, 'uSensitivity', sensitivity);
            setFeatureUniform(uniforms, 'uSubBass', features.subBass * profile.subBassCore);
            setFeatureUniform(uniforms, 'uBass', features.bass * profile.bassFolds);
            setFeatureUniform(uniforms, 'uLowMids', features.lowMids * profile.lowMidWaves);
            setFeatureUniform(uniforms, 'uMids', features.mids * profile.midPatterns);
            setFeatureUniform(
                uniforms,
                'uUpperMids',
                features.upperMids * profile.upperMidTendrils,
            );
            setFeatureUniform(
                uniforms,
                'uPresence',
                features.presence * profile.presenceFlash * sensitivity,
            );
            setFeatureUniform(
                uniforms,
                'uBrilliance',
                features.brilliance * profile.brillianceParticles * sensitivity,
            );
            setFeatureUniform(
                uniforms,
                'uEnergy',
                features.energy * profile.rmsEnergy * sensitivity,
            );
            setFeatureUniform(uniforms, 'uOnset', event * profile.onsetImpact);
            setFeatureUniform(uniforms, 'uReducedMotion', reducedMotion ? 1 : 0);
        }

        for (let i = 0; i < ribbons.length; i += 1) {
            const material = ribbonMaterialRefs.current[i];
            if (!material) {
                continue;
            }
            const values = material.uniforms;
            setFeatureUniform(values, 'uTime', time * motionScale);
            setFeatureUniform(values, 'uMotion', features[ribbons[i].bandKey]);
            setFeatureUniform(values, 'uBand', i / ribbons.length);
            setFeatureUniform(values, 'uSensitivity', sensitivity);
            setFeatureUniform(values, 'uOnset', event);
            setFeatureUniform(
                values,
                'uPresence',
                features.presence * profile.presenceFlash * sensitivity,
            );
            setFeatureUniform(
                values,
                'uBrilliance',
                features.brilliance * profile.brillianceParticles * sensitivity,
            );
            setFeatureUniform(values, 'uPhase', ribbons[i].phase);
        }

        const particleValues = particleMaterialRef.current?.uniforms;
        if (particleValues) {
            setFeatureUniform(particleValues, 'uTime', time * motionScale);
            setFeatureUniform(
                particleValues,
                'uBrilliance',
                features.brilliance * profile.brillianceParticles * sensitivity,
            );
            setFeatureUniform(particleValues, 'uOnset', event);
            setFeatureUniform(particleValues, 'uEnergy', features.energy);
            setFeatureUniform(particleValues, 'uReducedMotion', reducedMotion ? 1 : 0);
        }

        const binWidth = features.sampleRate / (features.frequency.length * 2);
        for (let barIndex = 0; barIndex < barsRef.current.length; barIndex += 1) {
            const bar = barsRef.current[barIndex];
            if (!bar) {
                continue;
            }

            const rangeStart = Math.pow(barIndex / barsRef.current.length, 2);
            const rangeEnd = Math.pow((barIndex + 1) / barsRef.current.length, 2);
            const minHz = 20 * Math.pow(16000 / 20, rangeStart);
            const maxHz = 20 * Math.pow(16000 / 20, rangeEnd);
            const minBin = Math.max(1, Math.floor(minHz / binWidth));
            const maxBin = Math.min(
                features.frequency.length,
                Math.max(minBin + 1, Math.ceil(maxHz / binWidth)),
            );
            let magnitude = 0;
            for (let bin = minBin; bin < maxBin; bin += 1) {
                magnitude += features.frequency[bin] / 255;
            }
            const average = magnitude / Math.max(1, maxBin - minBin);
            const level = Math.max(
                0.018,
                Math.min(1, Math.pow(average, 0.55) * sensitivity * 1.45),
            );
            if (Math.abs(level - spectrumLevelsRef.current[barIndex]) > 0.006) {
                spectrumLevelsRef.current[barIndex] = level;
                bar.style.transform = `scaleY(${level})`;
            }
        }
    });

    return (
        <>
            <color attach="background" args={['#030611']} />
            <fog attach="fog" args={['#030611', 10, 27]} />
            <ambientLight intensity={0.48} color="#c9dcff" />
            <directionalLight position={[-4, 5, 6]} intensity={2.2} color="#d9efff" />
            <pointLight position={[-4, -1, 3]} intensity={1.8} color="#28cce7" />
            <pointLight position={[4, 2, -2]} intensity={1.5} color="#8870f3" />

            <mesh rotation={[0.12, -0.22, 0.18]}>
                <sphereGeometry args={[1.5, 112, 80]} />
                <shaderMaterial
                    ref={centralMaterialRef}
                    uniforms={centralUniforms}
                    vertexShader={VERTEX_SHADER}
                    fragmentShader={FRAGMENT_SHADER}
                    transparent
                    side={THREE.DoubleSide}
                    depthWrite
                />
            </mesh>

            {ribbons.map((ribbon, index) => (
                <mesh
                    key={ribbon.bandKey}
                    rotation={[0, index * 0.7, index * 0.22]}
                    renderOrder={index + 1}
                >
                    <tubeGeometry args={[ribbon.curve, 112, ribbon.radius, 8, false]} />
                    <shaderMaterial
                        ref={(material) => {
                            ribbonMaterialRefs.current[index] = material;
                        }}
                        uniforms={ribbonUniforms[index]}
                        vertexShader={RIBBON_VERTEX_SHADER}
                        fragmentShader={RIBBON_FRAGMENT_SHADER}
                        transparent
                        depthWrite={false}
                        side={THREE.DoubleSide}
                    />
                </mesh>
            ))}

            <points frustumCulled={false}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
                </bufferGeometry>
                <shaderMaterial
                    ref={particleMaterialRef}
                    uniforms={particleUniforms}
                    vertexShader={PARTICLE_VERTEX_SHADER}
                    fragmentShader={PARTICLE_FRAGMENT_SHADER}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>
        </>
    );
}

const EMPTY_FEATURES: AudioFeatures = {
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
    frequency: new Uint8Array(4096),
};
