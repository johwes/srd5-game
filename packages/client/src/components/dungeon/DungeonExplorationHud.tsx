import React from 'react';
import type { DungeonExplorationHudProps } from './types.js';

export function DungeonExplorationHud({
  viewState,
  gameState,
  compendium,
  campaignName,
  floorSpec,
  leadExplorerId,
  inStealth,
  formation,
  adjacentProps,
  selectedProp,
  hasUnclaimedLoot = false,
  onToggleStealth,
  onOpenMarchingOrder,
  onOpenRestCamp,
  onOpenLootInventory,
  onOpenSaveLoad,
  onOpenPauseMenu,
  onPerformSearch,
  onSelectLeadExplorer,
  onInspectCharacter,
  onInspectProp,
  onDescendStairs,
  onAscendStairs,
  onExitDelve,
}: DungeonExplorationHudProps) {
  const partyList = Object.values(viewState.party);
  const leadExplorer = viewState.party[leadExplorerId] ?? partyList[0];

  // Determine current room if lead explorer is inside a room
  let currentRoomName = 'Uncharted Corridor';
  let isCurrentRoomSafe = false;

  if (gameState?.dungeon && leadExplorer?.position) {
    const leadCell = gameState.grid.cells[leadExplorer.position.y * gameState.grid.width + leadExplorer.position.x];
    if (leadCell?.roomId && gameState.dungeon.rooms[leadCell.roomId]) {
      const room = gameState.dungeon.rooms[leadCell.roomId]!;
      currentRoomName = room.name;
      isCurrentRoomSafe = room.isSafeRoom;
    }
  }

  const formationLabel = formation === 'two_by_two' ? '2x2 Box' : 'Single File';

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 select-none z-20">
      {/* Top Header Bar */}
      <header className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/90 backdrop-blur-md p-3 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏰</span>
            <div>
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                {campaignName}
              </div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{floorSpec.name}</span>
                <span className="text-xs font-normal text-slate-400">&middot;</span>
                <span className="text-xs font-semibold text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">
                  📍 {currentRoomName}
                  {isCurrentRoomSafe && (
                    <span className="ml-1 text-emerald-400 font-bold">(Safe Room)</span>
                  )}
                </span>
              </h2>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Stealth Toggle */}
          <button
            type="button"
            data-testid="hud-stealth-toggle-btn"
            aria-pressed={inStealth}
            onClick={onToggleStealth}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
              inStealth
                ? 'bg-purple-950/80 border-purple-500 text-purple-200 shadow-[0_0_12px_rgba(168,85,247,0.35)]'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
            title="Toggle party stealth movement (affects surprise checks)"
          >
            <span>{inStealth ? '🥷' : '👣'}</span>
            <span>{inStealth ? 'Stealth Active' : 'Normal Pace'}</span>
          </button>

          {/* Marching Order Modal Trigger */}
          <button
            type="button"
            data-testid="hud-marching-order-btn"
            onClick={onOpenMarchingOrder}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span>🛡️</span>
            <span>Formation ({formationLabel})</span>
          </button>

          {/* Active Room Search */}
          <button
            type="button"
            data-testid="hud-search-room-btn"
            onClick={onPerformSearch}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title="Perform active WIS (Perception) / INT (Investigation) search to detect hidden traps or secret doors"
          >
            <span>🔍</span>
            <span>Search Room</span>
          </button>

          {/* Rest Camp Trigger */}
          <button
            type="button"
            data-testid="hud-rest-camp-btn"
            onClick={onOpenRestCamp}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span>🏕️</span>
            <span>Rest Camp</span>
          </button>

          {/* Loot & Inventory Trigger */}
          <button
            type="button"
            data-testid="hud-loot-inventory-btn"
            onClick={onOpenLootInventory}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors relative"
          >
            <span>🎒</span>
            <span>Inventory</span>
            {hasUnclaimedLoot && (
              <span className="w-2 h-2 rounded-full bg-amber-400 absolute -top-0.5 -right-0.5 animate-ping" />
            )}
          </button>

          {/* Save / Load Trigger */}
          <button
            type="button"
            data-testid="hud-save-load-btn"
            onClick={onOpenSaveLoad}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span>💾</span>
            <span>Save / Load</span>
          </button>

          {/* Pause / System Menu Trigger */}
          {onOpenPauseMenu && (
            <button
              type="button"
              data-testid="hud-pause-menu-btn"
              onClick={onOpenPauseMenu}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-amber-500/60 text-slate-300 hover:text-amber-300 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="Open Pause / System Menu (Esc)"
            >
              <span>⚙️</span>
              <span>Menu</span>
            </button>
          )}

          {/* Exit / Abandon Delve */}
          <button
            type="button"
            data-testid="hud-exit-delve-btn"
            onClick={onExitDelve}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-red-800 hover:text-red-300 text-slate-400 text-xs font-semibold transition-colors"
          >
            Exit
          </button>
        </div>
      </header>

      {/* Middle Contextual Prop Indicator Strip (SRD-510: click to inspect) */}
      {adjacentProps.length > 0 && (
        <div
          data-testid="hud-adjacent-props-panel"
          className="pointer-events-auto self-center max-w-xl w-full rounded-xl border border-slate-700 bg-slate-950/90 backdrop-blur-md p-3 shadow-xl space-y-2"
        >
          <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-1.5">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <span>📍</span> Nearby Features
            </span>
            <span className="text-slate-500 text-[11px]">
              Select one to inspect &middot; Chebyshev reach &le; 1.5 tiles
            </span>
          </div>

          <div className="space-y-1.5">
            {adjacentProps.map((prop) => {
              const kind = prop.kind;
              const state = prop.state;
              const isSelected = selectedProp?.id === prop.id;
              const isStairs = kind === 'stairs_down' || kind === 'stairs_up';

              return (
                <div
                  key={prop.id}
                  data-testid={`adjacent-prop-row-${prop.id}`}
                  className={`flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border transition-colors ${
                    isSelected
                      ? 'bg-amber-950/40 border-amber-500/60'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <button
                    type="button"
                    data-testid={`inspect-prop-btn-${prop.id}`}
                    onClick={() => onInspectProp?.(prop.id)}
                    aria-pressed={isSelected}
                    title={isStairs ? undefined : 'Inspect this feature'}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
                  >
                    <span className="text-base shrink-0" aria-hidden>
                      {kind === 'door' && '🚪'}
                      {kind === 'secret_door' && '🤫'}
                      {kind === 'chest' && '📦'}
                      {kind === 'trap' && '⚠️'}
                      {kind === 'stairs_down' && '🪜'}
                      {kind === 'stairs_up' && '🪜'}
                      {kind === 'lever' && '🕹️'}
                      {kind === 'shrine' && '✨'}
                      {kind === 'furniture' && '🪑'}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-bold text-slate-200 capitalize truncate">
                        {prop.id.replace(/[-_]/g, ' ')}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        {kind.replace(/_/g, ' ')} &middot;{' '}
                        <span
                          className={`font-semibold ${
                            state === 'open'
                              ? 'text-emerald-400'
                              : state === 'locked'
                                ? 'text-amber-400'
                                : state === 'disarmed'
                                  ? 'text-sky-400'
                                  : 'text-slate-300'
                          }`}
                        >
                          {state}
                        </span>
                        {!isStairs && <span className="text-slate-500"> &middot; click to inspect</span>}
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Open chest inventory shortcut (explicit user action) */}
                    {kind === 'chest' && state === 'open' && (
                      <button
                        type="button"
                        data-testid={`prop-loot-chest-btn-${prop.id}`}
                        onClick={onOpenLootInventory}
                        className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors"
                      >
                        Loot Chest
                      </button>
                    )}

                    {/* Stairs Controls */}
                    {kind === 'stairs_down' && onDescendStairs && (
                      <button
                        type="button"
                        data-testid="prop-descend-stairs-btn"
                        onClick={onDescendStairs}
                        className="px-3 py-1 rounded bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-md transition-colors"
                      >
                        Descend to Next Floor 🪜
                      </button>
                    )}

                    {kind === 'stairs_up' && onAscendStairs && (
                      <button
                        type="button"
                        data-testid="prop-ascend-stairs-btn"
                        onClick={onAscendStairs}
                        className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition-colors"
                      >
                        Ascend Stairs 🪜
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Party Exploration Strip */}
      <footer className="pointer-events-auto flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/90 backdrop-blur-md p-3 shadow-xl">
        <div className="flex flex-wrap items-center gap-3">
          {partyList.map((hero) => {
            const isLead = hero.id === leadExplorerId;
            const hpPct = Math.max(0, Math.min(100, (hero.currentHp / hero.maxHp) * 100));
            const sheet = hero.characterSheet;
            const firstClass = sheet?.classes?.[0];
            const className = firstClass ? `${firstClass.classId} ${firstClass.level}` : 'Hero';

            return (
              <div
                key={hero.id}
                data-testid={`party-member-card-${hero.id}`}
                onClick={() => onSelectLeadExplorer(hero.id)}
                className={`flex items-center gap-2.5 p-2 rounded-lg border transition-all cursor-pointer ${
                  isLead
                    ? 'border-amber-500/80 bg-amber-500/10 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                    : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                }`}
              >
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-amber-300">
                    {hero.name.slice(0, 2).toUpperCase()}
                  </div>
                  {isLead && (
                    <span
                      title="Lead Explorer / Scout"
                      className="absolute -top-1.5 -right-1.5 text-xs select-none"
                    >
                      👑
                    </span>
                  )}
                </div>

                <div className="min-w-28 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-200 truncate max-w-20">
                      {hero.name}
                    </span>
                    <span className="text-[10px] text-slate-400 capitalize">
                      {className}
                    </span>
                  </div>

                  {/* HP Bar */}
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        hpPct > 50
                          ? 'bg-emerald-500'
                          : hpPct > 25
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${hpPct}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>
                      HP {hero.currentHp}/{hero.maxHp}
                    </span>
                    <span>AC {hero.armorClass}</span>
                  </div>

                  {/* Status indication: conditions + active buffs */}
                  {(hero.conditions.length > 0 || (hero.activeEffects?.length ?? 0) > 0) && (
                    <div
                      data-testid={`exploration-status-${hero.id}`}
                      className="flex flex-wrap items-center gap-1"
                    >
                      {hero.conditions.map((condition) => (
                        <span
                          key={condition}
                          className="px-1 py-0.2 rounded bg-amber-950 border border-amber-600 text-amber-200 font-bold text-[9px] uppercase"
                          title={condition}
                        >
                          {condition}
                        </span>
                      ))}
                      {(hero.activeEffects ?? []).slice(0, 3).map((effect) => (
                        <span
                          key={effect.effectId}
                          className="px-1 py-0.2 rounded bg-emerald-950 border border-emerald-600 text-emerald-200 font-bold text-[9px]"
                          title={`${effect.name}${effect.remainingRounds !== undefined ? ` (${effect.remainingRounds} rounds left)` : ''}${effect.requiresConcentration ? ' [Concentration]' : ''}`}
                        >
                          ✨ {effect.name}
                        </span>
                      ))}
                      {(hero.activeEffects?.length ?? 0) > 3 && (
                        <span className="text-[9px] text-slate-400">
                          +{(hero.activeEffects?.length ?? 0) - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {onInspectCharacter && (
                  <button
                    type="button"
                    data-testid={`exploration-inspect-hero-${hero.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectCharacter(hero.id);
                    }}
                    title={`Open character sheet for ${hero.name} (shows buffs, conditions & inventory)`}
                    className="shrink-0 p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-amber-300 transition-colors text-xs"
                  >
                    📜
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="hidden md:flex items-center gap-3 text-xs text-slate-400">
          <div className="text-right">
            <div className="font-semibold text-slate-300">
              Lead Explorer: {leadExplorer?.name}
            </div>
            <div className="text-[11px] text-slate-500">
              Click any cell to move party &middot; Click hero to switch lead
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
