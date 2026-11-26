import * as THREE from 'three';
import type { ProceduralTextureSet } from './textures';

export interface RockfallChunk {
  mesh: THREE.Mesh;
  homePos: THREE.Vector3;
  homeRot: THREE.Euler;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  settledPos: THREE.Vector3;
  settledRot: THREE.Euler;
  radius: number;
  bounced: boolean;
  delay: number;
}

export interface ForceVectorsRig {
  group: THREE.Group;
  waveArrows: THREE.Group[];
  hydraulicArrows: THREE.Group[];
  gravityArrows: THREE.Group[];
  update: (time: number, progress: number, wavePower: number, visible: boolean) => void;
}

export interface CliffSystem {
  group: THREE.Group;
  updateGeometry: (progress: number, collapseTriggered: boolean) => void;
  triggerCollapse: () => void;
  resetCollapse: () => void;
  updatePhysics: (dt: number, progress: number, time: number, onSplash: (pos: THREE.Vector3) => void) => boolean;
  lighthouseBeacon: THREE.Group;
  forceVectors: ForceVectorsRig;
  getActiveShoreX: (progress: number) => number;
  dispose: () => void;
}

function pseudoNoise(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 0.75 + z * 0.55) * 0.45 +
    Math.cos(y * 1.25 - z * 0.85) * 0.35 +
    Math.sin((x + y) * 1.9 + z * 1.3) * 0.2
  );
}

/**
 * Builds the entire coastal geomorphology assembly:
 * - Deformable stratified coastal cliff + abrasion bench cutaway
 * - Dynamic fracture fissure seams along the overhang
 * - 18 rigid-body fractured rockfall boulders that detach & tumble into the surf
 * - Composite 9-part coastal lighthouse watchstation grounded on the cliff top
 * - Composite 5-tier offshore sea stack (кекур)
 * - Instanced coastal pines, shrubs, and intertidal boulders/pebbles
 * - 3D sculpted kinetic, hydraulic & gravitational force vector arrows
 */
export function buildCliffSystem(textures: ProceduralTextureSet): CliffSystem {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Shared calibrated PBR materials (varying roughness >= 0.25 between rock, grass, metal, glass)
  const cliffRockMat = new THREE.MeshStandardMaterial({
    map: textures.strataAlbedo,
    bumpMap: textures.strataBump,
    bumpScale: 0.22,
    roughness: 0.88,
    metalness: 0.04,
  });
  const grassTopMat = new THREE.MeshStandardMaterial({
    map: textures.grassAlbedo,
    roughness: 0.94,
    metalness: 0.0,
  });
  const freshBoulderMat = new THREE.MeshStandardMaterial({
    map: textures.freshRockAlbedo,
    bumpMap: textures.strataBump,
    bumpScale: 0.26,
    roughness: 0.84,
    metalness: 0.05,
  });
  const wetBedrockMat = new THREE.MeshStandardMaterial({
    map: textures.benchBedrockAlbedo,
    bumpMap: textures.strataBump,
    bumpScale: 0.22,
    roughness: 0.38, // Wet gloss sheen on submerged/intertidal abrasion platform
    metalness: 0.08,
  });
  const sedimentTopMat = new THREE.MeshStandardMaterial({
    map: textures.sedimentAlbedo,
    bumpMap: textures.sedimentBump,
    bumpScale: 0.28,
    roughness: 0.86,
    metalness: 0.02,
  });
  const sedimentSideMat = new THREE.MeshStandardMaterial({
    map: textures.sedimentAlbedo,
    color: new THREE.Color('#c9ad7e'),
    bumpMap: textures.sedimentBump,
    bumpScale: 0.18,
    roughness: 0.9,
    metalness: 0.02,
  });
  disposables.push(cliffRockMat, grassTopMat, freshBoulderMat, wetBedrockMat, sedimentTopMat, sedimentSideMat);

  // ============================================================
  // 1. DEFORMABLE STRATIFIED CLIFF BLOCK (High-res Box-like Grid)
  // ============================================================
  // Dimensions: X in [-16, +2.6], Y in [-2.6, +6.4], Z in [-12, +12]
  // High segment resolution along X, Y, Z so the wave-cut notch & retreat curve cleanly!
  const cliffW = 18.6;
  const cliffH = 9.0;
  const cliffD = 24.0;
  const cliffGeo = new THREE.BoxGeometry(cliffW, cliffH, cliffD, 36, 28, 36);
  // Shift so X spans [-16.0, +2.6], Y spans [-2.6, +6.4], Z spans [-12, +12]
  cliffGeo.translate(-6.7, 1.9, 0);

  // Assign material groups: BoxGeometry has 6 groups (0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z)
  // Top face (+Y, index 2) gets coastal grass; all cliff sides get stratified rock.
  const cliffMaterials = [
    cliffRockMat, // +X (seaward cliff face!)
    cliffRockMat, // -X (inland back)
    grassTopMat,  // +Y (grassy cliff top)
    wetBedrockMat,// -Y (bottom)
    cliffRockMat, // +Z (front geological cross-section!)
    cliffRockMat, // -Z (far side)
  ];

  // Store immutable base positions so we can sculpt deterministically at any progress (0..1)
  const posAttr = cliffGeo.attributes.position as THREE.BufferAttribute;
  const basePos = new Float32Array(posAttr.array.length);

  // Pre-sculpt organic coastal headland silhouette & natural rocky ruggedness into basePos
  for (let i = 0; i < posAttr.count; i++) {
    let x = posAttr.getX(i);
    let y = posAttr.getY(i);
    let z = posAttr.getZ(i);

    // Organic headland bulge near Z = 0, gently curving back at Z = ±12
    const zNorm = z / 12.0;
    const headlandCurve = Math.cos(zNorm * Math.PI * 0.45) * 1.4 - 0.6;

    // Slight natural cliff slope + rock strata micro-ledges on seaward side (x > -2)
    if (x > -4.5) {
      const seaWeight = THREE.MathUtils.smoothstep(x, -4.5, 2.6);
      const strataLedge = Math.sin(y * 2.4 + z * 0.25) * 0.14;
      const rugged = pseudoNoise(x * 0.6, y * 0.7, z * 0.45) * 0.28;
      // Slightly steeper near top, tiny natural talus apron at bottom
      const baseSlope = y < 0.2 ? (0.2 - y) * 0.35 : -Math.max(0, y - 3.5) * 0.08;
      x += seaWeight * (headlandCurve + strataLedge + rugged + baseSlope);
    }

    // Gentle rolling coastal hill on top (+Y)
    if (y > 5.8) {
      const topWeight = THREE.MathUtils.smoothstep(y, 5.8, 6.4);
      const inlandRise = THREE.MathUtils.smoothstep(x, 0.5, -14.0) * 1.35;
      const hillWave = Math.sin(z * 0.22 + 0.5) * 0.38 + Math.cos(x * 0.35) * 0.18;
      y += topWeight * (inlandRise + hillWave);
    }

    basePos[i * 3] = x;
    basePos[i * 3 + 1] = y;
    basePos[i * 3 + 2] = z;
  }

  // Adjust UV on side faces so strata layers run cleanly horizontally with elevation Y
  const uvAttr = cliffGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i++) {
    const x = basePos[i * 3];
    const y = basePos[i * 3 + 1];
    const z = basePos[i * 3 + 2];
    // For top face keep planar UVs; for side faces map V directly to world elevation Y
    if (y < 6.05) {
      const vNorm = 1.0 - THREE.MathUtils.clamp((y + 2.6) / 9.2, 0.01, 0.99);
      const uNorm = (x + z) * 0.085;
      uvAttr.setXY(i, uNorm, vNorm);
    }
  }
  uvAttr.needsUpdate = true;

  const cliffMesh = new THREE.Mesh(cliffGeo, cliffMaterials);
  cliffMesh.castShadow = true;
  cliffMesh.receiveShadow = true;
  group.add(cliffMesh);
  disposables.push(cliffGeo);

  // ============================================================
  // 2. DYNAMIC DEFORMABLE UNDERWATER ABRASION BENCH (Бенч)
  // ============================================================
  // Solid geological cutaway block: X in [-8, +28], Y in [-5.2, -0.05], Z in [-12, +12]
  const benchW = 36;
  const benchH = 5.0;
  const benchD = 24;
  const benchGeo = new THREE.BoxGeometry(benchW, benchH, benchD, 52, 4, 24);
  benchGeo.translate(10.0, -2.55, 0); // top surface at Y = -0.05, bottom at Y = -5.05

  const benchPosAttr = benchGeo.attributes.position as THREE.BufferAttribute;
  const benchBasePos = new Float32Array(benchPosAttr.array.length);
  for (let i = 0; i < benchPosAttr.count; i++) {
    benchBasePos[i * 3] = benchPosAttr.getX(i);
    benchBasePos[i * 3 + 1] = benchPosAttr.getY(i);
    benchBasePos[i * 3 + 2] = benchPosAttr.getZ(i);
  }

  const benchMesh = new THREE.Mesh(benchGeo, wetBedrockMat);
  benchMesh.receiveShadow = true;
  group.add(benchMesh);
  disposables.push(benchGeo);

  // Extended deep ocean floor apron beyond the cutaway block (prevents floating edges)
  const deepFloorGeo = new THREE.PlaneGeometry(110, 120, 16, 16);
  deepFloorGeo.rotateX(-Math.PI / 2);
  deepFloorGeo.translate(42, -5.08, 0);
  const deepFloorMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#132433'),
    roughness: 0.94,
    metalness: 0.02,
  });
  const deepFloorMesh = new THREE.Mesh(deepFloorGeo, deepFloorMat);
  group.add(deepFloorMesh);
  disposables.push(deepFloorGeo, deepFloorMat);

  // ============================================================
  // 2B. DYNAMIC UNDERWATER SEDIMENT ACCUMULATION WEDGE (Шөгінді террасасы)
  // ============================================================
  // Prograding marine sand & gravel wedge deposited seaward of the abrasion bench:
  // X spans [5.2, 27.6], Z spans [-11.98, +11.98] (tiny 0.02 inset avoids Z-fighting on cutaway face)
  const sedW = 22.4;
  const sedH = 2.6;
  const sedD = 23.96;
  const sedGeo = new THREE.BoxGeometry(sedW, sedH, sedD, 42, 4, 22);
  sedGeo.translate(16.4, -3.7, 0); // top initially at Y = -2.4, bottom at Y = -5.0

  const sedPosAttr = sedGeo.attributes.position as THREE.BufferAttribute;
  const sedBasePos = new Float32Array(sedPosAttr.array.length);
  for (let i = 0; i < sedPosAttr.count; i++) {
    sedBasePos[i * 3] = sedPosAttr.getX(i);
    sedBasePos[i * 3 + 1] = sedPosAttr.getY(i);
    sedBasePos[i * 3 + 2] = sedPosAttr.getZ(i);
  }

  const sedMaterials = [
    sedimentSideMat,
    sedimentSideMat,
    sedimentTopMat, // +Y rippled marine sand surface
    sedimentSideMat,
    sedimentSideMat, // +Z front geological cross-section cutaway!
    sedimentSideMat,
  ];
  const sedimentMesh = new THREE.Mesh(sedGeo, sedMaterials);
  sedimentMesh.receiveShadow = true;
  group.add(sedimentMesh);
  disposables.push(sedGeo);

  // Helper computing the dynamic underwater bedrock elevation at any (x, z, progress)
  const evalBedrockTopY = (x: number, z: number, p: number): number => {
    const planing = THREE.MathUtils.smoothstep(p, 0.08, 0.92);
    const collapseBoost = p > 0.64 ? THREE.MathUtils.smoothstep(p, 0.64, 0.88) : 0;

    // Initial un-eroded rocky slope: jagged & drops off quickly past X = 2.5
    const roughNoise =
      pseudoNoise(x * 0.62, 0.5, z * 0.52) * 0.42 +
      Math.sin(x * 1.45 + z * 0.4) * 0.16;
    const initialSlopeY =
      x < 2.2
        ? -0.06
        : -0.06 - THREE.MathUtils.smoothstep(x, 2.2, 16.5) * 3.85 + roughNoise * (1 - planing * 0.72);

    // Mature planed wave-cut abrasion bench (gently sloping 2 deg seaward from X=-2.5 to X=11.2)
    const strataStep = Math.sin(x * 2.1 + z * 0.18) * 0.045;
    let benchTargetY = -0.08;
    if (x > 10.8) {
      benchTargetY = -0.78 - THREE.MathUtils.smoothstep(x, 10.8, 22.5) * 3.65;
    } else if (x > -3.0) {
      benchTargetY = -0.08 - ((x + 3.0) / 13.8) * 0.7 + strataStep;
    }

    // Inner bench planes first near cliff base, expanding seaward as abrasion progresses
    const activeBenchWidth = 4.2 + planing * 7.2 + collapseBoost * 1.8;
    const inBenchZone = 1.0 - THREE.MathUtils.smoothstep(x, activeBenchWidth - 2.0, activeBenchWidth + 3.5);
    const blend = Math.min(1, planing * 1.15) * inBenchZone;

    return THREE.MathUtils.lerp(initialSlopeY, benchTargetY, blend);
  };

  // Helper computing the dynamic top elevation of the accumulating underwater sediment wedge
  const evalSedimentTopY = (x: number, z: number, p: number): number => {
    const bedrockY = evalBedrockTopY(x, z, p);
    // Sediment accumulation builds steadily during stages 2-3 and surges after stage 4 cliff collapse!
    const preAccum = THREE.MathUtils.smoothstep(p, 0.1, 0.64) * 0.48;
    const postAccum = p > 0.64 ? THREE.MathUtils.smoothstep(p, 0.64, 0.98) * 0.52 : 0;
    const accumFactor = preAccum + postAccum; // 0 -> 1

    // Bell-shaped depositional terrace apron peaking on the outer bench drop-off (X ∈ [9, 22])
    const peakX = 12.6 + accumFactor * 2.4;
    const spread = 5.4 + accumFactor * 2.6;
    const shoreFeather = THREE.MathUtils.smoothstep(x, 6.2, 10.4);
    const seawardDrop = 1.0 - THREE.MathUtils.smoothstep(x, peakX + spread * 0.55, 27.2);
    const dome = Math.exp(-Math.pow((x - peakX) / spread, 2)) * 0.55 + 0.45 * shoreFeather * seawardDrop;

    // Subtle seafloor sand ripples
    const sandRipples = Math.sin(x * 3.4 + z * 0.35) * 0.045 * accumFactor;
    const thickness = accumFactor * 2.35 * shoreFeather * seawardDrop * dome;

    // Slight base offset so thin edges tuck cleanly underneath bedrock without Z-fighting
    return bedrockY + thickness - 0.08 + sandRipples;
  };

  // Former original cliff-toe contour ribbon etched on the abrasion bench (visible in Stages 4–5)
  const formerLineGeo = new THREE.PlaneGeometry(0.28, 22.8, 1, 24);
  formerLineGeo.rotateX(-Math.PI / 2);
  const flPos = formerLineGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < flPos.count; i++) {
    const vz = flPos.getZ(i);
    const headlandCurve = Math.cos((vz / 12.0) * Math.PI * 0.45) * 1.4 - 0.6;
    flPos.setX(i, flPos.getX(i) + 2.45 + headlandCurve);
  }
  const formerLineMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'),
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const formerLineMesh = new THREE.Mesh(formerLineGeo, formerLineMat);
  formerLineMesh.position.y = -0.32;
  formerLineMesh.visible = false;
  group.add(formerLineMesh);
  disposables.push(formerLineGeo, formerLineMat);

  // Extended distant coastal headland silhouette (natural outdoor perimeter so it never looks like a floating void box)
  const farHeadlandGeo = new THREE.CylinderGeometry(7.5, 13.5, 7.2, 16, 4);
  const fhPos = farHeadlandGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < fhPos.count; i++) {
    const vx = fhPos.getX(i);
    const vy = fhPos.getY(i);
    const vz = fhPos.getZ(i);
    const n = pseudoNoise(vx * 0.35, vy * 0.4, vz * 0.35);
    fhPos.setXYZ(i, vx * (1 + n * 0.25), vy, vz * (1 + n * 0.25));
  }
  farHeadlandGeo.computeVertexNormals();
  const farHeadland = new THREE.Mesh(farHeadlandGeo, cliffRockMat);
  farHeadland.position.set(-14, 1.5, -24);
  farHeadland.scale.set(1.8, 1.0, 1.5);
  group.add(farHeadland);
  disposables.push(farHeadlandGeo);

  // ============================================================
  // 3. VISIBLE STRESS FRACTURE FISSURES ON OVERHANG (Stages 3–4)
  // ============================================================
  const crackGroup = new THREE.Group();
  const crackMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#120e0b'),
    roughness: 0.96,
    metalness: 0.0,
  });
  disposables.push(crackMat);

  const crackGeos: THREE.BufferGeometry[] = [];
  for (let c = 0; c < 4; c++) {
    const shape = new THREE.Shape();
    shape.moveTo(-0.08, 0);
    shape.lineTo(0.08, 0);
    shape.lineTo(0.14, 1.6);
    shape.lineTo(0.04, 3.2);
    shape.lineTo(0.18, 4.4);
    shape.lineTo(-0.12, 4.4);
    shape.lineTo(-0.04, 2.8);
    shape.lineTo(-0.14, 1.2);
    shape.closePath();

    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: 4.5 + (c % 2) * 2.0,
      bevelEnabled: false,
    });
    crackGeos.push(extrude);
    disposables.push(extrude);

    const crackMesh = new THREE.Mesh(extrude, crackMat);
    crackMesh.position.set(-1.15 - (c % 2) * 0.35, 2.2, -5.8 + c * 3.1);
    crackMesh.rotation.z = -0.06 + (c % 2) * 0.04;
    crackGroup.add(crackMesh);
  }
  crackGroup.visible = false;
  group.add(crackGroup);

  // ============================================================
  // 4. DETACHING OVERHANG ROCKFALL CHUNKS (18 Rigid-Body Boulders)
  // ============================================================
  const rockfallGroup = new THREE.Group();
  const rockfallChunks: RockfallChunk[] = [];
  const chunkCount = 18;

  for (let i = 0; i < chunkCount; i++) {
    const col = i % 6; // along Z
    const row = Math.floor(i / 6); // vertical stack inside the overhang
    const radius = 0.62 + ((i * 37) % 10) * 0.055;

    const geo = new THREE.DodecahedronGeometry(radius, 1);
    const gPos = geo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < gPos.count; v++) {
      const vx = gPos.getX(v);
      const vy = gPos.getY(v);
      const vz = gPos.getZ(v);
      const scaleX = 1.15 + pseudoNoise(vx * 2.1 + i, vy * 2.0, vz * 2.1) * 0.32;
      const scaleY = 0.88 + pseudoNoise(vx * 1.8, vy * 2.4 + i, vz * 1.7) * 0.28;
      const scaleZ = 1.1 + pseudoNoise(vx * 1.5, vy * 1.6, vz * 2.2 + i) * 0.32;
      gPos.setXYZ(v, vx * scaleX, vy * scaleY, vz * scaleZ);
    }
    geo.computeVertexNormals();
    disposables.push(geo);

    const mesh = new THREE.Mesh(geo, i % 3 === 0 ? cliffRockMat : freshBoulderMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const zCoord = -5.6 + col * 2.2 + ((i % 3) - 1) * 0.35;
    const headlandX = Math.cos((zCoord / 12.0) * Math.PI * 0.45) * 1.4 - 0.6;
    const homeX = 1.15 + headlandX * 0.75 + (row === 1 ? 0.35 : -0.15);
    const homeY = 2.6 + row * 1.45 + ((i * 17) % 5) * 0.08;

    const homePos = new THREE.Vector3(homeX, homeY, zCoord);
    const homeRot = new THREE.Euler((i * 0.5) % 3, (i * 1.1) % 3, (i * 0.7) % 3);

    // Deterministic settled landing zone on the abrasion bench
    const settledX = homeX + 1.8 + ((i * 23) % 10) * 0.28 + row * 0.55;
    const settledY = -0.15 + radius * 0.52 + (row === 2 ? 0.25 : 0);
    const settledZ = zCoord + (((i * 19) % 10) - 5) * 0.22;

    const chunk: RockfallChunk = {
      mesh,
      homePos,
      homeRot,
      pos: homePos.clone(),
      vel: new THREE.Vector3(),
      rotVel: new THREE.Vector3(),
      settledPos: new THREE.Vector3(settledX, settledY, settledZ),
      settledRot: new THREE.Euler(homeRot.x + 2.4, homeRot.y + 1.7, homeRot.z - 2.1),
      radius,
      bounced: false,
      delay: row * 0.08 + ((i * 13) % 7) * 0.035,
    };

    mesh.position.copy(homePos);
    mesh.rotation.copy(homeRot);
    mesh.visible = false;
    rockfallGroup.add(mesh);
    rockfallChunks.push(chunk);
  }
  group.add(rockfallGroup);

  // ============================================================
  // 5. COMPOSITE 9-PART COASTAL LIGHTHOUSE (Маяк) ON CLIFF TOP
  // ============================================================
  const lighthouseGroup = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7a7872'),
    bumpMap: textures.strataBump,
    bumpScale: 0.14,
    roughness: 0.9,
    metalness: 0.05,
  });
  const towerMat = new THREE.MeshStandardMaterial({
    map: textures.lighthouseStripe,
    roughness: 0.62,
    metalness: 0.05,
  });
  const ironMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#1f2933'),
    roughness: 0.34,
    metalness: 0.82,
  });
  const copperRoofMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#3b6e68'),
    roughness: 0.38,
    metalness: 0.72,
  });
  const lanternGlassMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#fff1c7'),
    emissive: new THREE.Color('#ffba52'),
    emissiveIntensity: 1.4,
    roughness: 0.12,
    metalness: 0.05,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffe09e'),
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(stoneMat, towerMat, ironMat, copperRoofMat, lanternGlassMat, beamMat);

  // Part 1: Octagonal stone foundation plinth (grounded firmly into cliff top)
  const plinthGeo = new THREE.CylinderGeometry(1.38, 1.62, 1.0, 8);
  const plinth = new THREE.Mesh(plinthGeo, stoneMat);
  plinth.position.y = 0.25;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  lighthouseGroup.add(plinth);

  // Part 2: Tapered striped main lighthouse tower
  const towerGeo = new THREE.CylinderGeometry(0.76, 1.18, 4.4, 20);
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.y = 2.9;
  tower.castShadow = true;
  tower.receiveShadow = true;
  lighthouseGroup.add(tower);

  // Part 3: Stone entrance portico box
  const doorHouseGeo = new THREE.BoxGeometry(0.95, 1.25, 0.85);
  const doorHouse = new THREE.Mesh(doorHouseGeo, stoneMat);
  doorHouse.position.set(-1.05, 1.35, 0);
  doorHouse.castShadow = true;
  lighthouseGroup.add(doorHouse);

  // Part 4: Cornice & gallery deck platform
  const galleryGeo = new THREE.CylinderGeometry(1.12, 0.82, 0.34, 20);
  const gallery = new THREE.Mesh(galleryGeo, ironMat);
  gallery.position.y = 5.22;
  gallery.castShadow = true;
  lighthouseGroup.add(gallery);

  // Part 5: Gallery safety rail ring
  const railRingGeo = new THREE.TorusGeometry(1.06, 0.035, 8, 24);
  railRingGeo.rotateX(Math.PI / 2);
  const railRing = new THREE.Mesh(railRingGeo, ironMat);
  railRing.position.y = 5.72;
  lighthouseGroup.add(railRing);

  // Part 6: Gallery stanchions (8 posts)
  const postGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6);
  for (let p = 0; p < 8; p++) {
    const angle = (p / 8) * Math.PI * 2;
    const post = new THREE.Mesh(postGeo, ironMat);
    post.position.set(Math.cos(angle) * 1.05, 5.52, Math.sin(angle) * 1.05);
    lighthouseGroup.add(post);
  }

  // Part 7: Glowing lantern glass room
  const lanternGeo = new THREE.CylinderGeometry(0.66, 0.66, 0.92, 14);
  const lantern = new THREE.Mesh(lanternGeo, lanternGlassMat);
  lantern.position.y = 5.85;
  lighthouseGroup.add(lantern);

  // Part 8: Patinated copper dome cap + lightning finial spire
  const domeGeo = new THREE.SphereGeometry(0.72, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const dome = new THREE.Mesh(domeGeo, copperRoofMat);
  dome.position.y = 6.28;
  dome.castShadow = true;
  lighthouseGroup.add(dome);

  const spireGeo = new THREE.ConeGeometry(0.06, 0.65, 8);
  const spire = new THREE.Mesh(spireGeo, ironMat);
  spire.position.y = 7.25;
  lighthouseGroup.add(spire);

  // Part 9: Rotating dual volumetric light beams
  const lighthouseBeacon = new THREE.Group();
  lighthouseBeacon.position.y = 5.88;
  const beamGeo = new THREE.ConeGeometry(1.65, 11.5, 16, 1, true);
  beamGeo.translate(0, -5.75, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamA = new THREE.Mesh(beamGeo, beamMat);
  const beamB = new THREE.Mesh(beamGeo, beamMat);
  beamB.rotation.y = Math.PI;
  lighthouseBeacon.add(beamA, beamB);
  lighthouseGroup.add(lighthouseBeacon);

  // Place lighthouse dramatically near the cliff edge (shows real threat of coastal retreat!)
  lighthouseGroup.position.set(-5.8, 6.72, -3.4);
  group.add(lighthouseGroup);
  disposables.push(plinthGeo, towerGeo, doorHouseGeo, galleryGeo, railRingGeo, postGeo, lanternGeo, domeGeo, spireGeo, beamGeo);

  // ============================================================
  // 6. COMPOSITE 5-PART OFFSHORE SEA STACK (Кекур)
  // ============================================================
  const seaStackGroup = new THREE.Group();
  const stackTiers = [
    { rTop: 1.55, rBot: 2.25, h: 1.8, y: 0.4, mat: wetBedrockMat },
    { rTop: 1.22, rBot: 1.52, h: 1.35, y: 1.85, mat: cliffRockMat }, // wave-cut waist!
    { rTop: 1.58, rBot: 1.24, h: 1.55, y: 3.15, mat: cliffRockMat }, // slight overhang cap
    { rTop: 0.95, rBot: 1.48, h: 1.1, y: 4.35, mat: freshBoulderMat },
    { rTop: 0.72, rBot: 0.92, h: 0.32, y: 4.95, mat: grassTopMat }, // grassy summit tuft
  ];
  stackTiers.forEach((tier, idx) => {
    const tGeo = new THREE.CylinderGeometry(tier.rTop, tier.rBot, tier.h, 11, 3);
    const tp = tGeo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < tp.count; v++) {
      const vx = tp.getX(v);
      const vy = tp.getY(v);
      const vz = tp.getZ(v);
      const n = pseudoNoise(vx * 1.4 + idx, vy * 1.6, vz * 1.4);
      tp.setXYZ(v, vx * (1 + n * 0.24), vy, vz * (1 + n * 0.24));
    }
    tGeo.computeVertexNormals();
    const mesh = new THREE.Mesh(tGeo, tier.mat);
    mesh.position.y = tier.y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    seaStackGroup.add(mesh);
    disposables.push(tGeo);
  });
  seaStackGroup.position.set(9.6, -0.5, -4.6);
  group.add(seaStackGroup);

  // ============================================================
  // 7. INSTANCED COASTAL PINES & FORESHORE PEBBLES/BOULDERS
  // ============================================================
  // Wind-swept coastal pine trees (trunk + layered foliage cones via InstancedMesh)
  const treeCount = 22;
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.14, 1.35, 6);
  trunkGeo.translate(0, 0.675, 0);
  const foliageGeo = new THREE.ConeGeometry(0.68, 1.95, 7);
  foliageGeo.translate(0, 1.95, 0);

  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4d3a2c', roughness: 0.92 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: '#3b5c42', roughness: 0.88 });
  disposables.push(trunkGeo, foliageGeo, trunkMat, foliageMat);

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
  trunkInst.castShadow = true;
  foliageInst.castShadow = true;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < treeCount; i++) {
    const tx = -7.2 - ((i * 19) % 75) * 0.105;
    const tz = -10.2 + ((i * 29) % 100) * 0.204;
    // Skip right on top of lighthouse plinth
    if (Math.hypot(tx + 5.8, tz + 3.4) < 2.6) {
      dummy.position.set(-13.5, 7.6, tz);
    } else {
      const inlandRise = THREE.MathUtils.smoothstep(tx, 0.5, -14.0) * 1.35;
      const hillWave = Math.sin(tz * 0.22 + 0.5) * 0.38 + Math.cos(tx * 0.35) * 0.18;
      dummy.position.set(tx, 6.32 + inlandRise + hillWave, tz);
    }
    const sc = 0.85 + ((i * 13) % 10) * 0.032; // ±15% scale variation
    dummy.scale.set(sc, sc * 1.05, sc);
    // Slight wind lean away from the sea (-X)
    dummy.rotation.set(((i % 5) - 2) * 0.04, i * 1.1, 0.11);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);
    foliageInst.setMatrixAt(i, dummy.matrix);

    tint.setHSL(0.35 + ((i % 7) - 3) * 0.015, 0.28, 0.28 + ((i % 5) - 2) * 0.025);
    foliageInst.setColorAt(i, tint);
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  foliageInst.instanceMatrix.needsUpdate = true;
  if (foliageInst.instanceColor) foliageInst.instanceColor.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  foliageInst.computeBoundingSphere();
  group.add(trunkInst, foliageInst);

  // Intertidal & underwater sorted cobbles / sediment pebbles (InstancedMesh, 115 rocks)
  // Dynamically migrate seaward across the abrasion bench & accumulate on the sediment wedge!
  const pebbleCount = 115;
  const pebbleGeo = new THREE.DodecahedronGeometry(0.32, 0);
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: '#8f8472',
    roughness: 0.56,
    metalness: 0.05,
  });
  disposables.push(pebbleGeo, pebbleMat);
  const pebbleInst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
  pebbleInst.receiveShadow = true;
  pebbleInst.frustumCulled = false;

  const pebbleSeeds = Array.from({ length: pebbleCount }, (_, i) => ({
    u: ((i * 31) % 100) / 100, // 0 = near cliff toe, 1 = outer sediment wedge
    z: -10.8 + ((i * 43) % 100) * 0.216,
    baseScale: 0.42 + ((i * 17) % 10) * 0.11,
    rx: i * 0.6,
    ry: i * 1.2,
    rz: i * 0.4,
    shade: 0.52 + ((i * 11) % 10) * 0.04,
  }));

  for (let i = 0; i < pebbleCount; i++) {
    const s = pebbleSeeds[i];
    tint.setRGB(s.shade * 1.12, s.shade * 1.03, s.shade * 0.88);
    pebbleInst.setColorAt(i, tint);
  }
  if (pebbleInst.instanceColor) pebbleInst.instanceColor.needsUpdate = true;
  group.add(pebbleInst);

  const updateSortedCobbles = (p: number) => {
    const accum = THREE.MathUtils.smoothstep(p, 0.06, 0.96);
    for (let i = 0; i < pebbleCount; i++) {
      const s = pebbleSeeds[i];
      // As abrasion progresses, cobbles fan out from cliff base onto the outer sediment wedge
      const spreadX = 2.4 + s.u * (6.2 + accum * 12.2);
      const px = spreadX - (p > 0.64 ? (1 - s.u) * 2.2 : 0);
      const bedY = evalBedrockTopY(px, s.z, p);
      const sedY = evalSedimentTopY(px, s.z, p);
      const surfaceY = Math.max(bedY, sedY);

      // Natural grain-size sorting: coarser angular cobbles near shore, finer rounded gravel seaward
      const sortingScale = (1.15 - s.u * 0.58) * s.baseScale;
      // Newly eroded outer cobbles emerge progressively as sediment accumulates
      const visibilityScale = s.u < 0.25 + accum * 0.85 ? 1.0 : 0.001;
      const finalScale = sortingScale * visibilityScale;

      dummy.position.set(px, surfaceY + finalScale * 0.14, s.z);
      dummy.scale.set(finalScale * 1.25, finalScale * 0.58, finalScale);
      dummy.rotation.set(s.rx, s.ry, s.rz);
      dummy.updateMatrix();
      pebbleInst.setMatrixAt(i, dummy.matrix);
    }
    pebbleInst.instanceMatrix.needsUpdate = true;
  };

  // ============================================================
  // 8. 3D SCULPTED ACTION FORCE VECTORS (Wave, Hydraulic, Gravity)
  // ============================================================
  const forceVectors = buildForceVectors(disposables);
  group.add(forceVectors.group);

  // ============================================================
  // DYNAMIC SCULPTING & COLLAPSE PHYSICS LOGIC
  // ============================================================
  let lastSculptedProgress = -1;
  let lastSculptedCollapsed = false;
  let collapseActive = false;
  let collapseElapsed = 0;
  let hasCollapsedOnce = false;

  const getActiveShoreX = (progress: number): number => {
    const clamped = THREE.MathUtils.clamp(progress, 0, 1);
    if (clamped < 0.64) {
      // Notch carves inward slowly
      return 2.6 - clamped * 2.2;
    }
    const post = (clamped - 0.64) / 0.36;
    return 1.2 - post * 3.1;
  };

  const updateGeometry = (progress: number, collapseTriggered: boolean) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // Avoid redundant vertex uploads if progress barely changed
    if (Math.abs(p - lastSculptedProgress) < 0.002 && collapseTriggered === lastSculptedCollapsed) {
      return;
    }
    lastSculptedProgress = p;
    lastSculptedCollapsed = collapseTriggered;

    // 1. Wave-cut notch depth peaks around progress = 0.62 right before collapse
    const preCollapseFactor = THREE.MathUtils.smoothstep(p, 0.06, 0.62);
    const postCollapseRetreat = p > 0.64 ? THREE.MathUtils.smoothstep(p, 0.64, 0.94) : 0;
    const isCollapsed = p >= 0.64 || collapseTriggered;

    // Notch depth: up to 4.5 units deep at sea level before collapse; slight secondary notch reforms in stage 5
    const notchDepth = isCollapsed
      ? 1.15 + postCollapseRetreat * 1.15
      : preCollapseFactor * 4.55;

    // Cliff face inland retreat after overhang shears off at p = 0.64
    const cliffRetreat = isCollapsed ? 3.55 + postCollapseRetreat * 1.05 : preCollapseFactor * 0.22;

    for (let i = 0; i < posAttr.count; i++) {
      let x = basePos[i * 3];
      let y = basePos[i * 3 + 1];
      const z = basePos[i * 3 + 2];

      // Only carve vertices near the seaward cliff face (x > -4.8)
      if (x > -4.8) {
        const seaInfluence = THREE.MathUtils.smoothstep(x, -4.8, 1.2);
        // Stronger erosion on the central headland (|z| < 8)
        const headlandFocus = 0.65 + 0.35 * Math.cos(THREE.MathUtils.clamp(z / 11.0, -1, 1) * Math.PI * 0.5);

        // Wave-cut notch profile centered at Y = 0.95 (sea level splash zone)
        const notchBell = Math.exp(-Math.pow((y - 0.95) / 1.35, 2));

        // Vertical retreat profile: above Y = -0.2 retreats inland when collapsed,
        // leaving the lower bedrock below Y = -0.25 intact as the abrasion bench!
        const aboveBench = THREE.MathUtils.smoothstep(y, -0.35, 0.45);

        const totalCarve =
          seaInfluence *
          headlandFocus *
          (notchBell * notchDepth + aboveBench * cliffRetreat);

        x -= totalCarve;

        // Slight gravitational sag of overhanging lip right before collapse (p ∈ [0.46, 0.64])
        if (!isCollapsed && p > 0.44 && y > 2.2 && x > -1.2) {
          const overhangSag =
            THREE.MathUtils.smoothstep(p, 0.44, 0.63) *
            THREE.MathUtils.smoothstep(x, -1.2, 2.2) *
            0.34;
          y -= overhangSag;
        }
      }

      posAttr.setXYZ(i, x, y, z);
    }

    posAttr.needsUpdate = true;
    cliffGeo.computeVertexNormals();

    // Show dark stress fractures on the overhang in Stage 3 (0.36..0.64)
    const crackRatio = !isCollapsed ? THREE.MathUtils.smoothstep(p, 0.34, 0.62) : 0;
    crackGroup.visible = crackRatio > 0.02;
    if (crackGroup.visible) {
      crackGroup.scale.set(0.4 + crackRatio * 1.4, 0.5 + crackRatio * 0.6, 1.0);
    }

    // 2. Dynamically sculpt the underwater abrasion bench bedrock cutaway
    for (let i = 0; i < benchPosAttr.count; i++) {
      const bx = benchBasePos[i * 3];
      const by = benchBasePos[i * 3 + 1];
      const bz = benchBasePos[i * 3 + 2];
      // Preserve solid bottom floor at Y = -5.05, deform upper layers smoothly to dynamic bedrock surface
      const tY = THREE.MathUtils.clamp((by + 5.05) / 5.0, 0, 1);
      const topY = evalBedrockTopY(bx, bz, p);
      benchPosAttr.setXYZ(i, bx, THREE.MathUtils.lerp(-5.05, topY, tY), bz);
    }
    benchPosAttr.needsUpdate = true;
    benchGeo.computeVertexNormals();

    // 3. Dynamically grow & prograde the underwater depositional sediment wedge
    for (let i = 0; i < sedPosAttr.count; i++) {
      const sx = sedBasePos[i * 3];
      const sy = sedBasePos[i * 3 + 1];
      const sz = sedBasePos[i * 3 + 2];
      const tY = THREE.MathUtils.clamp((sy + 5.0) / 2.6, 0, 1);
      const bedFloor = evalBedrockTopY(sx, sz, p) - 0.14;
      const sedTop = evalSedimentTopY(sx, sz, p);
      sedPosAttr.setXYZ(i, sx, THREE.MathUtils.lerp(bedFloor, sedTop, tY), sz);
    }
    sedPosAttr.needsUpdate = true;
    sedGeo.computeVertexNormals();

    // 4. Update dynamically sorted foreshore cobbles & former shoreline indicator
    updateSortedCobbles(p);
    formerLineMesh.visible = p >= 0.65;
    if (formerLineMesh.visible) {
      formerLineMesh.position.y = evalBedrockTopY(2.6, 0, p) + 0.06;
    }
  };

  const triggerCollapse = () => {
    collapseActive = true;
    collapseElapsed = 0;
    hasCollapsedOnce = true;

    for (let i = 0; i < rockfallChunks.length; i++) {
      const c = rockfallChunks[i];
      c.pos.copy(c.homePos);
      c.mesh.position.copy(c.homePos);
      c.mesh.rotation.copy(c.homeRot);
      c.mesh.visible = true;
      c.bounced = false;
      // Dramatic outward shear impulse toward the sea (+X) + slight downward break
      c.vel.set(
        1.8 + ((i * 17) % 10) * 0.24,
        -0.5 + ((i * 7) % 5) * 0.22,
        (((i * 19) % 10) - 5) * 0.26
      );
      c.rotVel.set(
        (((i * 13) % 10) - 5) * 0.7,
        (((i * 29) % 10) - 5) * 0.5,
        -2.2 - ((i * 11) % 8) * 0.35
      );
    }
  };

  const resetCollapse = () => {
    collapseActive = false;
    collapseElapsed = 0;
    hasCollapsedOnce = false;
    for (let i = 0; i < rockfallChunks.length; i++) {
      const c = rockfallChunks[i];
      c.mesh.visible = false;
      c.pos.copy(c.homePos);
    }
  };

  const updatePhysics = (
    dt: number,
    progress: number,
    time: number,
    onSplash: (pos: THREE.Vector3) => void
  ): boolean => {
    // Rotate lighthouse beacon continuously
    lighthouseBeacon.rotation.y = time * 0.75;

    // If user scrubs back before collapse threshold, hide fallen boulders cleanly
    if (progress < 0.635) {
      if (hasCollapsedOnce || collapseActive) {
        resetCollapse();
      }
      return false;
    }

    // Auto-trigger dramatic physics fall when crossing 0.64 threshold!
    if (!hasCollapsedOnce && progress >= 0.64) {
      triggerCollapse();
      return true; // signal caller for sound + camera shake + dust burst!
    }

    // Active rigid-body rockfall simulation
    if (collapseActive) {
      collapseElapsed += dt;
      let anyMoving = false;
      const gravity = -16.8;

      for (let i = 0; i < rockfallChunks.length; i++) {
        const c = rockfallChunks[i];
        c.mesh.visible = true;

        if (collapseElapsed < c.delay) {
          // Subtle pre-break tremor right before detaching
          c.mesh.position.set(
            c.homePos.x + Math.sin(time * 55 + i) * 0.04,
            c.homePos.y,
            c.homePos.z
          );
          anyMoving = true;
          continue;
        }

        const floorY = -0.18 + c.radius * 0.5;
        if (c.pos.y > floorY || c.vel.y > 0.1 || Math.abs(c.vel.x) > 0.15) {
          anyMoving = true;
          c.vel.y += gravity * dt;
          c.pos.addScaledVector(c.vel, dt);

          c.mesh.rotation.x += c.rotVel.x * dt;
          c.mesh.rotation.y += c.rotVel.y * dt;
          c.mesh.rotation.z += c.rotVel.z * dt;

          // Impact with the water / abrasion bench!
          if (c.pos.y <= floorY) {
            c.pos.y = floorY;
            if (!c.bounced) {
              c.bounced = true;
              onSplash(c.pos);
              c.vel.y = Math.abs(c.vel.y) * 0.24;
              c.vel.x *= 0.45;
              c.vel.z *= 0.45;
              c.rotVel.multiplyScalar(0.35);
            } else {
              c.vel.y = 0;
              c.vel.x *= Math.max(0, 1 - dt * 5.0);
              c.vel.z *= Math.max(0, 1 - dt * 5.0);
              c.rotVel.multiplyScalar(Math.max(0, 1 - dt * 6.0));
            }
          }
          c.mesh.position.copy(c.pos);
        }
      }

      if (!anyMoving && collapseElapsed > 3.2) {
        collapseActive = false;
      }
    } else if (progress >= 0.64) {
      // Settled state — boulders gradually wear down & disperse slightly as stage 5 progresses
      const wearFactor = THREE.MathUtils.smoothstep(progress, 0.78, 1.0);
      for (let i = 0; i < rockfallChunks.length; i++) {
        const c = rockfallChunks[i];
        c.mesh.visible = true;
        const scale = 1.0 - wearFactor * 0.42;
        c.mesh.scale.setScalar(scale);
        c.mesh.position.y = Math.max(-0.35, c.pos.y - wearFactor * 0.12);
      }
    }

    return false;
  };

  // Initialize starting geometry
  updateGeometry(0.05, false);

  return {
    group,
    updateGeometry,
    triggerCollapse,
    resetCollapse,
    updatePhysics,
    lighthouseBeacon,
    forceVectors,
    getActiveShoreX,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/**
 * Builds sculpted 3D kinetic arrows illustrating:
 * 1. Incoming wave impact force (cyan)
 * 2. Hydraulic air-compression / corrasion force inside notch (amber)
 * 3. Gravitational pull on undercut overhanging rock block (coral red)
 */
function buildForceVectors(disposables: Array<{ dispose: () => void }>): ForceVectorsRig {
  const group = new THREE.Group();

  const shaftGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.45, 10);
  shaftGeo.rotateZ(Math.PI / 2);
  const headGeo = new THREE.ConeGeometry(0.24, 0.56, 12);
  headGeo.rotateZ(Math.PI / 2);
  disposables.push(shaftGeo, headGeo);

  const waveMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#0284c7',
    emissiveIntensity: 0.7,
    roughness: 0.25,
    metalness: 0.2,
    transparent: true,
    opacity: 0.9,
  });
  const hydraulicMat = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    emissive: '#d97706',
    emissiveIntensity: 0.75,
    roughness: 0.25,
    metalness: 0.2,
    transparent: true,
    opacity: 0.92,
  });
  const gravityMat = new THREE.MeshStandardMaterial({
    color: '#ef4444',
    emissive: '#b91c1c',
    emissiveIntensity: 0.75,
    roughness: 0.28,
    metalness: 0.15,
    transparent: true,
    opacity: 0.92,
  });
  disposables.push(waveMat, hydraulicMat, gravityMat);

  const createArrow = (mat: THREE.Material) => {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.x = 0.72;
    const head = new THREE.Mesh(headGeo, mat);
    head.position.x = -0.25;
    g.add(shaft, head);
    return g;
  };

  // 4 incoming wave kinetic arrows pointing toward -X (cliff face)
  const waveArrows: THREE.Group[] = [];
  for (let i = 0; i < 4; i++) {
    const arrow = createArrow(waveMat);
    arrow.position.set(5.4, 1.3, -4.5 + i * 3.0);
    group.add(arrow);
    waveArrows.push(arrow);
  }

  // 3 hydraulic notch pressure arrows pushing deep & upward into the notch
  const hydraulicArrows: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const arrow = createArrow(hydraulicMat);
    arrow.position.set(2.2, 1.35, -3.2 + i * 3.2);
    arrow.rotation.z = -0.25;
    group.add(arrow);
    hydraulicArrows.push(arrow);
  }

  // 3 downward gravitational shear arrows above the overhanging lip (pointing -Y)
  const gravityArrows: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const arrow = createArrow(gravityMat);
    arrow.rotation.z = Math.PI / 2; // point straight down
    arrow.position.set(0.8, 7.6, -3.0 + i * 3.0);
    group.add(arrow);
    gravityArrows.push(arrow);
  }

  const update = (time: number, progress: number, wavePower: number, visible: boolean) => {
    group.visible = visible;
    if (!visible) return;

    const surge = Math.sin(time * (1.8 + wavePower * 0.55));
    const baseShore = progress < 0.64 ? 2.8 - progress * 2.2 : 1.0 - (progress - 0.64) * 3.5;

    // Animate wave impact vectors surging forward with waves
    for (let i = 0; i < waveArrows.length; i++) {
      const a = waveArrows[i];
      a.position.x = baseShore + 3.2 - surge * 1.15;
      a.position.y = 1.25 + Math.max(0, surge) * 0.55 * wavePower;
      const s = 0.75 + wavePower * 0.25;
      a.scale.set(s, s, s);
    }

    // Show hydraulic arrows strongly during active notch carving (Stages 2–3)
    const showHydraulic = progress >= 0.15 && progress < 0.65;
    for (let i = 0; i < hydraulicArrows.length; i++) {
      const a = hydraulicArrows[i];
      a.visible = showHydraulic;
      if (showHydraulic) {
        const pulse = (Math.sin(time * 3.2 + i * 0.7) * 0.5 + 0.5);
        a.position.x = baseShore + 0.8 - pulse * 1.2;
        a.scale.setScalar(0.75 + pulse * 0.3);
      }
    }

    // Show gravity arrows during overhang stress & collapse (Stages 3–4)
    const showGravity = progress >= 0.42 && progress < 0.78;
    for (let i = 0; i < gravityArrows.length; i++) {
      const a = gravityArrows[i];
      a.visible = showGravity;
      if (showGravity) {
        const bob = Math.sin(time * 4.0 + i * 0.9) * 0.35;
        a.position.x = 0.6 - Math.max(0, progress - 0.64) * 2.5;
        a.position.y = 7.4 + bob;
      }
    }
  };

  return { group, waveArrows, hydraulicArrows, gravityArrows, update };
}
