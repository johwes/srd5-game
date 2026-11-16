import React, { useState } from 'react';
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import type {
  ArenaConfig,
  ArenaDifficultyTier,
  ArenaEnvironment,
  ArenaSubMode,
} from './types.js';

export interface ArenaSetupViewProps {
  rosterCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  onLaunchArena: (config: ArenaConfig) => void;
  onBackToRoster?: () => void;
}

export function ArenaSetupView({
  rosterCharacters = [],
  compendium = defaultCompendium,
  onLaunchArena,
  onBackToRoster,
}: ArenaSetupViewProps) {
  const [mode, setMode] = useState<ArenaSubMode>('custom_skirmish');
  const [gridSize, setGridSize] = useState<10 | 14 | 18>(14);
  const [environment, setEnvironment] = useState<ArenaEnvironment>('pillars');

  // PvE configuration
  const [difficultyTier, setDifficultyTier] =
    useState<ArenaDifficultyTier>('medium');
  const [restFrequencyWaves, setRestFrequencyWaves] = useState<number>(2);
  const [selectedMonsterPreset, setSelectedMonsterPreset] =
    useState<string>('auto');

  // PvP configuration
  const [teamAName, setTeamAName] = useState('Team Phoenix');
  const [teamAColor, setTeamAColor] = useState('#ef4444');
  const [teamBName, setTeamBName] = useState('Team Wyvern');
  const [teamBColor, setTeamBColor] = useState('#3b82f6');

  // Roster selections for PvP
  const availablePregens: CharacterBuildState[] = [
    getPregenCharacter('pregen-fighter'),
    getPregenCharacter('pregen-rogue'),
    getPregenCharacter('pregen-wizard'),
    getPregenCharacter('pregen-cleric'),
  ].filter(Boolean) as CharacterBuildState[];

  const combinedCharacters = [
    ...rosterCharacters,
    ...availablePregens.filter(
      (p) => !rosterCharacters.some((rc) => rc.id === p.id),
    ),
  ];

  const [teamACharacterIds, setTeamACharacterIds] = useState<string[]>(() => [
    combinedCharacters[0]?.id ?? 'pregen-fighter',
    combinedCharacters[1]?.id ?? 'pregen-rogue',
  ]);

  const [teamBCharacterIds, setTeamBCharacterIds] = useState<string[]>(() => [
    combinedCharacters[2]?.id ?? 'pregen-wizard',
    combinedCharacters[3]?.id ?? 'pregen-cleric',
  ]);

  const handleToggleTeamACharacter = (id: string) => {
    setTeamACharacterIds((prev) =>
      prev.includes(id)
        ? prev.length > 1
          ? prev.filter((x) => x !== id)
          : prev
        : prev.length < 4
        ? [...prev, id]
        : prev,
    );
  };

  const handleToggleTeamBCharacter = (id: string) => {
    setTeamBCharacterIds((prev) =>
      prev.includes(id)
        ? prev.length > 1
          ? prev.filter((x) => x !== id)
          : prev
        : prev.length < 4
        ? [...prev, id]
        : prev,
    );
  };

  const handleLaunch = () => {
    let selectedMonsterIds: string[] | undefined = undefined;
    if (selectedMonsterPreset === 'goblins') {
      selectedMonsterIds = ['goblin', 'goblin', 'wolf'];
    } else if (selectedMonsterPreset === 'undead') {
      selectedMonsterIds = ['skeleton', 'skeleton', 'zombie', 'ghoul'];
    } else if (selectedMonsterPreset === 'orcs') {
      selectedMonsterIds = ['orc', 'orc', 'hobgoblin', 'ogre'];
    } else if (selectedMonsterPreset === 'dragon') {
      selectedMonsterIds = ['young-black-dragon', 'kobold', 'kobold'];
    }

    const teamARoster = combinedCharacters.filter((c) =>
      teamACharacterIds.includes(c.id),
    );
    const teamBRoster = combinedCharacters.filter((c) =>
      teamBCharacterIds.includes(c.id),
    );

    const config: ArenaConfig = {
      id: `arena-${Date.now()}`,
      name:
        mode === 'pvp_duel'
          ? `${teamAName} vs ${teamBName}`
          : mode === 'endless_waves'
          ? 'The Arena — Endless Waves'
          : 'The Arena — Custom Skirmish',
      mode,
      mapId: `arena-${gridSize}x${gridSize}-${environment}`,
      gridWidth: gridSize,
      gridHeight: gridSize,
      environmentObstacles: environment,
      pveSettings:
        mode !== 'pvp_duel'
          ? {
              difficultyTier,
              waveCount: mode === 'endless_waves' ? 0 : 1,
              restFrequencyWaves,
              selectedMonsterIds,
            }
          : undefined,
      pvpSettings:
        mode === 'pvp_duel'
          ? {
              teamA: {
                playerId: 'player_red',
                teamId: 'team_red',
                teamName: teamAName,
                color: teamAColor,
                roster: teamARoster,
              },
              teamB: {
                playerId: 'player_blue',
                teamId: 'team_blue',
                teamName: teamBName,
                color: teamBColor,
                roster: teamBRoster,
              },
              fogOfWar: 'none',
            }
          : undefined,
    };

    onLaunchArena(config);
  };

  return (
    <div
      data-testid="arena-setup-view"
      className="max-w-5xl mx-auto w-full space-y-6 text-slate-100"
    >
      {/* Title & Introduction */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-amber-400 tracking-tight flex items-center gap-2">
            <span>⚔️</span> The Arena — Tactical Grounds
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Test builds in instant skirmishes, endure endless waves with short-rest breathers,
            or duel friends in 1v1 hot-seat party battles.
          </p>
        </div>

        {onBackToRoster && (
          <button
            type="button"
            data-testid="arena-back-to-roster-btn"
            onClick={onBackToRoster}
            className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            &larr; Back to Party Roster
          </button>
        )}
      </div>

      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          type="button"
          data-testid="arena-mode-skirmish"
          onClick={() => setMode('custom_skirmish')}
          className={`p-4 rounded-xl border text-left transition-all ${
            mode === 'custom_skirmish'
              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">🎯</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                mode === 'custom_skirmish'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              PvE Skirmish
            </span>
          </div>
          <h3 className="font-bold text-sm text-slate-100">Custom Skirmish</h3>
          <p className="text-xs text-slate-400 mt-1">
            Instant tactical encounter against selected monster packs or difficulty tiers.
          </p>
        </button>

        <button
          type="button"
          data-testid="arena-mode-endless"
          onClick={() => setMode('endless_waves')}
          className={`p-4 rounded-xl border text-left transition-all ${
            mode === 'endless_waves'
              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">🌊</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                mode === 'endless_waves'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              Endless Waves
            </span>
          </div>
          <h3 className="font-bold text-sm text-slate-100">Endless Wave Defense</h3>
          <p className="text-xs text-slate-400 mt-1">
            Survive escalating monster waves with short-rest breathers and track your score.
          </p>
        </button>

        <button
          type="button"
          data-testid="arena-mode-pvp"
          onClick={() => setMode('pvp_duel')}
          className={`p-4 rounded-xl border text-left transition-all ${
            mode === 'pvp_duel'
              ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">🔥</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                mode === 'pvp_duel'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              1v1 Hot-Seat
            </span>
          </div>
          <h3 className="font-bold text-sm text-slate-100">Hot-Seat PvP Duel</h3>
          <p className="text-xs text-slate-400 mt-1">
            Two players take turns commanding opposing parties (Red vs Blue) on the tactical grid.
          </p>
        </button>
      </div>

      {/* Map & Environment Configuration */}
      <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
          Arena Map &amp; Battlefield Terrain
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Arena Grid Dimensions
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { size: 10, label: '10 × 10', desc: 'Compact' },
                { size: 14, label: '14 × 14', desc: 'Standard' },
                { size: 18, label: '18 × 18', desc: 'Grand' },
              ].map((s) => (
                <button
                  key={s.size}
                  type="button"
                  data-testid={`grid-size-${s.size}`}
                  onClick={() => setGridSize(s.size as 10 | 14 | 18)}
                  className={`p-2.5 rounded-lg border text-center transition-all ${
                    gridSize === s.size
                      ? 'border-amber-500 bg-amber-500/20 text-white font-bold'
                      : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="text-xs">{s.label}</div>
                  <div className="text-[10px] text-slate-500">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Battlefield Obstacles &amp; Hazards
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'open_sands', label: 'Open Sands', icon: '🏜️' },
                { id: 'pillars', label: 'Stone Pillars', icon: '🏛️' },
                { id: 'chasm_bridge', label: 'Chasm Bridge', icon: '🌉' },
                { id: 'hazards_lava', label: 'Lava Hazards', icon: '🌋' },
              ].map((env) => (
                <button
                  key={env.id}
                  type="button"
                  data-testid={`env-${env.id}`}
                  onClick={() => setEnvironment(env.id as ArenaEnvironment)}
                  className={`p-2 rounded-lg border text-left flex items-center gap-2 transition-all ${
                    environment === env.id
                      ? 'border-amber-500 bg-amber-500/20 text-white font-bold'
                      : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="text-base">{env.icon}</span>
                  <span className="text-xs">{env.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mode Specific Settings: PvE Skirmish / Endless Waves */}
      {mode !== 'pvp_duel' && (
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            PvE Encounter Settings
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Difficulty Tier
              </label>
              <div className="grid grid-cols-4 gap-2">
                {(['easy', 'medium', 'hard', 'deadly'] as ArenaDifficultyTier[]).map(
                  (tier) => (
                    <button
                      key={tier}
                      type="button"
                      data-testid={`difficulty-${tier}`}
                      onClick={() => setDifficultyTier(tier)}
                      className={`p-2 rounded-lg border text-center uppercase text-xs font-bold transition-all ${
                        difficultyTier === tier
                          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                          : 'border-slate-700 bg-slate-800/80 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {tier}
                    </button>
                  ),
                )}
              </div>
            </div>

            {mode === 'custom_skirmish' ? (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Monster Encounter Preset
                </label>
                <select
                  value={selectedMonsterPreset}
                  onChange={(e) => setSelectedMonsterPreset(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="auto">Adaptive Monster Tier (CR-based)</option>
                  <option value="goblins">Goblin Ambush &amp; Wolves (CR 1/4–1/2)</option>
                  <option value="undead">Undead Crypt: Skeletons &amp; Ghouls (CR 1/4–1)</option>
                  <option value="orcs">Orc Warband &amp; Ogre (CR 1/2–2)</option>
                  <option value="dragon">Dragon's Lair: Wyrmling &amp; Kobolds (CR 1/8–4)</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Breather Rest Frequency
                </label>
                <select
                  value={restFrequencyWaves}
                  onChange={(e) => setRestFrequencyWaves(Number(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
                >
                  <option value="1">Short Rest Every 1 Wave (Casual)</option>
                  <option value="2">Short Rest Every 2 Waves (Standard)</option>
                  <option value="3">Short Rest Every 3 Waves (Heroic)</option>
                  <option value="5">Short Rest Every 5 Waves (Ironman)</option>
                </select>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-800/60">
            <span className="text-xs text-slate-400">
              Active Party:{' '}
              <span className="font-semibold text-slate-200">
                {rosterCharacters.length > 0
                  ? `${rosterCharacters.length} heroes from Party Roster`
                  : '4 Iconic Pregens (Fighter, Wizard, Cleric, Rogue)'}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Mode Specific Settings: 1v1 Hot-Seat PvP Duel */}
      {mode === 'pvp_duel' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Team Red */}
          <div className="p-5 rounded-xl border border-red-900/60 bg-red-950/20 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                Player 1 &middot; Team Red
              </span>
              <input
                type="color"
                value={teamAColor}
                onChange={(e) => setTeamAColor(e.target.value)}
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                title="Choose Team Color"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Team Name
              </label>
              <input
                type="text"
                value={teamAName}
                onChange={(e) => setTeamAName(e.target.value)}
                className="w-full bg-slate-900 border border-red-800/80 rounded-lg p-2 text-xs text-slate-100 focus:outline-none focus:border-red-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Select Characters (1–4 heroes)
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {combinedCharacters.map((c) => {
                  const isSelected = teamACharacterIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleToggleTeamACharacter(c.id)}
                      className={`w-full p-2 rounded-lg border text-left text-xs flex items-center justify-between transition-all ${
                        isSelected
                          ? 'border-red-500 bg-red-500/20 text-white font-semibold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>{c.name}</span>
                      <span className="text-[10px] uppercase text-slate-400">
                        {c.classes[0]?.classId} L{c.classes[0]?.level ?? 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Team Blue */}
          <div className="p-5 rounded-xl border border-blue-900/60 bg-blue-950/20 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-400">
                Player 2 &middot; Team Blue
              </span>
              <input
                type="color"
                value={teamBColor}
                onChange={(e) => setTeamBColor(e.target.value)}
                className="w-6 h-6 rounded bg-transparent border-0 cursor-pointer"
                title="Choose Team Color"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Team Name
              </label>
              <input
                type="text"
                value={teamBName}
                onChange={(e) => setTeamBName(e.target.value)}
                className="w-full bg-slate-900 border border-blue-800/80 rounded-lg p-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Select Characters (1–4 heroes)
              </label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {combinedCharacters.map((c) => {
                  const isSelected = teamBCharacterIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleToggleTeamBCharacter(c.id)}
                      className={`w-full p-2 rounded-lg border text-left text-xs flex items-center justify-between transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/20 text-white font-semibold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>{c.name}</span>
                      <span className="text-[10px] uppercase text-slate-400">
                        {c.classes[0]?.classId} L{c.classes[0]?.level ?? 1}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Launch Action Button */}
      <div className="sticky bottom-2 z-20 pt-2 pb-1 bg-slate-950/90 backdrop-blur-md rounded-xl shadow-lg">
        <button
          type="button"
          data-testid="launch-arena-button"
          onClick={handleLaunch}
          className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-sm sm:text-base tracking-wide uppercase shadow-lg shadow-amber-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
        >
          <span>⚔️</span>
          <span>
            {mode === 'pvp_duel'
              ? 'Launch 1v1 Party Duel'
              : mode === 'endless_waves'
              ? 'Begin Endless Wave Gauntlet'
              : 'Enter Arena Skirmish'}
          </span>
        </button>
      </div>
    </div>
  );
}
