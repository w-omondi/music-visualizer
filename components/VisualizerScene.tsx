"use client";

import { Sparkles, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { AudioAnalyzer, type AudioFeatures, type VisualizerSettings } from "@/lib/audioAnalyzer";

type VisualizerSceneProps = {
  analyzer: AudioAnalyzer | null;
  settings: VisualizerSettings;
  isPlaying: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
};

const createEmptyFeatures = (): AudioFeatures => ({
  bass: 0,
  mids: 0,
  treble: 0,
  energy: 0,
  beat: 0,
  frequency: new Uint8Array(1024),
  waveform: new Float32Array(1024),
});

function particleRandom(seed: number) {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function VisualizerContent({ analyzer, settings, isPlaying, onCanvasReady }: VisualizerSceneProps) {
  const centralRef = useRef<THREE.Mesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const orbitGroupRef = useRef<THREE.Group>(null);
  const waveformRef = useRef<THREE.Line | null>(null);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);

  const particlePositions = useMemo(() => {
    const positions = new Float32Array(2200 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      const particle = i / 3;
      const radius = 2.5 + particleRandom(particle * 3 + 1) * 2.1;
      const theta = particleRandom(particle * 3 + 2) * Math.PI * 2;
      const phi = Math.acos(2 * particleRandom(particle * 3 + 3) - 1);
      positions[i] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i + 1] = radius * Math.cos(phi) * 0.8;
      positions[i + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    return positions;
  }, []);

  const waveformGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(256 * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);
  const waveformLine = useMemo(
    () => new THREE.Line(waveformGeometry, new THREE.LineBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.9 })),
    [waveformGeometry],
  );

  useEffect(() => {
    if (!centralRef.current) {
      return;
    }

    const geometry = centralRef.current.geometry as THREE.IcosahedronGeometry;
    if (geometry && geometry.attributes.position) {
      const originalPositions = new Float32Array(geometry.attributes.position.array);
      centralRef.current.userData.originalPositions = originalPositions;
    }
  }, []);

  useEffect(() => {
    if (onCanvasReady) {
      const canvas = document.querySelector("canvas");
      if (canvas) {
        onCanvasReady(canvas as HTMLCanvasElement);
      }
    }
  }, [onCanvasReady]);

  useFrame((state, delta) => {
    const features = analyzer ? analyzer.update() : createEmptyFeatures();
    const time = state.clock.getElapsedTime();

    if (centralRef.current) {
      const bassAmount = features.bass * (0.9 + settings.bassBoost * 1.4);
      const midsAmount = features.mids * (0.8 + settings.midsBoost * 1.2);
      const trebleAmount = features.treble * (0.8 + settings.trebleBoost * 1.3);
      const beatBoost = features.beat * (1.5 + settings.beatSensitivity * 2.2);

      centralRef.current.rotation.x += delta * (0.45 + midsAmount * 0.8);
      centralRef.current.rotation.y += delta * (0.7 + trebleAmount * 0.9);
      centralRef.current.rotation.z += delta * 0.2;

      const targetScale = 1 + bassAmount * 0.22 + beatBoost * 0.18;
      const currentScale = centralRef.current.scale.x;
      centralRef.current.scale.setScalar(THREE.MathUtils.lerp(currentScale, targetScale, 0.12));

      const geometry = centralRef.current.geometry as THREE.IcosahedronGeometry;
      const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
      const originalPositions =
        (centralRef.current.userData.originalPositions as Float32Array | undefined) ??
        new Float32Array(positionAttr.array);
      centralRef.current.userData.originalPositions = originalPositions;

      for (let i = 0; i < positionAttr.count; i += 1) {
        const baseIndex = i * 3;
        const x = originalPositions[baseIndex];
        const y = originalPositions[baseIndex + 1];
        const z = originalPositions[baseIndex + 2];
        const displacement =
          Math.sin(x * 3 + time * 0.9) * 0.12 +
          Math.cos(y * 4.2 - time * 1.3) * 0.14 +
          Math.sin(z * 5.1 + time * 1.8) * 0.09 +
          bassAmount * 0.26 +
          midsAmount * 0.12 +
          trebleAmount * 0.18;

        positionAttr.array[baseIndex] = x * (1 + displacement * 0.7);
        positionAttr.array[baseIndex + 1] = y * (1 + displacement * 0.85);
        positionAttr.array[baseIndex + 2] = z * (1 + displacement * 0.75);
      }

      positionAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    if (pointsRef.current) {
      const pscale = 1 + features.bass * 0.08 + features.beat * 0.07;
      pointsRef.current.scale.setScalar(pscale);
      pointsRef.current.rotation.y += delta * (0.04 + settings.cameraDrift * 0.16);
      pointsRef.current.rotation.x = Math.sin(time * 0.45) * 0.25;
      pointsRef.current.rotation.z = Math.cos(time * 0.3) * 0.2;
    }

    if (orbitGroupRef.current) {
      orbitGroupRef.current.rotation.y = time * (0.08 + settings.cameraDrift * 0.28);
      orbitGroupRef.current.rotation.x = Math.sin(time * 0.4) * 0.25;
    }

    if (waveformRef.current) {
      const attr = waveformRef.current.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < 256; i += 1) {
        const angle = (i / 256) * Math.PI * 2;
        const sampleIndex = Math.floor((i / 256) * (features.waveform.length - 1));
        const sampleValue = features.waveform[sampleIndex] ?? 0;
        const radius = 2.75 + sampleValue * 0.65 + features.treble * 0.4 + (isPlaying ? 0.2 : 0);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const z = Math.sin(angle * 4 + time) * 0.25 + features.treble * 0.45;
        attr.array[i * 3] = x;
        attr.array[i * 3 + 1] = y;
        attr.array[i * 3 + 2] = z;
      }
      attr.needsUpdate = true;
      waveformRef.current.rotation.z = time * 0.22;
    }

    ringRefs.current.forEach((ring, ringIndex) => {
      if (!ring) {
        return;
      }

      const ringBoost = features.bass * (0.8 + ringIndex * 0.35) + features.mids * 0.5 + features.beat * 0.9;
      const target = 1.0 + ringIndex * 0.04 + ringBoost * 0.08;
      const current = ring.scale.x;
      ring.scale.setScalar(THREE.MathUtils.lerp(current, target, 0.12));
      ring.rotation.z += delta * (0.14 + ringIndex * 0.08);
      ring.rotation.x = Math.PI / 2 + Math.sin(time + ringIndex) * 0.45;
    });

    if (state.camera) {
      const drift = settings.cameraDrift * 0.5;
      const camera = state.camera as THREE.PerspectiveCamera;
      const aspect = state.size.width / Math.max(state.size.height, 1);
      const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
      const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
      const fittedDistance = 5.7 / Math.sin(limitingHalfFov);

      state.camera.position.x = Math.sin(time * 0.3) * drift;
      state.camera.position.y = Math.cos(time * 0.2) * drift * 0.6;
      state.camera.position.z = Math.max(14, fittedDistance);
      state.camera.lookAt(0, 0, 0);
    }
  });

  return (
    <>
      <color attach="background" args={["#050816"]} />
      <fog attach="fog" args={["#050816", 10, 24]} />
      <ambientLight intensity={0.9 + settings.glow * 0.6} color="#dfeaff" />
      <directionalLight position={[3, 4, 7]} intensity={1.8 + settings.glow * 1.4} color="#8ec5ff" />
      <pointLight position={[-4, -2, 5]} intensity={1.4 + settings.glow * 1.2} color="#67e8f9" />
      <pointLight position={[4, 2, -3]} intensity={1.1 + settings.glow * 1.2} color="#a78bfa" />

      <Sparkles count={180} scale={[10, 7, 10]} size={1.6} speed={0.65} color="#bfe7ff" />
      <Stars radius={60} depth={25} count={3500} factor={3} saturation={0} fade speed={0.8} />

      <group ref={orbitGroupRef}>
        {Array.from({ length: 5 }).map((_, index) => (
          <mesh
            key={`ring-${index}`}
            ref={(node) => {
              ringRefs.current[index] = node;
            }}
            rotation={[Math.PI / 2, 0, 0]}
            position={[0, 0, 0]}
          >
            <torusGeometry args={[2.2 + index * 0.35, 0.015 + index * 0.008, 32, 240]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? "#5eead4" : index % 3 === 0 ? "#93c5fd" : "#c4b5fd"}
              emissive={index % 2 === 0 ? "#22d3ee" : "#8b5cf6"}
              emissiveIntensity={0.5 + index * 0.15}
              wireframe
              transparent
              opacity={0.7}
            />
          </mesh>
        ))}
      </group>

      <mesh ref={centralRef} position={[0, 0, 0]}>
        <icosahedronGeometry args={[1.35, 2]} />
        <meshPhysicalMaterial
          color="#7dd3fc"
          emissive="#60a5fa"
          emissiveIntensity={0.7 + settings.glow * 0.7}
          metalness={0.4}
          roughness={0.2}
          transmission={0.25}
          transparent
          opacity={0.92}
          clearcoat={1}
        />
      </mesh>

      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#e2e8f0"
          size={0.04 + settings.intensity * 0.08}
          transparent
          opacity={0.82}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <primitive object={waveformLine} ref={waveformRef} />

      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.3]}>
        <circleGeometry args={[2.6, 96]} />
        <meshBasicMaterial color="#0ea5e9" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>

      <mesh rotation={[0, 0, 0]} position={[0, 0, -2.2]}>
        <sphereGeometry args={[4.6, 32, 32]} />
        <meshBasicMaterial color="#1d4ed8" transparent opacity={0.05} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

export function VisualizerScene(props: VisualizerSceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 14], fov: 48, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.setClearColor("#050816");
      }}
    >
      <VisualizerContent {...props} />
    </Canvas>
  );
}
