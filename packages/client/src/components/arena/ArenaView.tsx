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
  onBackToRoster?: () => void;
}

/**
 * Root Arena Controller View toggling between ArenaSetupView and ArenaCombatView.
 */
export function ArenaView({
  rosterCharacters = [],
  compendium = defaultCompendium,
  onOpenCharacterSheet,
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
