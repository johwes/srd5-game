import React from 'react';
import {
  type Scarcity,
  type WarIntensity,
  type Wildness,
  type WorldOptions,
  type WorldScope,
  computeWorldDailySeed,
  formatWorldOptionsBanner,
  getWorldSeedDateString,
} from '@srd5/engine';

export interface WorldOptionsFormProps {
  value: WorldOptions;
  onChange: (next: WorldOptions) => void;
  /** Show Realm-only war intensity row (hidden for Descent-only setups). */
  showWarIntensity?: boolean;
}

const SCOPE_OPTIONS: Array<{ id: WorldScope; label: string; hint: string }> = [
  { id: 'standard', label: 'Standard', hint: "Today's sizes" },
  { id: 'grand', label: 'Grand', hint: '+50% rooms/tiles, +1 foe' },
];

const WILDNESS_OPTIONS: Array<{ id: Wildness; label: string; hint: string }> = [
  { id: 'calm', label: 'Calm', hint: '0.75× density' },
  { id: 'standard', label: 'Standard', hint: 'Today\'s density' },
  { id: 'wild', label: 'Wild', hint: '1.5× density' },
];

const SCARCITY_OPTIONS: Array<{ id: Scarcity; label: string; hint: string }> = [
  { id: 'abundant', label: 'Abundant', hint: 'Rich loot, light rations' },
  { id: 'standard', label: 'Standard', hint: "Today's economy" },
  { id: 'scarce', label: 'Scarce', hint: 'Lean loot, heavy rations' },
];

const WAR_OPTIONS: Array<{ id: WarIntensity; label: string; hint: string }> = [
  { id: 'contained', label: 'Contained', hint: '2 rivals · slow tick' },
  { id: 'standard', label: 'Standard', hint: '3–4 rivals · normal tick' },
  { id: 'total_war', label: 'Total War', hint: '5 rivals · fast tick' },
];

function OptionRow<T extends string>({
  label,
  testPrefix,
  options,
  active,
  onPick,
}: {
  label: string;
  testPrefix: string;
  options: Array<{ id: T; label: string; hint: string }>;
  active: T;
  onPick: (id: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-bold text-slate-200">{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {options.map((opt) => {
          const isActive = active === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              data-testid={`${testPrefix}-${opt.id}`}
              aria-pressed={isActive}
              onClick={() => onPick(opt.id)}
              className={`min-h-[44px] rounded-lg px-2 py-1.5 text-xs border transition-colors focus:ring-2 focus:ring-amber-400 focus:outline-none ${
                isActive
                  ? 'border-amber-500 bg-amber-950/60 text-amber-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
              title={opt.hint}
            >
              <div className="font-bold">{opt.label}</div>
              <div className="text-[10px] opacity-70">{opt.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function WorldOptionsForm({ value, onChange, showWarIntensity = true }: WorldOptionsFormProps) {
  const set = (patch: Partial<WorldOptions>) => onChange({ ...value, ...patch });

  const handleSeedText = (text: string) => {
    const parsed = Number.parseInt(text, 10);
    if (Number.isFinite(parsed)) {
      set({ seed: parsed | 0, seedSource: 'manual', dailyDate: undefined });
    }
  };

  const handleDailySeed = () => {
    const dailyDate = getWorldSeedDateString(new Date());
    set({ seed: computeWorldDailySeed(dailyDate), seedSource: 'daily', dailyDate });
  };

  const seedHex = `0x${(value.seed >>> 0).toString(16).toUpperCase()}`;

  return (
    <div
      data-testid="world-options-form"
      className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-100">World Options — Civ Setup</div>
          <p className="text-xs text-slate-400">
            Chosen before launch and stored on the run. Defaults reproduce today's generation exactly.
          </p>
        </div>
        <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
          Seeded · Replay-stable
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <OptionRow
          label="World Scope"
          testPrefix="world-scope"
          options={SCOPE_OPTIONS}
          active={value.scope}
          onPick={(scope) => set({ scope })}
        />
        <OptionRow
          label="Wildness (encounter density)"
          testPrefix="world-wildness"
          options={WILDNESS_OPTIONS}
          active={value.wildness}
          onPick={(wildness) => set({ wildness })}
        />
        <OptionRow
          label="Scarcity (loot & rations)"
          testPrefix="world-scarcity"
          options={SCARCITY_OPTIONS}
          active={value.scarcity}
          onPick={(scarcity) => set({ scarcity })}
        />
        {showWarIntensity && (
          <OptionRow
            label="War Intensity (Realm rivals)"
            testPrefix="world-war"
            options={WAR_OPTIONS}
            active={value.warIntensity}
            onPick={(warIntensity) => set({ warIntensity })}
          />
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
        <div className="text-xs font-bold text-slate-200">Seed — manual entry + daily seed</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <label className="flex-1 flex items-center gap-2 text-xs text-slate-300">
            <span className="shrink-0 text-slate-400">Manual</span>
            <input
              type="number"
              data-testid="world-seed-input"
              defaultValue={value.seed}
              key={value.seedSource === 'manual' ? value.seed : 'manual-seed'}
              onBlur={(e) => handleSeedText(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-amber-400 focus:outline-none"
            />
          </label>
          <button
            type="button"
            data-testid="world-seed-daily-btn"
            onClick={handleDailySeed}
            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 transition-colors"
          >
            🎲 Use Daily Seed
          </button>
        </div>
        <div data-testid="world-seed-preview" className="text-[11px] text-slate-400">
          Rolled visibly: <span className="font-mono text-slate-200">{seedHex}</span>
          {value.seedSource === 'daily' && value.dailyDate ? (
            <span> · Daily {value.dailyDate}</span>
          ) : value.seedSource === 'manual' ? (
            <span> · Manual entry</span>
          ) : (
            <span> · Default</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorldOptionsBanner({ options }: { options?: Partial<WorldOptions> | null }) {
  if (!options) return null;
  const text = formatWorldOptionsBanner(options);
  const seedHex = `0x${((options.seed ?? 1337) >>> 0).toString(16).toUpperCase()}`;
  return (
    <div
      data-testid="world-options-banner"
      title={text}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-sky-700/60 bg-sky-950/50 text-sky-200 text-[11px] font-semibold"
    >
      <span aria-hidden="true">🌍</span>
      <span className="truncate max-w-[320px]">{text}</span>
      <span className="hidden sm:inline font-mono opacity-70">{seedHex}</span>
    </div>
  );
}
