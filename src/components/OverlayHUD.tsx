import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  EyeOff,
  Flame,
  Loader2,
  Mic,
  MicOff,
  Navigation,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import type { RefObject } from 'react';
import {
  CALLOUT_DEFINITIONS,
  CAMERA_PRESETS,
  PRESENTATION_STAGES,
  type CameraPresetId,
} from '../data/presentationData';
import type { NarrationStatus, NarratorVoice } from '../scene/narrationEngine';

interface OverlayHUDProps {
  stageIndex: number;
  progress: number;
  wavePower: number;
  isPlaying: boolean;
  followTrajectory: boolean;
  activePreset: CameraPresetId;
  showCallouts: boolean;
  showForceVectors: boolean;
  audioEnabled: boolean;
  underwaterView: boolean;
  narrationEnabled: boolean;
  narrationStatus: NarrationStatus;
  narrationError: string | null;
  narratorVoice: NarratorVoice;
  dockCollapsed: boolean;
  storyCollapsed: boolean;
  calloutRefs: RefObject<Record<string, HTMLDivElement | null>>;
  onSelectStage: (index: number) => void;
  onPrevStage: () => void;
  onNextStage: () => void;
  onTogglePlay: () => void;
  onProgressChange: (value: number) => void;
  onWavePowerChange: (value: number) => void;
  onSelectPreset: (presetId: CameraPresetId) => void;
  onToggleTrajectory: () => void;
  onTriggerCollapse: () => void;
  onToggleCallouts: () => void;
  onToggleForceVectors: () => void;
  onToggleAudio: () => void;
  onToggleUnderwaterView: () => void;
  onToggleNarration: () => void;
  onChangeVoice: (voice: NarratorVoice) => void;
  onReplayNarration: () => void;
  onToggleDock: () => void;
  onToggleStory: () => void;
  onOpenScenario: () => void;
}

export function OverlayHUD({
  stageIndex,
  progress,
  wavePower,
  isPlaying,
  followTrajectory,
  activePreset,
  showCallouts,
  showForceVectors,
  audioEnabled,
  underwaterView,
  narrationEnabled,
  narrationStatus,
  narrationError,
  narratorVoice,
  dockCollapsed,
  storyCollapsed,
  calloutRefs,
  onSelectStage,
  onPrevStage,
  onNextStage,
  onTogglePlay,
  onProgressChange,
  onWavePowerChange,
  onSelectPreset,
  onToggleTrajectory,
  onTriggerCollapse,
  onToggleCallouts,
  onToggleForceVectors,
  onToggleAudio,
  onToggleUnderwaterView,
  onToggleNarration,
  onChangeVoice,
  onReplayNarration,
  onToggleDock,
  onToggleStory,
  onOpenScenario,
}: OverlayHUDProps) {
  const stage = PRESENTATION_STAGES[stageIndex] ?? PRESENTATION_STAGES[0];

  // Derived physical telemetry synced to real simulation parameters
  const waveHeightM = (0.7 + wavePower * 1.45).toFixed(1);
  const hydraulicPressureKpa = Math.round(35 + wavePower * wavePower * 82);
  const benchWidthM = (1.2 + progress * 9.8 + (progress > 0.64 ? (progress - 0.64) * 4.2 : 0)).toFixed(1);
  const sedimentThicknessM = (0.1 + progress * 1.25 + (progress > 0.64 ? (progress - 0.64) * 2.4 : 0)).toFixed(1);

  const presets = Object.values(CAMERA_PRESETS);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden">
      {/* ============================================================
          1. 3D-PROJECTED GEOLOGICAL CALLOUT ANNOTATIONS (Direct DOM Transform)
         ============================================================ */}
      {showCallouts && (
        <div className="pointer-events-none fixed inset-0">
          {CALLOUT_DEFINITIONS.map((def) => (
            <div
              key={def.id}
              ref={(el) => {
                if (calloutRefs.current) {
                  calloutRefs.current[def.id] = el;
                }
              }}
              style={{ opacity: 0, transform: 'translate3d(-999px, -999px, 0)' }}
              className="fixed left-0 top-0 -translate-x-1/2 -translate-y-full will-change-transform transition-opacity duration-200"
            >
              <div className="flex flex-col items-center">
                <div className="px-2.5 py-1.5 rounded-md bg-[#08101a]/90 border border-slate-500/40 shadow-lg max-w-[195px]">
                  <div className="text-[11px] font-semibold text-slate-50 leading-tight whitespace-nowrap">
                    {def.title}
                  </div>
                  <div className="text-[10px] text-slate-300/90 leading-snug mt-0.5">
                    {def.subtitle}
                  </div>
                </div>
                <div className="w-px h-4 bg-sky-300/75" />
                <div className="w-2 h-2 rounded-full bg-sky-300 border border-[#08101a]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============================================================
          2. TOP-LEFT MINIMAL SCIENTIFIC STORY CARD (Zero Backdrop-Blur)
         ============================================================ */}
      <aside className="pointer-events-auto fixed top-4 left-4 w-[min(400px,calc(100vw-2rem))] rounded-xl border border-slate-700/60 bg-[#09121d]/92 shadow-xl">
        {/* Top Brand & Collapse Row */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800/80">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-semibold text-sky-300 whitespace-nowrap">Абразия</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">3D Жағалау динамикасы</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleStory}
            aria-label={storyCollapsed ? 'Ақпаратты ашу' : 'Ақпаратты жинау'}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white rounded-md hover:bg-slate-800/70 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            {storyCollapsed ? (
              <>
                <span>Ашу</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Жинау</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>

        {/* Scientific Information Block for Active Stage */}
        {!storyCollapsed && (
          <div className="px-4 py-3.5 space-y-3">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <h1 className="text-[15px] font-bold tracking-tight text-slate-50 leading-snug">
                  {stage.title}
                </h1>
                {stage.scientificBlock.formula && (
                  <span className="text-[11px] font-mono-tabular text-sky-300 whitespace-nowrap shrink-0">
                    {stage.scientificBlock.formula}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">{stage.phaseNote}</p>
            </div>

            <p className="text-[13px] text-slate-200/95 leading-relaxed">
              {stage.scientificBlock.summary}
            </p>

            {/* Kazakh Voiceover Bar */}
            <div className="pt-2.5 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onToggleNarration}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    narrationEnabled
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/30'
                      : 'bg-sky-500/15 border-sky-400/40 text-sky-200 hover:bg-sky-500/25'
                  }`}
                >
                  {narrationStatus === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : narrationEnabled ? (
                    <Mic className="w-3.5 h-3.5" />
                  ) : (
                    <MicOff className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {narrationStatus === 'loading'
                      ? 'Дыбыстау жүктелуде...'
                      : narrationEnabled
                        ? 'Қазақша диктор: Қосулы'
                        : 'Қазақша дыбыстауды қосу'}
                  </span>
                </button>

                {/* Voice Gender Switcher (Charon = Male, Kore = Female) */}
                <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#0d1826] border border-slate-800 shrink-0">
                  <button
                    type="button"
                    onClick={() => onChangeVoice('Charon')}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      narratorVoice === 'Charon'
                        ? 'bg-slate-200 text-slate-950'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    Ер
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeVoice('Kore')}
                    className={`px-2 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                      narratorVoice === 'Kore'
                        ? 'bg-slate-200 text-slate-950'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    Әйел
                  </button>
                </div>
              </div>

              {narrationEnabled && narrationStatus === 'speaking' && (
                <div className="flex items-center justify-between gap-2 text-[11px] text-emerald-300/95">
                  <span>Диктор осы кезеңді түсіндіріп жатыр</span>
                  <button
                    type="button"
                    onClick={onReplayNarration}
                    className="text-slate-300 hover:text-white underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Қайталау
                  </button>
                </div>
              )}

              {narrationStatus === 'error' && narrationError && (
                <p className="text-[11px] text-rose-300 leading-snug" role="alert">
                  {narrationError}
                </p>
              )}
            </div>

            {/* Concise Mechanism & Live Physical Readouts */}
            <div className="pt-2.5 border-t border-slate-800/80 grid grid-cols-4 gap-2">
              <div>
                <div className="text-[10px] text-slate-400">Толқын</div>
                <div className="text-xs font-semibold font-mono-tabular text-slate-100 mt-0.5">
                  {waveHeightM} м
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Қысым</div>
                <div className="text-xs font-semibold font-mono-tabular text-amber-300 mt-0.5">
                  {hydraulicPressureKpa} кПа
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Бенч ені</div>
                <div className="text-xs font-semibold font-mono-tabular text-sky-300 mt-0.5">
                  {benchWidthM} м
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">Шөгінді</div>
                <div className="text-xs font-semibold font-mono-tabular text-amber-200 mt-0.5">
                  {sedimentThicknessM} м
                </div>
              </div>
            </div>

            {/* Active Camera Trajectory Cue */}
            <div className="pt-2 border-t border-slate-800/70 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-400 truncate">
                {stage.trajectory.motionType}
              </span>
              <button
                type="button"
                onClick={onOpenScenario}
                className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Сценарий</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ============================================================
          3. COLLAPSIBLE UNIFIED BOTTOM CONTROL DOCK
         ============================================================ */}
      <div
        className="pointer-events-auto fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(990px,96vw)] transition-transform duration-300 ease-out"
        style={{
          transform: dockCollapsed
            ? 'translate(-50%, calc(100% - 34px))'
            : 'translate(-50%, 0)',
        }}
      >
        {/* Dock Collapse Handle */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onToggleDock}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-t-lg border border-b-0 border-slate-700/70 bg-[#09121d]/95 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
                <span>Басқару панелін көрсету (H)</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                <span>Басқаруды жасыру (H)</span>
              </>
            )}
          </button>
        </div>

        {/* Main Dock Panel */}
        <div className="rounded-xl border border-slate-700/70 bg-[#09121d]/94 shadow-2xl px-4 py-3 space-y-3">
          {/* Row 1: Stage Stepper + 5 Stage Tabs + Primary Action Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Transport Play / Prev / Next */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onTogglePlay}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isPlaying
                    ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                    : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                }`}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isPlaying ? 'Кідірту' : 'Ойнату'}</span>
              </button>

              <button
                type="button"
                onClick={onPrevStage}
                aria-label="Алдыңғы кезең"
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700/80 bg-slate-900/90 text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onNextStage}
                aria-label="Келесі кезең"
                className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-700/80 bg-slate-900/90 text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer shrink-0"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* 5 Stage Segmented Tabs */}
            <div
              className="flex items-center gap-1 p-1 rounded-lg bg-[#0d1826] border border-slate-800 overflow-x-auto max-w-full"
              role="tablist"
              aria-label="Абразия кезеңдері"
            >
              {PRESENTATION_STAGES.map((st) => {
                const active = st.id === stageIndex;
                return (
                  <button
                    key={st.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => onSelectStage(st.id)}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40'
                        : 'text-slate-400 hover:text-slate-100 border border-transparent'
                    }`}
                  >
                    <span className="font-mono-tabular mr-1 text-[11px] opacity-80">
                      {st.indexLabel}.
                    </span>
                    {st.shortLabel}
                  </button>
                );
              })}
            </div>

            {/* Action Buttons: Kazakh Voiceover + Trigger Collapse + Scenario Plan */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onToggleNarration}
                title="Қазақша дауыстап түсіндіруді қосу/өшіру (V)"
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  narrationEnabled
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                    : 'border-slate-700/80 bg-slate-900/90 text-slate-200 hover:text-white hover:border-slate-500'
                }`}
              >
                {narrationStatus === 'loading' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
                ) : narrationEnabled ? (
                  <Mic className="w-3.5 h-3.5 text-emerald-300" />
                ) : (
                  <MicOff className="w-3.5 h-3.5 text-slate-400" />
                )}
                <span>Диктор</span>
              </button>

              <button
                type="button"
                onClick={onTriggerCollapse}
                title="Жартастың опырылу сәтін көрсету (R)"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-amber-500/45 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span>Опырылу</span>
              </button>

              <button
                type="button"
                onClick={onOpenScenario}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-700/80 bg-slate-900/90 text-slate-200 hover:text-white hover:border-slate-500 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5 text-sky-400" />
                <span>Сценарий</span>
              </button>
            </div>
          </div>

          {/* Row 2: Precision Sliders + Close-Up Camera Vantage Points + Toggles */}
          <div className="pt-2.5 border-t border-slate-800/80 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            {/* Abrasion Progress Slider */}
            <div className="lg:col-span-3 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <label htmlFor="slider-progress" className="text-slate-300 font-medium">
                  Абразия барысы
                </label>
                <span className="font-mono-tabular text-sky-300 font-semibold">
                  {Math.round(progress * 100)}%
                </span>
              </div>
              <input
                id="slider-progress"
                type="range"
                min={0}
                max={1}
                step={0.005}
                value={progress}
                onChange={(e) => onProgressChange(parseFloat(e.target.value))}
                className="abrasion-slider w-full"
              />
            </div>

            {/* Wave Power Slider */}
            <div className="lg:col-span-2 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <label htmlFor="slider-wave" className="text-slate-300 font-medium">
                  Толқын қуаты
                </label>
                <span className="font-mono-tabular text-amber-300 font-semibold">
                  {wavePower.toFixed(1)}×
                </span>
              </div>
              <input
                id="slider-wave"
                type="range"
                min={0.4}
                max={2.0}
                step={0.05}
                value={wavePower}
                onChange={(e) => onWavePowerChange(parseFloat(e.target.value))}
                className="abrasion-slider w-full"
              />
            </div>

            {/* Close-up Observation Vantage Points */}
            <div className="lg:col-span-5 flex items-center gap-1 overflow-x-auto py-0.5">
              {presets.map((preset) => {
                const isSelected = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onSelectPreset(preset.id)}
                    title={preset.shortDesc}
                    className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isSelected
                        ? 'bg-slate-200 text-slate-950'
                        : 'bg-slate-900/90 text-slate-300 border border-slate-800 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Utility Toggles: Underwater Clarity, Trajectory, Callouts, Force Vectors, Audio */}
            <div className="lg:col-span-2 flex items-center justify-end gap-1 shrink-0">
              <button
                type="button"
                onClick={onToggleUnderwaterView}
                title={
                  underwaterView
                    ? 'Қалыпты су бетіне қайту (U)'
                    : 'Су асты бенч пен шөгіндіні мөлдір көру (U)'
                }
                aria-label="Су асты мөлдір көрініс"
                className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                  underwaterView
                    ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-200'
                    : 'border-slate-700/80 bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                <Waves className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onToggleTrajectory}
                title={followTrajectory ? 'Авто-траектория қосулы' : 'Еркін камера'}
                aria-label="Авто-траектория"
                className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                  followTrajectory
                    ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700/80 bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onToggleCallouts}
                title={showCallouts ? '3D белгілерді жасыру' : '3D белгілерді көрсету'}
                aria-label="3D белгілер"
                className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                  showCallouts
                    ? 'border-sky-400/50 bg-sky-500/20 text-sky-200'
                    : 'border-slate-700/80 bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                {showCallouts ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={onToggleForceVectors}
                title={showForceVectors ? 'Күш векторларын жасыру' : 'Күш векторларын көрсету'}
                aria-label="Күш векторлары"
                className={`px-1.5 h-8 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  showForceVectors
                    ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                    : 'border-slate-700/80 bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                F→
              </button>

              <button
                type="button"
                onClick={onToggleAudio}
                title={audioEnabled ? 'Дыбысты өшіру' : 'Теңіз дыбысын қосу'}
                aria-label="Дыбыс"
                className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                  audioEnabled
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : 'border-slate-700/80 bg-slate-900 text-slate-400 hover:text-white'
                }`}
              >
                {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
