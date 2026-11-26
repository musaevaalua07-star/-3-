import * as THREE from 'three';

function hash2D(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy);
  const b = hash2D(ix + 1, iy);
  const c = hash2D(ix, iy + 1);
  const d = hash2D(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

export interface ProceduralTextureSet {
  strataAlbedo: THREE.CanvasTexture;
  strataBump: THREE.CanvasTexture;
  freshRockAlbedo: THREE.CanvasTexture;
  grassAlbedo: THREE.CanvasTexture;
  benchBedrockAlbedo: THREE.CanvasTexture;
  sedimentAlbedo: THREE.CanvasTexture;
  sedimentBump: THREE.CanvasTexture;
  lighthouseStripe: THREE.CanvasTexture;
  spraySprite: THREE.CanvasTexture;
  skyDome: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Stratified sedimentary cliff rock texture (albedo + bump)
  const rockSize = 512;
  const rockCanvas = document.createElement('canvas');
  rockCanvas.width = rockSize;
  rockCanvas.height = rockSize;
  const rCtx = rockCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = rockSize;
  bumpCanvas.height = rockSize;
  const bCtx = bumpCanvas.getContext('2d')!;

  const rImg = rCtx.createImageData(rockSize, rockSize);
  const bImg = bCtx.createImageData(rockSize, rockSize);

  for (let y = 0; y < rockSize; y++) {
    const v = y / rockSize; // 0 = top of cliff, 1 = submerged base
    for (let x = 0; x < rockSize; x++) {
      const u = x / rockSize;
      const warp = fbm(u * 4.5, v * 3.0, 3) * 0.08;
      const sv = Math.min(1, Math.max(0, v + warp));

      // Horizontal geological strata bands
      const fineBands = Math.sin(sv * 68 + fbm(u * 9, sv * 16, 2) * 3.5) * 0.5 + 0.5;
      const grain = fbm(u * 26, v * 26, 4);
      const crackNoise = Math.abs(fbm(u * 14 + 3.1, v * 6, 3) - 0.5);
      const fissure = crackNoise < 0.025 ? (0.025 - crackNoise) / 0.025 : 0;

      let r = 138;
      let g = 114;
      let b = 88;

      if (sv < 0.08) {
        // Top soil / turf transition
        r = 78;
        g = 86;
        b = 58;
      } else if (sv < 0.36) {
        // Upper ochre sandstone
        r = 166 + fineBands * 26;
        g = 136 + fineBands * 20;
        b = 98 + fineBands * 14;
      } else if (sv < 0.58) {
        // Middle pale limestone band
        r = 152 + fineBands * 22;
        g = 142 + fineBands * 20;
        b = 122 + fineBands * 16;
      } else if (sv < 0.80) {
        // Softer dark marl/clay wave-notch zone (more easily eroded!)
        r = 108 + fineBands * 18;
        g = 94 + fineBands * 14;
        b = 80 + fineBands * 12;
      } else {
        // Wet dark intertidal basaltic/bedrock base
        r = 58 + fineBands * 14;
        g = 62 + fineBands * 14;
        b = 64 + fineBands * 14;
      }

      // Wet darkening near bottom
      const wetness = Math.max(0, Math.min(1, (sv - 0.68) / 0.25));
      const shade = (0.78 + grain * 0.42) * (1 - fissure * 0.52) * (1 - wetness * 0.32);

      const idx = (y * rockSize + x) * 4;
      rImg.data[idx] = Math.min(255, Math.max(0, r * shade));
      rImg.data[idx + 1] = Math.min(255, Math.max(0, g * shade));
      rImg.data[idx + 2] = Math.min(255, Math.max(0, b * shade));
      rImg.data[idx + 3] = 255;

      const bumpVal = Math.min(
        255,
        Math.max(0, (fineBands * 0.42 + grain * 0.58 - fissure * 0.65) * 255)
      );
      bImg.data[idx] = bumpVal;
      bImg.data[idx + 1] = bumpVal;
      bImg.data[idx + 2] = bumpVal;
      bImg.data[idx + 3] = 255;
    }
  }
  rCtx.putImageData(rImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  const strataAlbedo = new THREE.CanvasTexture(rockCanvas);
  strataAlbedo.colorSpace = THREE.SRGBColorSpace;
  strataAlbedo.wrapS = THREE.RepeatWrapping;
  strataAlbedo.wrapT = THREE.ClampToEdgeWrapping;
  strataAlbedo.anisotropy = maxAnisotropy;

  const strataBump = new THREE.CanvasTexture(bumpCanvas);
  strataBump.wrapS = THREE.RepeatWrapping;
  strataBump.wrapT = THREE.ClampToEdgeWrapping;
  strataBump.anisotropy = maxAnisotropy;

  // 2. Fresh fractured boulder rock albedo
  const freshCanvas = document.createElement('canvas');
  freshCanvas.width = 256;
  freshCanvas.height = 256;
  const fCtx = freshCanvas.getContext('2d')!;
  const fImg = fCtx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256;
      const v = y / 256;
      const n = fbm(u * 14, v * 14, 4);
      const band = Math.sin(v * 24 + n * 4) * 0.5 + 0.5;
      const idx = (y * 256 + x) * 4;
      fImg.data[idx] = Math.min(255, (148 + band * 34) * (0.76 + n * 0.4));
      fImg.data[idx + 1] = Math.min(255, (128 + band * 26) * (0.76 + n * 0.4));
      fImg.data[idx + 2] = Math.min(255, (104 + band * 20) * (0.76 + n * 0.4));
      fImg.data[idx + 3] = 255;
    }
  }
  fCtx.putImageData(fImg, 0, 0);
  const freshRockAlbedo = new THREE.CanvasTexture(freshCanvas);
  freshRockAlbedo.colorSpace = THREE.SRGBColorSpace;
  freshRockAlbedo.wrapS = THREE.RepeatWrapping;
  freshRockAlbedo.wrapT = THREE.RepeatWrapping;
  freshRockAlbedo.anisotropy = maxAnisotropy;

  // 3. Coastal steppe grass & headland top albedo
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = 256;
  grassCanvas.height = 256;
  const gCtx = grassCanvas.getContext('2d')!;
  const gImg = gCtx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const u = x / 256;
      const v = y / 256;
      const patch = fbm(u * 7, v * 7, 4);
      const blades = fbm(u * 38, v * 38, 2);
      const dryMix = Math.max(0, Math.min(1, (patch - 0.35) * 1.9));
      const r = (68 + dryMix * 56) * (0.8 + blades * 0.35);
      const g = (98 + dryMix * 26) * (0.8 + blades * 0.35);
      const b = (52 + dryMix * 16) * (0.8 + blades * 0.35);
      const idx = (y * 256 + x) * 4;
      gImg.data[idx] = Math.min(255, r);
      gImg.data[idx + 1] = Math.min(255, g);
      gImg.data[idx + 2] = Math.min(255, b);
      gImg.data[idx + 3] = 255;
    }
  }
  gCtx.putImageData(gImg, 0, 0);
  const grassAlbedo = new THREE.CanvasTexture(grassCanvas);
  grassAlbedo.colorSpace = THREE.SRGBColorSpace;
  grassAlbedo.wrapS = THREE.RepeatWrapping;
  grassAlbedo.wrapT = THREE.RepeatWrapping;
  grassAlbedo.repeat.set(3, 3);
  grassAlbedo.anisotropy = maxAnisotropy;

  // 4. Lighthouse maritime stripe texture
  const lhCanvas = document.createElement('canvas');
  lhCanvas.width = 256;
  lhCanvas.height = 256;
  const lCtx = lhCanvas.getContext('2d')!;
  lCtx.fillStyle = '#e7e2d8';
  lCtx.fillRect(0, 0, 256, 256);
  lCtx.fillStyle = '#b83c2e';
  lCtx.fillRect(0, 42, 256, 56);
  lCtx.fillRect(0, 152, 256, 56);
  // Subtle weathering grain
  lCtx.fillStyle = 'rgba(20, 25, 32, 0.08)';
  for (let i = 0; i < 420; i++) {
    const px = hash2D(i, 1.3) * 256;
    const py = hash2D(i, 4.7) * 256;
    lCtx.fillRect(px, py, 2 + hash2D(i, 9.1) * 5, 1 + hash2D(i, 2.9) * 3);
  }
  const lighthouseStripe = new THREE.CanvasTexture(lhCanvas);
  lighthouseStripe.colorSpace = THREE.SRGBColorSpace;
  lighthouseStripe.wrapS = THREE.RepeatWrapping;
  lighthouseStripe.wrapT = THREE.ClampToEdgeWrapping;
  lighthouseStripe.anisotropy = maxAnisotropy;

  // 5. Soft radial spray & dust particle sprite
  const spCanvas = document.createElement('canvas');
  spCanvas.width = 64;
  spCanvas.height = 64;
  const sCtx = spCanvas.getContext('2d')!;
  const grad = sCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.38, 'rgba(240, 249, 255, 0.72)');
  grad.addColorStop(0.72, 'rgba(200, 232, 248, 0.25)');
  grad.addColorStop(1, 'rgba(200, 232, 248, 0.0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 64, 64);
  const spraySprite = new THREE.CanvasTexture(spCanvas);
  spraySprite.colorSpace = THREE.SRGBColorSpace;

  // 6. Atmospheric coastal sky dome gradient
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 512;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d')!;
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0.0, '#102438');
  skyGrad.addColorStop(0.32, '#1f4260');
  skyGrad.addColorStop(0.50, '#5a7e96');
  skyGrad.addColorStop(0.56, '#c6baa8');
  skyGrad.addColorStop(0.62, '#92a5b4');
  skyGrad.addColorStop(1.0, '#0a1826');
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 512, 256);

  // Subtle warm sun halo near horizon
  const sunGrad = skyCtx.createRadialGradient(355, 128, 4, 355, 128, 95);
  sunGrad.addColorStop(0, 'rgba(255, 238, 200, 0.72)');
  sunGrad.addColorStop(0.35, 'rgba(245, 200, 145, 0.28)');
  sunGrad.addColorStop(1, 'rgba(245, 200, 145, 0.0)');
  skyCtx.fillStyle = sunGrad;
  skyCtx.fillRect(0, 0, 512, 256);

  // Wispy coastal cloud bands
  skyCtx.fillStyle = 'rgba(235, 242, 248, 0.08)';
  for (let i = 0; i < 18; i++) {
    const cx = hash2D(i, 7.2) * 512;
    const cy = 62 + hash2D(i, 3.4) * 54;
    const cw = 55 + hash2D(i, 5.1) * 90;
    const ch = 6 + hash2D(i, 8.9) * 10;
    skyCtx.beginPath();
    skyCtx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
    skyCtx.fill();
  }

  const skyDome = new THREE.CanvasTexture(skyCanvas);
  skyDome.colorSpace = THREE.SRGBColorSpace;
  skyDome.mapping = THREE.EquirectangularReflectionMapping;

  // 7. Planed underwater wave-cut bedrock texture (abrasion grooves & exposed strata ribs)
  const benchCanvas = document.createElement('canvas');
  benchCanvas.width = 512;
  benchCanvas.height = 512;
  const bnCtx = benchCanvas.getContext('2d')!;
  const bnImg = bnCtx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) {
    const v = y / 512;
    for (let x = 0; x < 512; x++) {
      const u = x / 512;
      // Wave-scoured parallel abrasion grooves running seaward (along U) + exposed bedrock strata bands
      const strataRib = Math.sin(u * 42 + fbm(u * 5, v * 5, 3) * 3.0) * 0.5 + 0.5;
      const scourGroove = Math.sin(v * 95 + fbm(u * 12, v * 8, 2) * 2.2) * 0.5 + 0.5;
      const grit = fbm(u * 28, v * 28, 3);
      const idx = (y * 512 + x) * 4;
      const tone = 0.72 + strataRib * 0.24 + scourGroove * 0.1 + grit * 0.18;
      bnImg.data[idx] = Math.min(255, 62 * tone);
      bnImg.data[idx + 1] = Math.min(255, 76 * tone);
      bnImg.data[idx + 2] = Math.min(255, 84 * tone);
      bnImg.data[idx + 3] = 255;
    }
  }
  bnCtx.putImageData(bnImg, 0, 0);
  const benchBedrockAlbedo = new THREE.CanvasTexture(benchCanvas);
  benchBedrockAlbedo.colorSpace = THREE.SRGBColorSpace;
  benchBedrockAlbedo.wrapS = THREE.RepeatWrapping;
  benchBedrockAlbedo.wrapT = THREE.RepeatWrapping;
  benchBedrockAlbedo.repeat.set(3, 2);
  benchBedrockAlbedo.anisotropy = maxAnisotropy;

  // 8. Underwater accumulated marine sediment (rippled golden sand, silt & sorted gravel)
  const sedCanvas = document.createElement('canvas');
  sedCanvas.width = 512;
  sedCanvas.height = 512;
  const sdCtx = sedCanvas.getContext('2d')!;
  const sdImg = sdCtx.createImageData(512, 512);

  const sedBumpCanvas = document.createElement('canvas');
  sedBumpCanvas.width = 512;
  sedBumpCanvas.height = 512;
  const sdbCtx = sedBumpCanvas.getContext('2d')!;
  const sdbImg = sdbCtx.createImageData(512, 512);

  for (let y = 0; y < 512; y++) {
    const v = y / 512;
    for (let x = 0; x < 512; x++) {
      const u = x / 512;
      // Wave-formed sand ripples parallel to coastline (varying along U)
      const ripple = Math.sin(u * 58 + fbm(u * 6, v * 8, 2) * 3.8) * 0.5 + 0.5;
      // Depositional cross-bedding bands along V
      const grain = fbm(u * 34, v * 34, 4);
      const pebbleSpeck = hash2D(Math.floor(u * 140), Math.floor(v * 140)) > 0.94 ? -28 : 0;
      const idx = (y * 512 + x) * 4;
      const light = 0.78 + ripple * 0.22 + grain * 0.18;
      sdImg.data[idx] = Math.min(255, Math.max(0, 186 * light + pebbleSpeck));
      sdImg.data[idx + 1] = Math.min(255, Math.max(0, 162 * light + pebbleSpeck));
      sdImg.data[idx + 2] = Math.min(255, Math.max(0, 118 * light + pebbleSpeck * 0.8));
      sdImg.data[idx + 3] = 255;

      const bVal = Math.min(255, Math.max(0, (ripple * 0.65 + grain * 0.35) * 255));
      sdbImg.data[idx] = bVal;
      sdbImg.data[idx + 1] = bVal;
      sdbImg.data[idx + 2] = bVal;
      sdbImg.data[idx + 3] = 255;
    }
  }
  sdCtx.putImageData(sdImg, 0, 0);
  sdbCtx.putImageData(sdbImg, 0, 0);

  const sedimentAlbedo = new THREE.CanvasTexture(sedCanvas);
  sedimentAlbedo.colorSpace = THREE.SRGBColorSpace;
  sedimentAlbedo.wrapS = THREE.RepeatWrapping;
  sedimentAlbedo.wrapT = THREE.RepeatWrapping;
  sedimentAlbedo.repeat.set(3, 2);
  sedimentAlbedo.anisotropy = maxAnisotropy;

  const sedimentBump = new THREE.CanvasTexture(sedBumpCanvas);
  sedimentBump.wrapS = THREE.RepeatWrapping;
  sedimentBump.wrapT = THREE.RepeatWrapping;
  sedimentBump.repeat.set(3, 2);
  sedimentBump.anisotropy = maxAnisotropy;

  return {
    strataAlbedo,
    strataBump,
    freshRockAlbedo,
    grassAlbedo,
    benchBedrockAlbedo,
    sedimentAlbedo,
    sedimentBump,
    lighthouseStripe,
    spraySprite,
    skyDome,
    dispose: () => {
      strataAlbedo.dispose();
      strataBump.dispose();
      freshRockAlbedo.dispose();
      grassAlbedo.dispose();
      benchBedrockAlbedo.dispose();
      sedimentAlbedo.dispose();
      sedimentBump.dispose();
      lighthouseStripe.dispose();
      spraySprite.dispose();
      skyDome.dispose();
    },
  };
}
