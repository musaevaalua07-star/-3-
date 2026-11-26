import { useCallback, useEffect, useRef, useState } from 'react';
import { OverlayHUD } from './components/OverlayHUD';
import { ScenarioModal } from './components/ScenarioModal';
import { PRESENTATION_STAGES, type CameraPresetId } from './data/presentationData';
import {
  AbrasionSceneController,
  type CalloutScreenPosition,
} from './scene/AbrasionSceneController';
import {
  KazakhNarrationEngine,
  type NarrationStatus,
  type NarratorVoice,
} from './scene/narrationEngine';

function stageIndexFromProgress(progress: number): number {
  if (progress < 0.16) return 0;
  if (progress < 0.41) return 1;
  if (progress < 0.64) return 2;
  if (progress < 0.85) return 3;
  return 4;
}

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<AbrasionSceneController | null>(null);
  const narrationRef = useRef<KazakhNarrationEngine | null>(null);
  const calloutDomRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [stageIndex, setStageIndex] = useState(0);
  const [progress, setProgress] = useState(0.05);
  const [wavePower, setWavePower] = useState(1.1);
  const [isPlaying, setIsPlaying] = useState(true);
  const [followTrajectory, setFollowTrajectory] = useState(true);
  const [activePreset, setActivePreset] = useState<CameraPresetId>('overview');
  const [showCallouts, setShowCallouts] = useState(true);
  const [showForceVectors, setShowForceVectors] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [underwaterView, setUnderwaterView] = useState(true);

  // Kazakh Voiceover (TTS) state
  const [narrationEnabled, setNarrationEnabled] = useState(false);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus>('idle');
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [narratorVoice, setNarratorVoice] = useState<NarratorVoice>('Charon');

  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [storyCollapsed, setStoryCollapsed] = useState(false);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  // Initialize Kazakh Narration Engine once
  useEffect(() => {
    const engine = new KazakhNarrationEngine({
      onStatusChange: (status, errMsg) => {
        setNarrationStatus(status);
        setNarrationError(errMsg ?? null);
        const busy = status === 'loading' || status === 'speaking';
        controllerRef.current?.setNarrationBusy(busy);
      },
      onStageFinished: () => {
        controllerRef.current?.setNarrationBusy(false);
      },
    });
    narrationRef.current = engine;
    return () => {
      engine.dispose();
      narrationRef.current = null;
    };
  }, []);

  // Mount Three.js scene controller once in isolated ref container
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const handleCalloutsFrame = (positions: CalloutScreenPosition[]) => {
      const map = calloutDomRefs.current;
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const el = map[p.id];
        if (!el) continue;
        if (p.visible) {
          el.style.opacity = '1';
          el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        } else {
          el.style.opacity = '0';
        }
      }
    };

    const controller = new AbrasionSceneController(
      container,
      {
        stageIndex: 0,
        progress: 0.05,
        wavePower: 1.1,
        isPlaying: true,
        followTrajectory: true,
        showCallouts: true,
        showForceVectors: true,
        audioEnabled: false,
        underwaterView: true,
      },
      {
        onPlaybackSync: (nextStage, nextProgress, nextWavePower) => {
          setStageIndex(nextStage);
          setProgress(nextProgress);
          setWavePower(nextWavePower);
          setActivePreset(PRESENTATION_STAGES[nextStage]?.cameraPreset ?? 'overview');
        },
        onCalloutsFrame: handleCalloutsFrame,
        onContextLost: (lost) => setContextLost(lost),
      }
    );

    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  // Push UI state changes into the scene controller without tearing down WebGL
  useEffect(() => {
    controllerRef.current?.updateState({
      stageIndex,
      progress,
      wavePower,
      isPlaying,
      followTrajectory,
      showCallouts,
      showForceVectors,
      audioEnabled,
      underwaterView,
    });
  }, [
    stageIndex,
    progress,
    wavePower,
    isPlaying,
    followTrajectory,
    showCallouts,
    showForceVectors,
    audioEnabled,
    underwaterView,
  ]);

  // Synchronize Kazakh voiceover whenever stageIndex, narrationEnabled, or narratorVoice changes
  useEffect(() => {
    const engine = narrationRef.current;
    if (!engine) return;

    engine.setVoice(narratorVoice);

    if (!narrationEnabled) {
      engine.stop();
      controllerRef.current?.setNarrationBusy(false);
      return;
    }

    const activeStage = PRESENTATION_STAGES[stageIndex];
    if (!activeStage) return;

    void engine.speakStage(activeStage.id, activeStage.narrationText);

    // Pre-fetch the next stage's Kazakh voiceover for seamless transitions
    const nextStage = PRESENTATION_STAGES[(stageIndex + 1) % PRESENTATION_STAGES.length];
    if (nextStage) {
      engine.prefetch(nextStage.id, nextStage.narrationText);
    }
  }, [stageIndex, narrationEnabled, narratorVoice]);

  const handleSelectStage = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(PRESENTATION_STAGES.length - 1, idx));
    const st = PRESENTATION_STAGES[clamped];
    setIsPlaying(false);
    setStageIndex(clamped);
    setProgress(st.targetProgress);
    setWavePower(st.recommendedWavePower);
    setActivePreset(st.cameraPreset);
    controllerRef.current?.flyToPreset(st.cameraPreset);
  }, []);

  const handleSpeakStage = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(PRESENTATION_STAGES.length - 1, idx));
    const st = PRESENTATION_STAGES[clamped];
    setIsPlaying(false);
    setStageIndex(clamped);
    setProgress(st.targetProgress);
    setWavePower(st.recommendedWavePower);
    setActivePreset(st.cameraPreset);
    setNarrationEnabled(true);
    controllerRef.current?.flyToPreset(st.cameraPreset);
    // If already on the same stage and narration was already on, replay explicitly
    if (clamped === stageIndex && narrationEnabled) {
      void narrationRef.current?.speakStage(st.id, st.narrationText);
    }
  }, [stageIndex, narrationEnabled]);

  const handleReplayNarration = useCallback(() => {
    const activeStage = PRESENTATION_STAGES[stageIndex];
    if (!activeStage) return;
    setNarrationEnabled(true);
    void narrationRef.current?.speakStage(activeStage.id, activeStage.narrationText);
  }, [stageIndex]);

  const handlePrevStage = useCallback(() => {
    handleSelectStage((stageIndex - 1 + PRESENTATION_STAGES.length) % PRESENTATION_STAGES.length);
  }, [stageIndex, handleSelectStage]);

  const handleNextStage = useCallback(() => {
    handleSelectStage((stageIndex + 1) % PRESENTATION_STAGES.length);
  }, [stageIndex, handleSelectStage]);

  const handleProgressChange = useCallback((val: number) => {
    setIsPlaying(false);
    setProgress(val);
    setStageIndex(stageIndexFromProgress(val));
  }, []);

  const handleSelectPreset = useCallback((presetId: CameraPresetId) => {
    setActivePreset(presetId);
    if (presetId === 'underwaterBench' || presetId === 'crossSection') {
      setUnderwaterView(true);
    }
    controllerRef.current?.flyToPreset(presetId);
  }, []);

  const handleTriggerCollapse = useCallback(() => {
    setIsPlaying(false);
    setStageIndex(3);
    setProgress(0.74);
    setWavePower(1.85);
    setActivePreset('collapseCloseup');
    controllerRef.current?.triggerCollapseReplay();
    if (narrationEnabled) {
      const collapseStage = PRESENTATION_STAGES[3];
      void narrationRef.current?.speakStage(collapseStage.id, collapseStage.narrationText);
    }
  }, [narrationEnabled]);

  const handleToggleNarration = useCallback(() => {
    setNarrationEnabled((prev) => {
      const next = !prev;
      if (next && !audioEnabled) {
        // Gently bring in ambient ocean surf bed along with the narrator
        setAudioEnabled(true);
      }
      return next;
    });
  }, [audioEnabled]);

  // Keyboard shortcuts for smooth presentation delivery
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'Escape' && scenarioOpen) {
        setScenarioOpen(false);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'ArrowRight') {
        handleNextStage();
      } else if (e.key === 'ArrowLeft') {
        handlePrevStage();
      } else if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      } else if (e.key === 'r' || e.key === 'R') {
        handleTriggerCollapse();
      } else if (e.key === 'v' || e.key === 'V') {
        handleToggleNarration();
      } else if (e.key === 'u' || e.key === 'U') {
        setUnderwaterView((prev) => !prev);
      } else if (e.key >= '1' && e.key <= '5') {
        handleSelectStage(parseInt(e.key, 10) - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    scenarioOpen,
    handleNextStage,
    handlePrevStage,
    handleTriggerCollapse,
    handleToggleNarration,
    handleSelectStage,
  ]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#081018]">
      {/* Dedicated Isolated WebGL Canvas Container */}
      <div
        ref={canvasMountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        aria-label="Абразия процесінің 3D интерактивті көрінісі"
      />

      {/* Graceful WebGL Context Loss Fallback */}
      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#081018]/95 p-6">
          <div className="max-w-md rounded-xl border border-slate-700 bg-[#0d1826] p-6 text-center space-y-3">
            <h2 className="text-lg font-bold text-slate-100">
              3D графикалық контекст уақытша үзілді
            </h2>
            <p className="text-sm text-slate-300">
              Браузер WebGL ресурстарын қайта қалпына келтіруде. Егер көрініс автоматты түрде ашылмаса, бетті жаңартыңыз.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 transition-colors cursor-pointer"
            >
              Қайта жүктеу
            </button>
          </div>
        </div>
      )}

      {/* Semantic HUD Overlay & Collapsible Bottom Dock */}
      <OverlayHUD
        stageIndex={stageIndex}
        progress={progress}
        wavePower={wavePower}
        isPlaying={isPlaying}
        followTrajectory={followTrajectory}
        activePreset={activePreset}
        showCallouts={showCallouts}
        showForceVectors={showForceVectors}
        audioEnabled={audioEnabled}
        underwaterView={underwaterView}
        narrationEnabled={narrationEnabled}
        narrationStatus={narrationStatus}
        narrationError={narrationError}
        narratorVoice={narratorVoice}
        dockCollapsed={dockCollapsed}
        storyCollapsed={storyCollapsed}
        calloutRefs={calloutDomRefs}
        onSelectStage={handleSelectStage}
        onPrevStage={handlePrevStage}
        onNextStage={handleNextStage}
        onTogglePlay={() => setIsPlaying((prev) => !prev)}
        onProgressChange={handleProgressChange}
        onWavePowerChange={setWavePower}
        onSelectPreset={handleSelectPreset}
        onToggleTrajectory={() => setFollowTrajectory((prev) => !prev)}
        onTriggerCollapse={handleTriggerCollapse}
        onToggleCallouts={() => setShowCallouts((prev) => !prev)}
        onToggleForceVectors={() => setShowForceVectors((prev) => !prev)}
        onToggleAudio={() => setAudioEnabled((prev) => !prev)}
        onToggleUnderwaterView={() => setUnderwaterView((prev) => !prev)}
        onToggleNarration={handleToggleNarration}
        onChangeVoice={setNarratorVoice}
        onReplayNarration={handleReplayNarration}
        onToggleDock={() => setDockCollapsed((prev) => !prev)}
        onToggleStory={() => setStoryCollapsed((prev) => !prev)}
        onOpenScenario={() => setScenarioOpen(true)}
      />

      {/* Scientific Scenario & 3D Camera Trajectory Planner Modal */}
      <ScenarioModal
        isOpen={scenarioOpen}
        activeStageIndex={stageIndex}
        onClose={() => setScenarioOpen(false)}
        onSelectStage={handleSelectStage}
        onSpeakStage={handleSpeakStage}
        onSelectPreset={handleSelectPreset}
      />
    </main>
  );
}
