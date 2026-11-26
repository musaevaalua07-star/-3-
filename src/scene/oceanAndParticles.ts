import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';

export interface OceanParticleSystem {
  group: THREE.Group;
  update: (
    dt: number,
    time: number,
    wavePower: number,
    shoreX: number,
    progress: number,
    underwaterClarity: number
  ) => { crestImpact: number };
  emitSplashBurst: (origin: THREE.Vector3, strength?: number) => void;
  emitRockfallDust: (shoreX: number) => void;
  dispose: () => void;
}

interface SprayParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

interface DustParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

/**
 * Builds the physically-based dynamic ocean with custom Gerstner wave + foam GLSL
 * (via MeshPhysicalMaterial.onBeforeCompile) and zero-GC particle pools for:
 * - Sunlit wave-impact spray plumes
 * - Swirling corrasion pebbles / sediment suspension at cliff base
 * - Rockfall collapse dust clouds
 */
export function buildOceanAndParticles(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean
): OceanParticleSystem {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // ============================================================
  // 1. PBR DYNAMIC OCEAN SURFACE (onBeforeCompile Gerstner + Foam)
  // ============================================================
  const oceanGeo = new THREE.PlaneGeometry(118, 128, 130, 96);
  oceanGeo.rotateX(-Math.PI / 2);
  // Shift so ocean runs from X = -14 (under cliff notch) out to X = +104 (horizon)
  oceanGeo.translate(45, 0, 0);
  disposables.push(oceanGeo);

  const oceanUniforms = {
    uTime: { value: 0 },
    uWavePower: { value: 1.0 },
    uShoreX: { value: 2.4 },
    uStackPos: { value: new THREE.Vector2(9.6, -4.6) },
    uClarity: { value: 0.0 },
  };

  const oceanMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0c3b57'),
    roughness: 0.14,
    metalness: 0.08,
    clearcoat: isSoftwareGl ? 0.0 : 0.85,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: 0.9,
  });

  oceanMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = oceanUniforms.uTime;
    shader.uniforms.uWavePower = oceanUniforms.uWavePower;
    shader.uniforms.uShoreX = oceanUniforms.uShoreX;
    shader.uniforms.uStackPos = oceanUniforms.uStackPos;
    shader.uniforms.uClarity = oceanUniforms.uClarity;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWavePower;
      uniform float uShoreX;
      varying float vWaveHeight;
      varying vec3 vWorldPos;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      #include <beginnormal_vertex>
      vec3 wPosN = (modelMatrix * vec4(position, 1.0)).xyz;
      float speedN = 1.9 + uWavePower * 0.55;
      float ampN = (0.34 + uWavePower * 0.42);
      // Shoaling amplification as wave approaches cliff shore
      float distShoreN = max(0.0, wPosN.x - uShoreX);
      float shoalN = 1.0 + exp(-distShoreN * 0.18) * 0.65;

      float phase1N = wPosN.x * 0.42 + uTime * speedN + sin(wPosN.z * 0.16) * 0.8;
      float phase2N = wPosN.x * 0.88 + wPosN.z * 0.32 + uTime * (speedN * 1.35);
      float phase3N = wPosN.x * 1.65 - wPosN.z * 0.65 + uTime * (speedN * 1.75);

      float dHx = cos(phase1N) * 0.42 * ampN * shoalN
                + cos(phase2N) * 0.88 * ampN * 0.32
                + cos(phase3N) * 1.65 * ampN * 0.12;
      float dHz = cos(phase2N) * 0.32 * ampN * 0.32
                - cos(phase3N) * 0.65 * ampN * 0.12;
      objectNormal = normalize(vec3(-dHx, 1.0, -dHz));
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec3 wPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      float speed = 1.9 + uWavePower * 0.55;
      float amp = (0.34 + uWavePower * 0.42);
      float distShore = max(0.0, wPos.x - uShoreX);
      float shoal = 1.0 + exp(-distShore * 0.18) * 0.65;

      // Primary rolling swell moving toward -X (the cliff!)
      float phase1 = wPos.x * 0.42 + uTime * speed + sin(wPos.z * 0.16) * 0.8;
      float phase2 = wPos.x * 0.88 + wPos.z * 0.32 + uTime * (speed * 1.35);
      float phase3 = wPos.x * 1.65 - wPos.z * 0.65 + uTime * (speed * 1.75);

      // Sharpened trochoidal wave crest profile
      float w1 = sin(phase1);
      float sharpCrest = (w1 + 0.28 * sin(phase1 * 2.0 - 0.6)) * amp * shoal;
      float w2 = sin(phase2) * amp * 0.32;
      float w3 = sin(phase3) * amp * 0.12;

      // Dampen waves slightly deep inside the back of the cliff mesh
      float inlandMask = smoothstep(uShoreX - 5.2, uShoreX - 1.0, wPos.x);
      float totalH = (sharpCrest + w2 + w3) * inlandMask;

      transformed.y += totalH;
      // Subtle horizontal Gerstner surge
      transformed.x -= cos(phase1) * amp * 0.38 * inlandMask;

      vWaveHeight = totalH;
      vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `
    );

    shader.fragmentShader =
      `
      uniform float uTime;
      uniform float uWavePower;
      uniform float uShoreX;
      uniform vec2 uStackPos;
      uniform float uClarity;
      varying float vWaveHeight;
      varying vec3 vWorldPos;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      // Depth color transition: shallow turquoise abrasion bench -> deep oceanic slate-blue
      float distFromShore = max(0.0, vWorldPos.x - uShoreX);
      float shallowMix = exp(-distFromShore * 0.11);
      vec3 deepColor = vec3(0.035, 0.145, 0.245);
      vec3 shallowColor = mix(vec3(0.085, 0.385, 0.445), vec3(0.14, 0.56, 0.64), uClarity);
      vec3 waterBase = mix(deepColor, shallowColor, shallowMix);

      // Dynamic surf foam at cliff impact line, breaking wave crests, and around the sea stack
      float foamNoise = sin(vWorldPos.x * 3.1 + uTime * 2.4) * cos(vWorldPos.z * 2.7 - uTime * 1.8) * 0.5 + 0.5;
      float foamDetail = sin(vWorldPos.x * 7.5 - vWorldPos.z * 6.2 + uTime * 3.8) * 0.5 + 0.5;

      // Cliff impact foam belt
      float cliffEdgeDist = abs(vWorldPos.x - (uShoreX + 0.55));
      float cliffFoam = smoothstep(2.6 + uWavePower * 0.9, 0.15, cliffEdgeDist) * (0.55 + 0.45 * foamNoise);

      // Sea stack surf ring foam
      float stackDist = length(vWorldPos.xz - uStackPos);
      float stackFoam = smoothstep(3.6, 1.75, stackDist) * (0.5 + 0.5 * foamDetail);

      // Whitecap foam on steep crests
      float crestThreshold = 0.34 + (2.0 - min(uWavePower, 2.0)) * 0.16;
      float crestFoam = smoothstep(crestThreshold, crestThreshold + 0.42, vWaveHeight) * (0.45 + 0.55 * foamDetail);

      // Distance fade so horizon stays clean & serene
      float horizonFade = smoothstep(68.0, 26.0, distFromShore);
      float foamDamp = mix(1.0, 0.52, uClarity);
      float totalFoam = clamp((cliffFoam * 1.15 + stackFoam * 0.95 + crestFoam * 0.85) * horizonFade * foamDamp, 0.0, 1.0);

      diffuseColor.rgb = mix(waterBase, vec3(0.88, 0.94, 0.97), totalFoam);
      `
    );
  };

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.position.y = 0.22;
  oceanMesh.receiveShadow = true;
  group.add(oceanMesh);
  disposables.push(oceanMat);

  // ============================================================
  // 2. SUNLIT WAVE IMPACT SPRAY PLUMES (420 Dynamic Particles)
  // ============================================================
  const sprayCount = 420;
  const sprayPositions = new Float32Array(sprayCount * 3);
  const sprayPool: SprayParticle[] = [];
  for (let i = 0; i < sprayCount; i++) {
    sprayPool.push({
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
    });
    sprayPositions[i * 3 + 1] = -100;
  }

  const sprayGeo = new THREE.BufferGeometry();
  const sprayPosAttr = new THREE.BufferAttribute(sprayPositions, 3);
  sprayGeo.setAttribute('position', sprayPosAttr);

  const sprayMat = new THREE.PointsMaterial({
    map: textures.spraySprite,
    color: new THREE.Color('#eef8ff'),
    size: 0.72,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const sprayPoints = new THREE.Points(sprayGeo, sprayMat);
  sprayPoints.frustumCulled = false;
  group.add(sprayPoints);
  disposables.push(sprayGeo, sprayMat);

  let sprayCursor = 0;
  const spawnSpray = (x: number, y: number, z: number, vx: number, vy: number, vz: number, maxLife: number) => {
    const p = sprayPool[sprayCursor];
    sprayCursor = (sprayCursor + 1) % sprayCount;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = maxLife;
    p.maxLife = maxLife;
  };

  // ============================================================
  // 3. ROCKFALL COLLAPSE DUST CLOUD (220 Billowing Particles)
  // ============================================================
  const dustCount = 220;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustPool: DustParticle[] = [];
  for (let i = 0; i < dustCount; i++) {
    dustPool.push({
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
    });
    dustPositions[i * 3 + 1] = -100;
  }

  const dustGeo = new THREE.BufferGeometry();
  const dustPosAttr = new THREE.BufferAttribute(dustPositions, 3);
  dustGeo.setAttribute('position', dustPosAttr);

  const dustMat = new THREE.PointsMaterial({
    map: textures.spraySprite,
    color: new THREE.Color('#c8b398'),
    size: 1.65,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const dustPoints = new THREE.Points(dustGeo, dustMat);
  dustPoints.frustumCulled = false;
  group.add(dustPoints);
  disposables.push(dustGeo, dustMat);

  let dustCursor = 0;
  const emitRockfallDust = (shoreX: number) => {
    for (let i = 0; i < 160; i++) {
      const p = dustPool[dustCursor];
      dustCursor = (dustCursor + 1) % dustCount;
      p.x = shoreX + (Math.random() - 0.3) * 2.4;
      p.y = 1.6 + Math.random() * 4.4;
      p.z = (Math.random() - 0.5) * 12.0;
      p.vx = 0.6 + Math.random() * 2.4;
      p.vy = 0.8 + Math.random() * 2.6;
      p.vz = (Math.random() - 0.5) * 1.8;
      p.maxLife = 1.6 + Math.random() * 1.8;
      p.life = p.maxLife;
    }
  };

  const emitSplashBurst = (origin: THREE.Vector3, strength = 1.2) => {
    const count = Math.floor(22 * strength);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = (1.2 + Math.random() * 3.4) * strength;
      spawnSpray(
        origin.x + (Math.random() - 0.5) * 0.8,
        Math.max(0.3, origin.y + 0.2),
        origin.z + (Math.random() - 0.5) * 0.8,
        Math.cos(angle) * spd,
        (3.2 + Math.random() * 4.6) * strength,
        Math.sin(angle) * spd,
        0.75 + Math.random() * 0.65
      );
    }
  };

  // ============================================================
  // 4. CORRASION ABRASIVE PEBBLE CHURN (InstancedMesh, 110 stones)
  // ============================================================
  const churnCount = 110;
  const churnGeo = new THREE.DodecahedronGeometry(0.11, 0);
  const churnMat = new THREE.MeshStandardMaterial({
    color: '#9c8f7d',
    roughness: 0.72,
    metalness: 0.05,
  });
  disposables.push(churnGeo, churnMat);
  const churnMesh = new THREE.InstancedMesh(churnGeo, churnMat, churnCount);
  churnMesh.frustumCulled = false;
  group.add(churnMesh);

  const churnDummy = new THREE.Object3D();
  const churnSeeds = Array.from({ length: churnCount }, (_, i) => ({
    z: -8.5 + ((i * 37) % 100) * 0.17,
    phase: (i * 1.618) % (Math.PI * 2),
    radius: 0.55 + ((i * 13) % 10) * 0.14,
    scale: 0.65 + ((i * 23) % 10) * 0.08,
  }));

  // ============================================================
  // 5. SEAWARD UNDERTOW SEDIMENT TRANSPORT STREAM (220 Grains)
  // ============================================================
  // Visualizes eroded sand & gravel drifting across the abrasion bench and settling onto the outer wedge
  const transportCount = 220;
  const transportGeo = new THREE.DodecahedronGeometry(0.11, 0);
  const transportMat = new THREE.MeshStandardMaterial({
    color: '#d8be8f',
    emissive: '#6e5735',
    emissiveIntensity: 0.22,
    roughness: 0.78,
    metalness: 0.04,
  });
  disposables.push(transportGeo, transportMat);
  const transportMesh = new THREE.InstancedMesh(transportGeo, transportMat, transportCount);
  transportMesh.frustumCulled = false;
  group.add(transportMesh);

  const transportSeeds = Array.from({ length: transportCount }, (_, i) => ({
    offset: (i * 0.004545 + ((i * 17) % 100) * 0.0031) % 1.0,
    z: -10.5 + ((i * 53) % 100) * 0.21,
    speed: 0.11 + ((i * 19) % 10) * 0.012,
    hopAmp: 0.18 + ((i * 29) % 10) * 0.04,
    scale: 0.58 + ((i * 13) % 10) * 0.08,
  }));

  // ============================================================
  // PER-FRAME UPDATE (Zero allocations)
  // ============================================================
  const update = (
    dt: number,
    time: number,
    wavePower: number,
    shoreX: number,
    progress: number,
    underwaterClarity: number
  ): { crestImpact: number } => {
    oceanUniforms.uTime.value = time;
    oceanUniforms.uWavePower.value = wavePower;
    oceanUniforms.uShoreX.value = shoreX;
    oceanUniforms.uClarity.value = underwaterClarity;
    oceanMat.opacity = THREE.MathUtils.lerp(0.9, 0.36, underwaterClarity);

    // Calculate live wave crest phase right at the cliff face
    const speed = 1.9 + wavePower * 0.55;
    const shoreWaveSin = Math.sin(shoreX * 0.42 + time * speed);
    const crestImpact = Math.max(0, shoreWaveSin);

    // Emit dramatic vertical wave-impact spray plumes whenever crest slams cliff
    if (crestImpact > 0.42) {
      const intensity = (crestImpact - 0.42) / 0.58;
      const emitCount = Math.floor(intensity * (6 + wavePower * 12));
      for (let e = 0; e < emitCount; e++) {
        const rz = (Math.random() - 0.5) * 17.0;
        const headlandOffset = Math.cos((rz / 12.0) * Math.PI * 0.45) * 1.15 - 0.5;
        const sx = shoreX + headlandOffset + (Math.random() - 0.5) * 0.9;
        spawnSpray(
          sx,
          0.55 + Math.random() * 0.8,
          rz,
          0.9 + Math.random() * (2.2 * wavePower), // blasts upward & bounces slightly seaward
          (2.6 + Math.random() * 4.4) * Math.pow(wavePower, 0.85),
          (Math.random() - 0.5) * 2.2,
          0.65 + Math.random() * 0.7
        );
      }

      // Also emit smaller splash around the offshore sea stack
      if (Math.random() < 0.65) {
        spawnSpray(
          9.6 + (Math.random() - 0.5) * 2.6,
          0.6,
          -4.6 + (Math.random() - 0.5) * 2.6,
          (Math.random() - 0.5) * 2.0,
          (1.8 + Math.random() * 2.6) * wavePower,
          (Math.random() - 0.5) * 2.0,
          0.55 + Math.random() * 0.45
        );
      }
    }

    // Integrate spray particles
    const gravity = -9.8;
    for (let i = 0; i < sprayCount; i++) {
      const p = sprayPool[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy += gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        if (p.y < 0.05 || p.life <= 0) {
          p.life = 0;
          sprayPositions[i * 3 + 1] = -100;
        } else {
          sprayPositions[i * 3] = p.x;
          sprayPositions[i * 3 + 1] = p.y;
          sprayPositions[i * 3 + 2] = p.z;
        }
      }
    }
    sprayPosAttr.needsUpdate = true;

    // Integrate rockfall dust particles
    for (let i = 0; i < dustCount; i++) {
      const d = dustPool[i];
      if (d.life > 0) {
        d.life -= dt;
        d.vy -= 1.2 * dt; // gentle buoyant settling
        d.vx *= Math.max(0, 1 - dt * 0.8);
        d.vz *= Math.max(0, 1 - dt * 0.8);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.z += d.vz * dt;
        if (d.life <= 0 || d.y < -0.5) {
          d.life = 0;
          dustPositions[i * 3 + 1] = -100;
        } else {
          dustPositions[i * 3] = d.x;
          dustPositions[i * 3 + 1] = d.y;
          dustPositions[i * 3 + 2] = d.z;
        }
      }
    }
    dustPosAttr.needsUpdate = true;

    // Animate swirling corrasion pebbles at cliff base (strongest in stages 2–4)
    const churnStrength = (0.35 + wavePower * 0.55) * (progress > 0.1 ? 1.0 : 0.45);
    for (let i = 0; i < churnCount; i++) {
      const s = churnSeeds[i];
      const ang = time * (2.2 + wavePower * 1.2) + s.phase;
      const cx = shoreX + 0.9 + Math.cos(ang) * s.radius * churnStrength;
      const cy = 0.28 + Math.max(0, Math.sin(ang)) * 0.95 * churnStrength;
      const cz = s.z + Math.sin(ang * 0.7) * 0.35;
      churnDummy.position.set(cx, cy, cz);
      churnDummy.rotation.set(ang * 1.4, ang, ang * 0.8);
      churnDummy.scale.setScalar(s.scale);
      churnDummy.updateMatrix();
      churnMesh.setMatrixAt(i, churnDummy.matrix);
    }
    churnMesh.instanceMatrix.needsUpdate = true;

    // Animate seaward sediment transport grains traveling from cliff toe across bench -> outer sediment wedge
    const flowActivity = THREE.MathUtils.smoothstep(progress, 0.06, 0.32);
    const travelSpan = 9.5 + progress * 11.0;
    for (let i = 0; i < transportCount; i++) {
      const s = transportSeeds[i];
      const u = (s.offset + time * s.speed * (0.65 + wavePower * 0.45)) % 1.0;
      const tx = shoreX + 0.6 + u * travelSpan;
      // Follow gentle seaward bench slope and settle down onto depositional wedge
      const baseBedY = -0.18 - u * (1.25 + (1 - progress) * 1.15);
      // Saltation / backwash hopping arc strongest near middle bench, settling gently at outer edge (u -> 1)
      const hop = Math.abs(Math.sin(u * Math.PI * 5.0 + time * 2.5)) * s.hopAmp * (1.0 - u * 0.8) * wavePower;
      const tz = s.z + Math.sin(u * 4.0 + i) * 0.45;
      const grainScale = s.scale * (0.25 + flowActivity * 0.95) * (1.0 - Math.max(0, u - 0.82) * 3.8);

      churnDummy.position.set(tx, baseBedY + hop, tz);
      churnDummy.rotation.set(time * 2.4 + i, time * 1.8, i);
      churnDummy.scale.setScalar(Math.max(0.001, grainScale));
      churnDummy.updateMatrix();
      transportMesh.setMatrixAt(i, churnDummy.matrix);
    }
    transportMesh.instanceMatrix.needsUpdate = true;

    return { crestImpact };
  };

  return {
    group,
    update,
    emitSplashBurst,
    emitRockfallDust,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
