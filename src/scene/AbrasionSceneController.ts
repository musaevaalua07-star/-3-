import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CALLOUT_DEFINITIONS,
  CAMERA_PRESETS,
  PRESENTATION_STAGES,
  type CameraPresetId,
} from '../data/presentationData';
import { CoastalAudioEngine } from './audioEngine';
import { buildCliffSystem, type CliffSystem } from './cliffBuilder';
import { buildOceanAndParticles, type OceanParticleSystem } from './oceanAndParticles';
import { createProceduralTextures, type ProceduralTextureSet } from './textures';

export interface SceneControlState {
  stageIndex: number;
  progress: number;
  wavePower: number;
  isPlaying: boolean;
  followTrajectory: boolean;
  showCallouts: boolean;
  showForceVectors: boolean;
  audioEnabled: boolean;
  underwaterView: boolean;
}

export interface CalloutScreenPosition {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface SceneCallbacks {
  onPlaybackSync: (stageIndex: number, progress: number, wavePower: number) => void;
  onCalloutsFrame: (positions: CalloutScreenPosition[]) => void;
  onContextLost: (lost: boolean) => void;
}

// Reusable module-scope math helpers (zero GC inside animation loop)
const _projVec = new THREE.Vector3();
const _curvePos = new THREE.Vector3();
const _curveTarget = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class AbrasionSceneController {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private textures: ProceduralTextureSet;
  private cliffSystem: CliffSystem;
  private oceanSystem: OceanParticleSystem;
  private audio: CoastalAudioEngine;
  private envRenderTarget: THREE.WebGLRenderTarget;
  private isSoftwareGl: boolean;
  private callbacks: SceneCallbacks;

  private state: SceneControlState;
  private frameId = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private elapsedTime = 0;

  // Smooth camera preset / trajectory choreography
  private desiredCamPos = new THREE.Vector3(16.8, 9.2, 16.2);
  private desiredTarget = new THREE.Vector3(0.4, 2.2, -0.2);
  private cameraTransitionActive = false;
  private userOverrideCamera = false;
  private stageCurves: THREE.CatmullRomCurve3[] = [];
  private stageTimer = 0;
  private narrationBusy = false;
  private underwaterClarity = 0;
  private underwaterLight: THREE.PointLight;

  // Subtle camera impact shake on cliff collapse
  private shakeIntensity = 0;
  private lastSlamTime = -10;
  private lastUiSyncTime = 0;
  private calloutBuffer: CalloutScreenPosition[];

  private resizeObserver: ResizeObserver;
  private handleContextLost: (e: Event) => void;
  private handleContextRestored: () => void;

  constructor(
    container: HTMLElement,
    initialState: SceneControlState,
    callbacks: SceneCallbacks
  ) {
    this.container = container;
    this.state = { ...initialState };
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();
    this.audio = new CoastalAudioEngine();
    this.calloutBuffer = CALLOUT_DEFINITIONS.map((def) => ({
      id: def.id,
      x: 0,
      y: 0,
      visible: false,
    }));

    // 1. Pre-build CatmullRomCurve3 3D camera trajectory splines for every presentation stage
    this.stageCurves = PRESENTATION_STAGES.map(
      (st) =>
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(...st.trajectory.startPos),
          new THREE.Vector3(...st.trajectory.midPos),
          new THREE.Vector3(...st.trajectory.endPos),
        ])
    );

    // 2. Renderer setup with software-WebGL protection
    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // 3. Scene, procedural sky dome, atmosphere fog & RoomEnvironment PBR reflections
    this.scene = new THREE.Scene();
    const horizonColor = new THREE.Color('#8ea2b3');
    this.scene.fog = new THREE.FogExp2(horizonColor.getHex(), 0.0115);

    const maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAnisotropy);
    this.scene.background = this.textures.skyDome;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    pmrem.dispose();

    // 4. Camera & OrbitControls
    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.25, 240);
    this.camera.position.set(...CAMERA_PRESETS.overview.position);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.065;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minPolarAngle = 0.16;
    this.controls.minDistance = 5.5;
    this.controls.maxDistance = 42.0;
    this.controls.target.set(...CAMERA_PRESETS.overview.target);
    this.controls.update();

    // Cancel scripted transitions immediately if user grabs the camera
    this.controls.addEventListener('start', () => {
      this.cameraTransitionActive = false;
      this.userOverrideCamera = true;
    });

    // 5. Three-Point Warm/Cool Coastal Studio Lighting Rig (1 shadow caster)
    const hemiLight = new THREE.HemisphereLight('#a8cde8', '#3c4038', 0.92);
    hemiLight.position.set(0, 40, 0);
    this.scene.add(hemiLight);

    const sunKey = new THREE.DirectionalLight('#ffebd1', 2.45);
    sunKey.position.set(22, 24, 16);
    sunKey.castShadow = !this.isSoftwareGl;
    sunKey.shadow.mapSize.width = 2048;
    sunKey.shadow.mapSize.height = 2048;
    sunKey.shadow.camera.near = 4;
    sunKey.shadow.camera.far = 75;
    const d = 19;
    sunKey.shadow.camera.left = -d;
    sunKey.shadow.camera.right = d;
    sunKey.shadow.camera.top = d;
    sunKey.shadow.camera.bottom = -d;
    sunKey.shadow.bias = -0.0005;
    sunKey.shadow.normalBias = 0.025;
    this.scene.add(sunKey);

    const rimLight = new THREE.DirectionalLight('#7cc4e8', 0.82);
    rimLight.position.set(-18, 12, -16);
    this.scene.add(rimLight);

    // Subtle seafloor fill light that boosts underwater bench & sediment readability in Underwater View
    this.underwaterLight = new THREE.PointLight('#7ce0f0', 0.0, 42, 1.4);
    this.underwaterLight.position.set(10, 1.6, 10);
    this.scene.add(this.underwaterLight);

    // 6. Build 3D Geomorphology Cliff & Dynamic Ocean/Particles
    this.cliffSystem = buildCliffSystem(this.textures);
    this.scene.add(this.cliffSystem.group);

    this.oceanSystem = buildOceanAndParticles(this.textures, this.isSoftwareGl);
    this.scene.add(this.oceanSystem.group);

    // Pre-warm shaders on hardware GPU
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // 7. WebGL Context Loss & Resize Handlers
    this.handleContextLost = (e: Event) => {
      e.preventDefault();
      this.callbacks.onContextLost(true);
    };
    this.handleContextRestored = () => {
      this.callbacks.onContextLost(false);
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost, false);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // Start paced render loop
    this.clock.start();
    this.tick();
  }

  public updateState(partial: Partial<SceneControlState>): void {
    const prevStage = this.state.stageIndex;
    const prevAudio = this.state.audioEnabled;
    const prevPlaying = this.state.isPlaying;

    this.state = { ...this.state, ...partial };

    if (partial.audioEnabled !== undefined && partial.audioEnabled !== prevAudio) {
      this.audio.setEnabled(partial.audioEnabled);
    }

    if (partial.stageIndex !== undefined && partial.stageIndex !== prevStage) {
      this.stageTimer = 0;
      this.userOverrideCamera = false;
      if (!this.state.followTrajectory) {
        const presetId = PRESENTATION_STAGES[partial.stageIndex]?.cameraPreset ?? 'overview';
        this.flyToPreset(presetId);
      }
    }

    if (partial.isPlaying && !prevPlaying) {
      this.userOverrideCamera = false;
    }
  }

  public flyToPreset(presetId: CameraPresetId): void {
    const preset = CAMERA_PRESETS[presetId];
    if (!preset) return;
    this.desiredCamPos.set(...preset.position);
    this.desiredTarget.set(...preset.target);
    this.cameraTransitionActive = true;
    this.userOverrideCamera = false;
  }

  public triggerCollapseReplay(): void {
    this.state.progress = Math.max(this.state.progress, 0.72);
    this.cliffSystem.updateGeometry(this.state.progress, true);
    this.cliffSystem.triggerCollapse();
    const shoreX = this.cliffSystem.getActiveShoreX(this.state.progress);
    this.oceanSystem.emitRockfallDust(shoreX);
    this.audio.triggerRockfall();
    this.shakeIntensity = 0.55;
    this.flyToPreset('collapseCloseup');
  }

  public setNarrationBusy(busy: boolean): void {
    this.narrationBusy = busy;
    this.audio.setDucking(busy);
  }

  private handleResize(): void {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const status = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (status === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    const dt = Math.min(rawDelta, 0.08); // clamp for tab switches or software WebGL
    this.elapsedTime += dt;

    // 1. Auto-Play Action-Motion Presentation Progression
    if (this.state.isPlaying) {
      const currentStage = PRESENTATION_STAGES[this.state.stageIndex];
      const nextStageIdx = (this.state.stageIndex + 1) % PRESENTATION_STAGES.length;
      const prevProgress =
        this.state.stageIndex === 0
          ? 0.02
          : PRESENTATION_STAGES[this.state.stageIndex - 1].targetProgress;
      const targetProgress = currentStage.targetProgress;

      this.stageTimer += dt;
      const stageFrac = THREE.MathUtils.clamp(this.stageTimer / currentStage.durationSec, 0, 1);

      // Smoothly interpolate geological progress across stage duration
      const easedFrac = stageFrac * stageFrac * (3 - 2 * stageFrac);
      this.state.progress = THREE.MathUtils.lerp(prevProgress, targetProgress, easedFrac);
      this.state.wavePower = THREE.MathUtils.damp(
        this.state.wavePower,
        currentStage.recommendedWavePower,
        1.8,
        dt
      );

      // Glide along the stage's curated 3D spline trajectory if user hasn't dragged away
      if (this.state.followTrajectory && !this.userOverrideCamera) {
        const curve = this.stageCurves[this.state.stageIndex];
        curve.getPoint(easedFrac, _curvePos);
        _curveTarget.set(
          THREE.MathUtils.lerp(currentStage.trajectory.lookAtStart[0], currentStage.trajectory.lookAtEnd[0], easedFrac),
          THREE.MathUtils.lerp(currentStage.trajectory.lookAtStart[1], currentStage.trajectory.lookAtEnd[1], easedFrac),
          THREE.MathUtils.lerp(currentStage.trajectory.lookAtStart[2], currentStage.trajectory.lookAtEnd[2], easedFrac)
        );
        this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _curvePos.x, 3.2, dt);
        this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _curvePos.y, 3.2, dt);
        this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _curvePos.z, 3.2, dt);
        this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, _curveTarget.x, 3.6, dt);
        this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, _curveTarget.y, 3.6, dt);
        this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, _curveTarget.z, 3.6, dt);
      }

      // Advance to next chapter seamlessly when duration completes (wait if narrator is still speaking)
      if (this.stageTimer >= currentStage.durationSec && !this.narrationBusy) {
        this.stageTimer = 0;
        this.state.stageIndex = nextStageIdx;
        if (nextStageIdx === 0) {
          this.state.progress = 0.02;
          this.cliffSystem.resetCollapse();
        }
        this.callbacks.onPlaybackSync(this.state.stageIndex, this.state.progress, this.state.wavePower);
      } else if (this.elapsedTime - this.lastUiSyncTime > 0.14) {
        this.lastUiSyncTime = this.elapsedTime;
        this.callbacks.onPlaybackSync(this.state.stageIndex, this.state.progress, this.state.wavePower);
      }
    }

    // 2. Smooth Damped Camera Preset Transition (outside auto-play trajectory)
    if (this.cameraTransitionActive && !this.userOverrideCamera) {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.desiredCamPos.x, 4.2, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.desiredCamPos.y, 4.2, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.desiredCamPos.z, 4.2, dt);
      this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, this.desiredTarget.x, 4.6, dt);
      this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, this.desiredTarget.y, 4.6, dt);
      this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, this.desiredTarget.z, 4.6, dt);

      if (
        this.camera.position.distanceTo(this.desiredCamPos) < 0.08 &&
        this.controls.target.distanceTo(this.desiredTarget) < 0.08
      ) {
        this.cameraTransitionActive = false;
      }
    }

    // 3. Apply subtle damped impact camera shake during rockfall collapse
    if (this.shakeIntensity > 0.004) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity * 0.45;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity * 0.45;
      this.shakeIntensity = THREE.MathUtils.damp(this.shakeIntensity, 0, 3.8, dt);
    }

    // 4. Update Geomorphology, Rockfall Physics, Force Vectors, Ocean & Particles
    this.cliffSystem.updateGeometry(this.state.progress, false);
    const shoreX = this.cliffSystem.getActiveShoreX(this.state.progress);

    const collapseJustTriggered = this.cliffSystem.updatePhysics(
      dt,
      this.state.progress,
      this.elapsedTime,
      (splashPos) => {
        this.oceanSystem.emitSplashBurst(splashPos, 1.35);
      }
    );

    if (collapseJustTriggered) {
      this.oceanSystem.emitRockfallDust(shoreX);
      this.audio.triggerRockfall();
      this.shakeIntensity = 0.55;
    }

    this.cliffSystem.forceVectors.update(
      this.elapsedTime,
      this.state.progress,
      this.state.wavePower,
      this.state.showForceVectors
    );

    const targetClarity = this.state.underwaterView ? 1.0 : 0.0;
    this.underwaterClarity = THREE.MathUtils.damp(this.underwaterClarity, targetClarity, 4.5, dt);
    this.underwaterLight.intensity = this.underwaterClarity * 6.5;

    const { crestImpact } = this.oceanSystem.update(
      dt,
      this.elapsedTime,
      this.state.wavePower,
      shoreX,
      this.state.progress,
      this.underwaterClarity
    );

    // Audio synchronization with ocean wave cycle
    this.audio.updateSurf(crestImpact, this.state.wavePower);
    if (crestImpact > 0.92 && this.elapsedTime - this.lastSlamTime > 2.1) {
      this.lastSlamTime = this.elapsedTime;
      this.audio.triggerWaveSlam(this.state.wavePower * 0.52);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // 5. Project 3D geological callouts directly into screen coordinates
    if (this.state.showCallouts) {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      for (let i = 0; i < CALLOUT_DEFINITIONS.length; i++) {
        const def = CALLOUT_DEFINITIONS[i];
        const out = this.calloutBuffer[i];
        const inStageRange =
          this.state.progress >= def.minProgress && this.state.progress <= def.maxProgress;
        if (!inStageRange) {
          out.visible = false;
          continue;
        }
        const [ax, ay, az] = def.getAnchor(this.state.progress);
        _projVec.set(ax, ay, az).project(this.camera);
        const inFront = _projVec.z < 1.0 && _projVec.z > -1.0;
        const sx = (_projVec.x * 0.5 + 0.5) * w;
        const sy = (-_projVec.y * 0.5 + 0.5) * h;
        const inViewport = sx > 60 && sx < w - 60 && sy > 75 && sy < h - 135;
        out.x = sx;
        out.y = sy;
        out.visible = inFront && inViewport;
      }
      this.callbacks.onCalloutsFrame(this.calloutBuffer);
    }

    // 6. Software-WebGL safe scheduling
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.controls.dispose();
    this.cliffSystem.dispose();
    this.oceanSystem.dispose();
    this.textures.dispose();
    this.envRenderTarget.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
