import { Camera, Compass, Mic, Play, X } from 'lucide-react';
import {
  CAMERA_PRESETS,
  PRESENTATION_STAGES,
  type CameraPresetId,
} from '../data/presentationData';

interface ScenarioModalProps {
  isOpen: boolean;
  activeStageIndex: number;
  onClose: () => void;
  onSelectStage: (index: number) => void;
  onSpeakStage: (index: number) => void;
  onSelectPreset: (presetId: CameraPresetId) => void;
}

export function ScenarioModal({
  isOpen,
  activeStageIndex,
  onClose,
  onSelectStage,
  onSpeakStage,
  onSelectPreset,
}: ScenarioModalProps) {
  if (!isOpen) return null;

  const presetList = Object.values(CAMERA_PRESETS);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6 bg-[#050a11]/85"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl max-h-[86vh] flex flex-col rounded-xl border border-slate-700/70 bg-[#0b131e] text-slate-100 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div>
            <p className="text-xs text-slate-400">
              Ғылыми презентация жоспары · Қазақша дыбыстау · 3D камера хореографиясы
            </p>
            <h2
              id="scenario-modal-title"
              className="text-lg sm:text-xl font-bold tracking-tight text-slate-50 mt-0.5"
            >
              Абразия сценарийі, диктор мәтіні және камера траекториясы
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Терезені жабу"
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-slate-700/80 bg-slate-900 text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
          {/* Section 1: Stage-by-stage scientific script + trajectory */}
          <section>
            <div className="flex items-baseline justify-between gap-4 pb-3 border-b border-slate-800/80">
              <h3 className="text-base font-semibold text-slate-100">
                1. Әр кезеңнің ғылыми блогы, диктор мәтіні және 3D камера траекториясы
              </h3>
              <span className="text-xs text-slate-400 font-mono-tabular whitespace-nowrap">
                5 кезең · Catmull-Rom 3D траектория
              </span>
            </div>

            <div className="mt-4 divide-y divide-slate-800/80">
              {PRESENTATION_STAGES.map((stage) => {
                const isActive = stage.id === activeStageIndex;
                return (
                  <div
                    key={stage.id}
                    className={`py-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start ${
                      isActive ? 'bg-sky-950/25 -mx-3 px-3 rounded-lg' : ''
                    }`}
                  >
                    {/* Scientific Block + Voiceover Script */}
                    <div className="lg:col-span-7 space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-bold text-slate-100">
                          {stage.title}
                        </h4>
                        {stage.scientificBlock.formula && (
                          <span className="text-xs font-mono-tabular text-sky-300 whitespace-nowrap">
                            {stage.scientificBlock.formula}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{stage.phaseNote}</p>
                      <p className="text-sm text-slate-200 leading-relaxed">
                        {stage.narrationText}
                      </p>
                      <p className="text-xs text-slate-400 font-mono-tabular pt-0.5">
                        {stage.scientificBlock.metricsNote}
                      </p>
                    </div>

                    {/* Camera Trajectory Segment */}
                    <div className="lg:col-span-5 space-y-2 lg:pl-4 lg:border-l lg:border-slate-800/80">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-amber-300">
                          {stage.trajectory.motionType}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              onSpeakStage(stage.id);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/35 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Mic className="w-3 h-3" />
                            Тыңдау
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectStage(stage.id);
                              onClose();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-500/30 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Play className="w-3 h-3" />
                            Көру
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {stage.trajectory.purpose}
                      </p>
                      <div className="text-[11px] font-mono-tabular text-slate-400 space-y-0.5">
                        <div>
                          Басталуы: ({stage.trajectory.startPos.join(', ')}) → Аяқталуы: (
                          {stage.trajectory.endPos.join(', ')})
                        </div>
                        <div>
                          Фокус нүктесі: ({stage.trajectory.lookAtStart.join(', ')}) → (
                          {stage.trajectory.lookAtEnd.join(', ')})
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Section 2: Close-up Observation Vantage Points */}
          <section>
            <div className="flex items-baseline justify-between gap-4 pb-3 border-b border-slate-800/80">
              <h3 className="text-base font-semibold text-slate-100">
                2. Жағалаудың бұзылу сәттерін жақыннан көрсететін бақылау нүктелері
              </h3>
              <span className="text-xs text-slate-400 font-mono-tabular whitespace-nowrap">
                {presetList.length} интерактивті нүкте
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {presetList.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onSelectPreset(preset.id);
                    onClose();
                  }}
                  className="text-left p-3.5 rounded-lg border border-slate-800 bg-[#0e1826] hover:border-sky-500/50 hover:bg-[#122033] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100 group-hover:text-sky-300 transition-colors">
                      {preset.label}
                    </span>
                    <Camera className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-400 shrink-0" />
                  </div>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {preset.shortDesc}
                  </p>
                  <div className="flex items-center gap-1.5 text-[11px] font-mono-tabular text-slate-500 mt-2">
                    <Compass className="w-3 h-3 shrink-0" />
                    <span>
                      XYZ ({preset.position[0]}, {preset.position[1]}, {preset.position[2]})
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
