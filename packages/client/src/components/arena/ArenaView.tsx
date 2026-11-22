import React, { useState } from 'react';
import {
  type CharacterBuildState,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import { ArenaCombatView } from './ArenaCombatView.js';
import { ArenaSetupView } from './ArenaSetupView.js';
import type { ArenaConfig } from './types.js';

export interface ArenaViewProps {
  rosterCharacters?: CharacterBuildState[];
  compendium?: SrdCompendium;
  onOpenCharacterSheet?: (characterId: string) => void;
  /** BG3-style Character view opener (preferred `C`/`I` target; sheet is the fallback). */
  onOpenCharacterView?: (characterId: string) => void;
  /** SRD-1601: toggle the Character view for the focused hero (`C`/`I` shortcut). */
  onToggleCharacterView?: (characterId: string) => void;
  onBackToRoster?: () => void;
}

/**
 * Root Arena Controller View toggling between ArenaSetupView and ArenaCombatView.
 */
export function ArenaView({
  rosterCharacters = [],
  compendium = defaultCompendium,
  onOpenCharacterSheet,
  onOpenCharacterView,
  onToggleCharacterView,
  onBackToRoster,
}: ArenaViewProps) {
  const [activeConfig, setActiveConfig] = useState<ArenaConfig | null>(null);

  if (activeConfig) {
    return (
      <ArenaCombatView
        config={activeConfig}
        partyCharacters={rosterCharacters}
        compendium={compendium}
        onExitToSetup={() => setActiveConfig(null)}
        onOpenCharacterSheet={onOpenCharacterSheet}
        onOpenCharacterView={onOpenCharacterView}
        onToggleCharacterView={onToggleCharacterView}
      />
    );
  }

  return (
    <ArenaSetupView
      rosterCharacters={rosterCharacters}
      compendium={compendium}
      onLaunchArena={(config) => setActiveConfig(config)}
      onBackToRoster={onBackToRoster}
    />
  );
}
