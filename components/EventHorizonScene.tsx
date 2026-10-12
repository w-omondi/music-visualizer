'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { type AudioFeatures } from '@/lib/audioAnalyzer';
import { useVisualizerSceneContext } from '@/components/VisualizerSceneContext';
import { EVENT_HORIZON_PROFILE, type VisualResponseProfile } from '@/lib/visualResponseProfiles';

const DISK_VERTEX_SHADER = `
uniform float uTime;
uniform float uBass;
uniform float uLowMids;
uniform float uOnset;
varying vec2 vLocal;
varying float vWave;

void main() {
  vec3 p = position;
  float radius = length(p.xy);
  float angle = atan(p.y, p.x);
  float spiral = sin(angle * 5.0 - uTime * 0.8 + radius * 3.5);
  float waves = sin(angle * 11.0 - uTime * 1.4 + radius * 5.0);
  float displacement = spiral * uBass * 0.12
    + waves * uLowMids * 0.055
    + uOnset * sin(radius * 13.0 - uTime * 2.5) * 0.045;
  float radialShift = sin(angle * 3.0 + uTime * 0.45) * uBass * 0.075;
  p.xy += normalize(p.xy + vec2(0.0001)) * radialShift;
  p.z += displacement;
  vLocal = p.xy;
  vWave = waves;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const DISK_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uBass;
uniform float uLowMids;
uniform float uPresence;
uniform float uOnset;
varying vec2 vLocal;
varying float vWave;

void main() {
  float radius = length(vLocal);
  float angle = atan(vLocal.y, vLocal.x);
  float innerMask = smoothstep(1.02, 1.22, radius);
  float outerMask = 1.0 - smoothstep(2.65, 3.0, radius);
  float spiralA = sin(angle * 9.0 - radius * 8.0 - uTime * 1.6);
  float spiralB = sin(angle * 17.0 + radius * 12.0 - uTime * 2.2);
  float turbulent = 0.5 + 0.24 * spiralA + 0.16 * spiralB + 0.1 * vWave;
  float lanes = smoothstep(-0.58, 0.68, turbulent);
  float heat = clamp(
    0.18 + lanes * 0.48 + uBass * 0.34 + uLowMids * 0.2
      + uOnset * (0.22 + 0.12 * sin(radius * 18.0 - uTime * 3.0)),
    0.0,
    1.0
  );
  vec3 deep = vec3(0.055, 0.025, 0.16);
  vec3 plasma = vec3(0.0, 0.55, 0.68);
  vec3 hot = vec3(0.89, 0.94, 1.0);
  vec3 color = mix(deep, plasma, heat);
  color = mix(color, hot, smoothstep(0.68, 0.98, heat) * 0.72);
  color += vec3(0.35, 0.4, 1.0) * max(vWave, 0.0) * 0.12;
  color += vec3(0.92, 0.55, 0.28) * uPresence * (0.08 + 0.12 * lanes);
  float alpha = innerMask * outerMask * (0.24 + lanes * 0.55 + uBass * 0.12);
  if (alpha < 0.012) discard;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LENSING_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uSubBass;
uniform float uOnset;
varying vec2 vUv;

float starField(vec2 point, float density) {
  vec2 cell = floor(point * density);
  vec2 local = fract(point * density) - 0.5;
  float seed = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  vec2 star = vec2(fract(seed * 17.13), fract(seed * 41.71)) - 0.5;
  float radius = mix(0.018, 0.052, fract(seed * 9.31));
  return (1.0 - smoothstep(0.0, radius, length(local - star))) * step(0.982, seed);
}

void main() {
  vec2 point = (vUv - 0.5) * vec2(1.32, 1.0);
  float radius = max(length(point), 0.025);
  float angle = atan(point.y, point.x);
  float lensStrength = 0.055 + uSubBass * 0.12 + uOnset * 0.035;
  float bentAngle = angle + lensStrength / radius;
  vec2 bent = vec2(cos(bentAngle), sin(bentAngle)) * radius;
  float stars = starField(bent + vec2(0.5), 54.0);
  float fineStars = starField(bent.yx + vec2(0.23, 0.61), 91.0) * 0.55;
  float arc = exp(-pow((radius - 0.47 - uSubBass * 0.035) * 32.0, 2.0));
  float angularVariation = 0.45 + 0.55 * sin(angle * 3.0 + uTime * 0.08);
  vec3 color = vec3(0.002, 0.004, 0.012);
  color += vec3(0.24, 0.36, 0.76) * (stars + fineStars) * 0.45;
  color += vec3(0.28, 0.18, 0.72) * arc * angularVariation * 0.46;
  color += vec3(0.08, 0.48, 0.82) * arc * uOnset * 0.28;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const VEIL_VERTEX_SHADER = `
uniform float uTime;
uniform float uBass;
uniform float uLowMids;
uniform float uMids;
uniform float uBrilliance;
varying vec3 vColor;
varying float vAlpha;

void main() {
  float radius = length(position.xy);
  float angle = atan(position.y, position.x);
  float phase = angle * 4.0 + radius * 2.7;
  float ripple = sin(phase - uTime * 0.18) * (0.08 + uLowMids * 0.22);
  float fold = sin(angle * 9.0 + radius * 1.6 + uTime * 0.12) * (0.03 + uBass * 0.1);
  float z = position.z + ripple + fold;
  float twist = sin(radius * 1.7 + uTime * 0.08) * (0.025 + uMids * 0.035);
  vec2 twisted = position.xy + normalize(position.xy) * twist;
  vec4 viewPosition = modelViewMatrix * vec4(twisted, z, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = clamp((1.0 + uBrilliance * 1.5) * (14.0 / -viewPosition.z), 1.0, 3.2);

  float inner = 1.0 - smoothstep(1.45, 2.8, radius);
  vec3 violet = vec3(0.46, 0.25, 0.94);
  vec3 cyan = vec3(0.04, 0.68, 0.9);
  vec3 warm = vec3(0.82, 0.88, 1.0);
  float colorFlow = 0.5 + 0.5 * sin(angle * 2.0 + radius * 2.1 + uTime * 0.035);
  vColor = mix(violet, cyan, smoothstep(0.22, 0.82, colorFlow));
  vColor = mix(vColor, warm, uBrilliance * 0.28);
  float veilWave = 0.56 + 0.44 * sin(phase * 1.7 - uTime * 0.16);
  vAlpha = (0.14 + 0.2 * veilWave + 0.12 * uBrilliance) * mix(0.58, 1.0, inner);
}
`;

const VEIL_FRAGMENT_SHADER = `
uniform float uBrilliance;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 point = gl_PointCoord - 0.5;
  float distanceFromCenter = length(point);
  float pointAlpha = (1.0 - smoothstep(0.12, 0.5, distanceFromCenter)) * vAlpha;
  if (pointAlpha < 0.018) discard;
  gl_FragColor = vec4(vColor * (0.68 + uBrilliance * 0.45), pointAlpha);
}
`;

const CORE_VERTEX_SHADER = `
uniform float uTime;
uniform float uSubBass;
uniform float uOnset;
varying vec3 vNormalView;
varying vec3 vPosition;

void main() {
  vec3 p = position;
  float pulse = sin(position.x * 4.0 + position.y * 2.0 + uTime * 1.7);
  float distortion = (uSubBass * 0.12 + uOnset * 0.06) * pulse;
  p += normal * distortion;
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vPosition = viewPosition.xyz;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const CORE_FRAGMENT_SHADER = `
uniform float uTime;
uniform float uSubBass;
uniform float uPresence;
uniform float uOnset;
varying vec3 vNormalView;
varying vec3 vPosition;

void main() {
  vec3 normal = normalize(vNormalView);
  vec3 viewDirection = normalize(-vPosition);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2);
  float pulse = 0.5 + 0.5 * sin(uTime * 1.3 + vPosition.y * 3.0);
  float edgeLight = rim * (0.1 + uSubBass * 0.48 + uPresence * 0.26 + uOnset * 0.2);
  vec3 color = vec3(0.003, 0.004, 0.012);
  color += vec3(0.19, 0.07, 0.18) * rim * (0.12 + pulse * 0.12);
  color += vec3(0.46, 0.42, 1.0) * edgeLight;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const FILAMENT_VERTEX_SHADER = `
uniform float uTime;
uniform float uUpperMids;
uniform float uPresence;
uniform float uOnset;
uniform float uPhase;
varying float vGlow;

void main() {
  vec3 p = position;
  float wave = sin(uv.x * 22.0 - uTime * 1.6 + uPhase);
  float fineWave = sin(uv.x * 51.0 + uTime * 2.4 + uPhase * 2.0);
  float displacement = wave * uUpperMids * 0.045
    + fineWave * uPresence * 0.018
    + uOnset * 0.03;
  p += normal * displacement;
  vGlow = 0.32 + 0.38 * (0.5 + 0.5 * wave) + uPresence * 0.48 + uOnset * 0.35;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FILAMENT_FRAGMENT_SHADER = `
uniform float uUpperMids;
uniform float uPresence;
uniform float uBrilliance;
uniform float uPhase;
varying float vGlow;

void main() {
  vec3 violet = vec3(0.46, 0.42, 1.0);
  vec3 warmWhite = vec3(0.89, 0.93, 1.0);
  vec3 color = mix(violet, warmWhite, 0.58 + uBrilliance * 0.3);
  float intensity = vGlow * (0.26 + uUpperMids * 0.48 + uPresence * 0.5 + uBrilliance * 0.2);
  gl_FragColor = vec4(color * intensity, 0.3 + min(intensity, 0.64));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const STREAM_VERTEX_SHADER = `
uniform float uTime;
uniform float uMids;
uniform float uOnset;
uniform float uBrilliance;
varying float vAlpha;

void main() {
  float angle = uTime * 0.11 + position.z * 0.18;
  mat2 orbit = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 xy = orbit * position.xy;
  float ripple = sin(position.z * 4.0 - uTime * 1.1) * (0.018 + uMids * 0.09);
  vec3 p = vec3(xy * (1.0 + ripple), position.z + sin(angle * 2.0) * 0.04);
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = clamp((1.0 + uBrilliance * 1.8 + uOnset) * 120.0 / -viewPosition.z, 1.0, 4.0);
  vAlpha = 0.1 + uMids * 0.3 + uBrilliance * 0.42 + uOnset * 0.2;
}
`;

const STREAM_FRAGMENT_SHADER = `
varying float vAlpha;
void main() {
  vec2 point = gl_PointCoord - 0.5;
  float alpha = (1.0 - smoothstep(0.12, 0.5, length(point))) * vAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(0.35, 0.48, 1.0, alpha);
}
`;

const ARC_VERTEX_SHADER = `
uniform float uTime;
uniform float uPresence;
uniform float uOnset;
varying float vAlpha;

void main() {
  float angle = uTime * 0.035 + position.z * 0.01;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 xy = rotation * position.xy;
  vec4 viewPosition = modelViewMatrix * vec4(xy, position.z, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = clamp(1.0 + uPresence * 2.3 + uOnset * 1.4, 1.0, 4.0);
  float flicker = 0.55 + 0.45 * sin(position.z * 4.0 - uTime * 2.8);
  vAlpha = (uPresence * 0.74 + uOnset * 0.42) * flicker;
}
`;

const ARC_FRAGMENT_SHADER = `
varying float vAlpha;
void main() {
  vec2 point = gl_PointCoord - 0.5;
  float alpha = (1.0 - smoothstep(0.16, 0.5, length(point))) * vAlpha;
  if (alpha < 0.015) discard;
  gl_FragColor = vec4(0.93, 0.88, 0.76, alpha);
}
`;

const PARTICLE_VERTEX_SHADER = `
uniform float uTime;
uniform float uBrilliance;
uniform float uOnset;
varying float vAlpha;

void main() {
  float seed = dot(position, vec3(12.9898, 78.233, 37.719));
  float drift = sin(seed + uTime * 0.14) * 0.016;
  vec3 p = position + normalize(position) * drift;
  vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = clamp((0.8 + uBrilliance * 1.8 + uOnset) * 105.0 / -viewPosition.z, 1.0, 3.5);
  vAlpha = 0.045 + uBrilliance * 0.3 + uOnset * 0.13;
}
`;

const PARTICLE_FRAGMENT_SHADER = `
varying float vAlpha;
void main() {
  vec2 point = gl_PointCoord - 0.5;
  float alpha = (1.0 - smoothstep(0.12, 0.5, length(point))) * vAlpha;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(0.62, 0.76, 1.0, alpha);
}
`;

const SPECTRUM_RANGES = Array.from({ length: 32 }, (_, index) => {
    const lowRatio = index / 32;
    const highRatio = (index + 1) / 32;
    return [
        20 * Math.pow(800, lowRatio * lowRatio),
        20 * Math.pow(800, highRatio * highRatio),
    ] as const;
});

type Uniforms = Record<string, THREE.IUniform<number>>;

function makeUniforms(keys: readonly string[]): Uniforms {
    return Object.fromEntries(keys.map((key) => [key, { value: 0 }]));
}

function setUniform(material: THREE.ShaderMaterial | null, key: string, value: number) {
    if (material) material.uniforms[key].value = value;
}

function boundedResponse(value: number, weight: number, sensitivity: number, motionScale: number) {
    return THREE.MathUtils.clamp(value * weight * sensitivity * motionScale, 0, 1);
}

function createSpiralPoints(count: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        const progress = i / count;
        const angle = progress * Math.PI * 8 + (i % 3) * ((Math.PI * 2) / 3);
        const radius = 1.28 + progress * 1.28;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = Math.sin(angle) * radius;
        positions[i * 3 + 2] = Math.sin(angle * 0.35) * 0.42;
    }
    return positions;
}

function createParticlePositions(count: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
        const seed = i + 1;
        const angle = seed * 2.39996322973;
        const radius = 2.65 + ((seed * 0.754877666) % 1) * 2.1;
        const vertical = (((seed * 0.61803398875) % 1) - 0.5) * 2.0;
        const ring = Math.sqrt(1 - vertical * vertical);
        positions[i * 3] = Math.cos(angle) * ring * radius;
        positions[i * 3 + 1] = vertical * radius;
        positions[i * 3 + 2] = Math.sin(angle) * ring * radius;
    }
    return positions;
}

function createVeilPositions(angularSegments: number, radialSegments: number) {
    const positions = new Float32Array(angularSegments * radialSegments * 3);
    let index = 0;

    for (let angular = 0; angular < angularSegments; angular += 1) {
        const angle = (angular / angularSegments) * Math.PI * 2;
        const angleWarp = Math.sin(angle * 5.0) * 0.075;

        for (let radial = 0; radial < radialSegments; radial += 1) {
            const radialRatio = radial / (radialSegments - 1);
            const radius = 1.28 + radialRatio * 2.05 + angleWarp;
            const phase = angle * 4 + radius * 2.7;
            positions[index] = Math.cos(angle) * radius;
            positions[index + 1] = Math.sin(angle) * radius;
            positions[index + 2] =
                Math.sin(phase) * 0.11 + Math.sin(angle * 8 + radius * 1.4) * 0.045;
            index += 3;
        }
    }
    return positions;
}

function createArcPositions(count: number) {
    const positions = new Float32Array(count * 3);
    const radii = [1.42, 1.83, 2.18];
    const starts = [0.2, 2.6, 4.1];
    const lengths = [1.32, 1.05, 1.48];
    for (let i = 0; i < count; i += 1) {
        const arc = i % radii.length;
        const step = Math.floor(i / radii.length);
        const progress = step / Math.ceil(count / radii.length);
        const angle = starts[arc] + progress * lengths[arc];
        const radius = radii[arc] + Math.sin(progress * Math.PI * 5) * 0.018;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = Math.sin(angle) * radius;
        positions[i * 3 + 2] = 0.08 + arc * 0.025;
    }
    return positions;
}

function createFilaments() {
    return [
        new THREE.CatmullRomCurve3([
            new THREE.Vector3(-2.3, -0.65, 0.35),
            new THREE.Vector3(-1.1, -1.3, 0.28),
            new THREE.Vector3(0.15, -1.2, 0.38),
            new THREE.Vector3(1.0, -0.52, 0.3),
            new THREE.Vector3(2.2, -0.82, 0.08),
        ]),
        new THREE.CatmullRomCurve3([
            new THREE.Vector3(-2.0, 0.85, -0.28),
            new THREE.Vector3(-0.95, 1.28, -0.12),
            new THREE.Vector3(0.25, 1.08, -0.22),
            new THREE.Vector3(1.2, 0.5, -0.16),
            new THREE.Vector3(2.15, 0.9, 0.1),
        ]),
        new THREE.CatmullRomCurve3([
            new THREE.Vector3(-0.3, -2.25, -0.15),
            new THREE.Vector3(0.45, -1.35, -0.25),
            new THREE.Vector3(0.2, -0.2, -0.34),
            new THREE.Vector3(-0.55, 0.85, -0.3),
            new THREE.Vector3(0.0, 2.15, -0.05),
        ]),
    ];
}

export function EventHorizonScene({
    profile = EVENT_HORIZON_PROFILE,
}: {
    profile?: VisualResponseProfile;
} = {}) {
    const { analyzer, settings, isPlaying, reducedMotion, barsRef } = useVisualizerSceneContext();
    const veilPositions = useMemo(
        () => createVeilPositions(reducedMotion ? 88 : 144, reducedMotion ? 42 : 64),
        [reducedMotion],
    );
    const timeRef = useRef(0);
    const diskRef = useRef<THREE.Mesh>(null);
    const veilMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const lensingMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const coreMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const diskMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const filamentMaterials = useRef<Array<THREE.ShaderMaterial | null>>([]);
    const streamMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const arcMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const particleMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const spectrumLevelsRef = useRef(new Float32Array(SPECTRUM_RANGES.length));
    const streams = useMemo(() => createSpiralPoints(660), []);
    const particles = useMemo(
        () => createParticlePositions(reducedMotion ? 220 : 440),
        [reducedMotion],
    );
    const arcs = useMemo(() => createArcPositions(360), []);
    const filaments = useMemo(() => createFilaments(), []);
    const uniforms = useMemo(
        () => ({
            lensing: makeUniforms(['uTime', 'uSubBass', 'uOnset']),
            veil: makeUniforms(['uTime', 'uBass', 'uLowMids', 'uMids', 'uBrilliance']),
            core: makeUniforms(['uTime', 'uSubBass', 'uPresence', 'uOnset']),
            disk: makeUniforms(['uTime', 'uBass', 'uLowMids', 'uPresence', 'uOnset']),
            filament: filaments.map(() =>
                makeUniforms([
                    'uTime',
                    'uUpperMids',
                    'uPresence',
                    'uOnset',
                    'uBrilliance',
                    'uPhase',
                ]),
            ),
            streams: makeUniforms(['uTime', 'uMids', 'uOnset', 'uBrilliance']),
            arcs: makeUniforms(['uTime', 'uPresence', 'uOnset']),
            particles: makeUniforms(['uTime', 'uBrilliance', 'uOnset']),
        }),
        [filaments],
    );

    useFrame((_, delta) => {
        const time = (timeRef.current += delta);
        const features = analyzer?.update(delta, isPlaying) ?? EMPTY_FEATURES;
        const motionScale = reducedMotion ? 0.25 : 1;
        const sensitivity = THREE.MathUtils.clamp(settings.sensitivity / 2, 0, 1.5);
        const onset = boundedResponse(
            features.onset,
            profile.onsetImpact,
            sensitivity,
            motionScale,
        );
        const subBass = boundedResponse(
            features.subBass,
            profile.subBassCore,
            sensitivity,
            motionScale,
        );
        const bass = boundedResponse(features.bass, profile.bassFolds, sensitivity, motionScale);
        const lowMids = boundedResponse(
            features.lowMids,
            profile.lowMidWaves,
            sensitivity,
            motionScale,
        );
        const mids = boundedResponse(features.mids, profile.midPatterns, sensitivity, motionScale);
        const upperMids = boundedResponse(
            features.upperMids,
            profile.upperMidTendrils,
            sensitivity,
            motionScale,
        );
        const presence = boundedResponse(
            features.presence,
            profile.presenceFlash,
            sensitivity,
            motionScale,
        );
        const brilliance = boundedResponse(
            features.brilliance,
            profile.brillianceParticles,
            sensitivity,
            motionScale,
        );

        if (diskRef.current) {
            diskRef.current.rotation.z = time * 0.035 * motionScale;
            diskRef.current.rotation.x = 0.12 + Math.sin(time * 0.08) * 0.018 * motionScale;
        }
        const sceneTime = time * motionScale;
        setUniform(lensingMaterialRef.current, 'uTime', sceneTime);
        setUniform(lensingMaterialRef.current, 'uSubBass', subBass);
        setUniform(lensingMaterialRef.current, 'uOnset', onset);
        setUniform(veilMaterialRef.current, 'uTime', sceneTime);
        setUniform(veilMaterialRef.current, 'uBass', bass);
        setUniform(veilMaterialRef.current, 'uLowMids', lowMids);
        setUniform(veilMaterialRef.current, 'uMids', mids);
        setUniform(veilMaterialRef.current, 'uBrilliance', brilliance);
        setUniform(coreMaterialRef.current, 'uTime', sceneTime);
        setUniform(coreMaterialRef.current, 'uSubBass', subBass);
        setUniform(coreMaterialRef.current, 'uPresence', presence);
        setUniform(coreMaterialRef.current, 'uOnset', onset);
        setUniform(diskMaterialRef.current, 'uTime', sceneTime);
        setUniform(diskMaterialRef.current, 'uBass', bass);
        setUniform(diskMaterialRef.current, 'uLowMids', lowMids);
        setUniform(diskMaterialRef.current, 'uPresence', presence);
        setUniform(diskMaterialRef.current, 'uOnset', onset);
        for (let i = 0; i < filamentMaterials.current.length; i += 1) {
            const material = filamentMaterials.current[i];
            setUniform(material, 'uTime', sceneTime);
            setUniform(material, 'uUpperMids', upperMids);
            setUniform(material, 'uPresence', presence);
            setUniform(material, 'uOnset', onset);
            setUniform(material, 'uBrilliance', brilliance);
            setUniform(material, 'uPhase', i * 2.1);
        }
        setUniform(streamMaterialRef.current, 'uTime', sceneTime);
        setUniform(streamMaterialRef.current, 'uMids', mids);
        setUniform(streamMaterialRef.current, 'uOnset', onset);
        setUniform(streamMaterialRef.current, 'uBrilliance', brilliance);
        setUniform(arcMaterialRef.current, 'uTime', sceneTime);
        setUniform(arcMaterialRef.current, 'uPresence', presence);
        setUniform(arcMaterialRef.current, 'uOnset', onset);
        setUniform(particleMaterialRef.current, 'uTime', sceneTime);
        setUniform(particleMaterialRef.current, 'uBrilliance', brilliance);
        setUniform(particleMaterialRef.current, 'uOnset', onset);
        updateSpectrumBars(features, barsRef.current, sensitivity, spectrumLevelsRef.current);
    });

    return (
        <>
            <color attach="background" args={['#030611']} />
            <fog attach="fog" args={['#030611', 8, 22]} />
            <ambientLight intensity={0.16} color="#97a8da" />
            <pointLight position={[-3.8, 2.2, 4]} intensity={2.1} color="#d76432" />
            <pointLight position={[3.2, -2.3, -1]} intensity={1.25} color="#5989ff" />
            <pointLight position={[0, 3.5, 1]} intensity={0.65} color="#9e75ed" />

            <points frustumCulled={false} renderOrder={1}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[veilPositions, 3]} />
                </bufferGeometry>
                <shaderMaterial
                    ref={veilMaterialRef}
                    uniforms={uniforms.veil}
                    vertexShader={VEIL_VERTEX_SHADER}
                    fragmentShader={VEIL_FRAGMENT_SHADER}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            <mesh position={[0, 0, -2]}>
                <planeGeometry args={[12, 9]} />
                <shaderMaterial
                    ref={lensingMaterialRef}
                    uniforms={uniforms.lensing}
                    vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
                    fragmentShader={LENSING_FRAGMENT_SHADER}
                    depthWrite={false}
                />
            </mesh>

            <mesh ref={diskRef} rotation={[0.12, 0, 0]}>
                <planeGeometry args={[6, 6, 80, 80]} />
                <shaderMaterial
                    ref={diskMaterialRef}
                    uniforms={uniforms.disk}
                    vertexShader={DISK_VERTEX_SHADER}
                    fragmentShader={DISK_FRAGMENT_SHADER}
                    transparent
                    depthWrite={false}
                    side={THREE.DoubleSide}
                    blending={THREE.AdditiveBlending}
                />
            </mesh>

            <mesh scale={[1.035, 1.035, 0.92]} renderOrder={2}>
                <sphereGeometry args={[1, 64, 48]} />
                <shaderMaterial
                    ref={coreMaterialRef}
                    uniforms={uniforms.core}
                    vertexShader={CORE_VERTEX_SHADER}
                    fragmentShader={CORE_FRAGMENT_SHADER}
                />
            </mesh>

            {filaments.map((curve, index) => (
                <mesh key={index} rotation={[index * 0.12, index * 0.3, 0]} renderOrder={3}>
                    <tubeGeometry args={[curve, 120, 0.012 + index * 0.002, 5, false]} />
                    <shaderMaterial
                        ref={(material) => {
                            filamentMaterials.current[index] = material;
                        }}
                        uniforms={uniforms.filament[index]}
                        vertexShader={FILAMENT_VERTEX_SHADER}
                        fragmentShader={FILAMENT_FRAGMENT_SHADER}
                        transparent
                        depthWrite={false}
                        side={THREE.DoubleSide}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            ))}

            <points frustumCulled={false} renderOrder={4}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[streams, 3]} />
                </bufferGeometry>
                <shaderMaterial
                    ref={streamMaterialRef}
                    uniforms={uniforms.streams}
                    vertexShader={STREAM_VERTEX_SHADER}
                    fragmentShader={STREAM_FRAGMENT_SHADER}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            <points frustumCulled={false} renderOrder={5}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[arcs, 3]} />
                </bufferGeometry>
                <shaderMaterial
                    ref={arcMaterialRef}
                    uniforms={uniforms.arcs}
                    vertexShader={ARC_VERTEX_SHADER}
                    fragmentShader={ARC_FRAGMENT_SHADER}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            <points frustumCulled={false} renderOrder={1}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[particles, 3]} />
                </bufferGeometry>
                <shaderMaterial
                    ref={particleMaterialRef}
                    uniforms={uniforms.particles}
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

function updateSpectrumBars(
    features: AudioFeatures,
    bars: Array<HTMLDivElement | null>,
    sensitivity: number,
    lastLevels: Float32Array,
) {
    const binWidth = features.sampleRate / (features.frequency.length * 2);
    const barCount = bars.length;
    for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
        const bar = bars[barIndex];
        if (!bar) continue;
        const [minHz, maxHz] = SPECTRUM_RANGES[barIndex];
        const minBin = Math.max(1, Math.floor(minHz / binWidth));
        const maxBin = Math.min(
            features.frequency.length,
            Math.max(minBin + 1, Math.ceil(maxHz / binWidth)),
        );
        let levelSum = 0;
        for (let bin = minBin; bin < maxBin; bin += 1) {
            levelSum += features.frequency[bin] / 255;
        }
        const average = levelSum / Math.max(1, maxBin - minBin);
        const level = Math.max(0.018, Math.min(1, Math.pow(average, 0.55) * sensitivity * 1.45));
        if (Math.abs(level - lastLevels[barIndex]) > 0.006) {
            lastLevels[barIndex] = level;
            bar.style.transform = `scaleY(${level})`;
        }
    }
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
