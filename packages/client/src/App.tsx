import { useEffect, useState } from 'react';
import {
  type CharacterBuildState,
  SRD_LEGAL_ATTRIBUTION,
  SRD_VERSION,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { type GameState } from '@srd5/engine';
import { getTransportInfo } from '@srd5/transport';
import { CharacterBuilderWizard } from './components/builder/index.js';
import { CompendiumBrowser } from './components/compendium/index.js';
import {
  CharacterSheetDrawer,
  LevelUpModal,
  PartyRosterView,
} from './components/roster/index.js';
import { ArenaView } from './components/arena/index.js';
import { DungeonView } from './components/dungeon/index.js';
import { TitleMenuView } from './components/title/index.js';
import { CampaignSetupWizard, type CampaignLaunchConfig } from './components/campaign/index.js';
import {
  MAX_PARTY_SIZE,
  type PersistedRosterData,
  type RosterStorageAdapter,
  type DungeonStorageAdapter,
  createDefaultRosterData,
  defaultRosterStorageAdapter,
  defaultDungeonStorageAdapter,
  formatSrd5Filename,
  loadStoredRosterIfPresent,
  resetPersistedRosterToIconics,
  savePersistedRoster,
  serializeCharacterToSrd5Json,
  triggerSrd5FileDownload,
  upsertRosterCharacter,
} from './persistence/index.js';

export type AppViewMode =
  | 'title_menu'
  | 'campaign_setup'
  | 'gameplay'
  | 'character_vault'
  | 'character_builder'
  | 'compendium'
  | 'settings'
  | 'builder'
  | 'roster'
  | 'arena'
  | 'dungeon'
  | 'roguelite';

export interface AppProps {
  initialView?: AppViewMode;
  storageAdapter?: RosterStorageAdapter;
  dungeonStorageAdapter?: DungeonStorageAdapter;
}

export function App({
  initialView = 'title_menu',
  storageAdapter = defaultRosterStorageAdapter,
  dungeonStorageAdapter = defaultDungeonStorageAdapter,
}: AppProps) {
  const [activeView, setActiveView] = useState<AppViewMode>(initialView);
  const [loadedGameState, setLoadedGameState] = useState<GameState | undefined>(
    undefined,
  );
  const [roster, setRoster] = useState<PersistedRosterData>(() =>
    createDefaultRosterData(),
  );
  const [builderTargetCharacter, setBuilderTargetCharacter] = useState<
    CharacterBuildState | undefined
  >(undefined);
  const [sheetCharacterId, setSheetCharacterId] = useState<string | null>(null);
  const [sheetFallbackCharacter, setSheetFallbackCharacter] =
    useState<CharacterBuildState | null>(null);
  const [levelUpCharacterId, setLevelUpCharacterId] = useState<string | null>(
    null,
  );

  const transportInfo = getTransportInfo();

  // Load persisted roster on mount if stored
  useEffect(() => {
    let active = true;
    void loadStoredRosterIfPresent(storageAdapter).then((loaded) => {
      if (active && loaded) {
        setRoster(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [storageAdapter]);

  // Global keyboard shortcut ('C' or 'I') to toggle Character Sheet Drawer (`docs/spec/05-multiplayer-and-ui.md` Section 4.2)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'c' || key === 'i') {
        if (sheetCharacterId || sheetFallbackCharacter) {
          setSheetCharacterId(null);
          setSheetFallbackCharacter(null);
        } else {
          const firstPartyChar =
            roster.characters.find((c) => c.id === roster.activePartyIds[0]) ??
            roster.characters[0];
          if (firstPartyChar) {
            setSheetCharacterId(firstPartyChar.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [roster, sheetCharacterId, sheetFallbackCharacter]);

  const persistAndSetRoster = (nextRoster: PersistedRosterData) => {
    setRoster(nextRoster);
    void savePersistedRoster(nextRoster, storageAdapter);
  };

  const handleSaveCharacterFromBuilder = (character: CharacterBuildState) => {
    const nextRoster = upsertRosterCharacter(roster, character, {
      addToPartyIfRoom: true,
    });
    persistAndSetRoster(nextRoster);
  };

  const handleInspectCharacter = (character: CharacterBuildState) => {
    const inRoster = roster.characters.some((c) => c.id === character.id);
    if (inRoster) {
      setSheetCharacterId(character.id);
      setSheetFallbackCharacter(null);
    } else {
      setSheetCharacterId(null);
      setSheetFallbackCharacter(character);
    }
  };

  const handleUpdateCharacterFromSheetOrLevelUp = (
    updated: CharacterBuildState,
  ) => {
    if (roster.characters.some((c) => c.id === updated.id)) {
      const nextRoster = upsertRosterCharacter(roster, updated, {
        addToPartyIfRoom: false,
      });
      persistAndSetRoster(nextRoster);
    } else if (sheetFallbackCharacter?.id === updated.id) {
      setSheetFallbackCharacter(updated);
    }
  };

  const activeSheetCharacter = sheetCharacterId
    ? (roster.characters.find((c) => c.id === sheetCharacterId) ?? null)
    : sheetFallbackCharacter;

  const activeLevelUpCharacter = levelUpCharacterId
    ? (roster.characters.find((c) => c.id === levelUpCharacterId) ??
      (sheetFallbackCharacter?.id === levelUpCharacterId
        ? sheetFallbackCharacter
        : null))
    : null;

  if (activeView === 'title_menu') {
    return (
      <>
        <TitleMenuView
          storageAdapter={dungeonStorageAdapter}
          onContinue={(slot) => {
            setLoadedGameState(slot.gameState);
            setActiveView('dungeon');
          }}
          onNewGame={() => {
            setLoadedGameState(undefined);
            setActiveView('campaign_setup');
          }}
          onLoadSlot={(slot) => {
            setLoadedGameState(slot.gameState);
            setActiveView('dungeon');
          }}
          onOpenVault={() => setActiveView('roster')}
          onOpenBuilder={() => {
            setBuilderTargetCharacter(undefined);
            setActiveView('builder');
          }}
          onOpenCompendium={() => setActiveView('compendium')}
          onOpenArena={() => setActiveView('arena')}
        />

        {activeSheetCharacter && (
          <CharacterSheetDrawer
            character={activeSheetCharacter}
            compendium={defaultCompendium}
            onClose={() => {
              setSheetCharacterId(null);
              setSheetFallbackCharacter(null);
            }}
            onUpdateCharacter={handleUpdateCharacterFromSheetOrLevelUp}
            onOpenLevelUp={(hero) => setLevelUpCharacterId(hero.id)}
            onExportCharacter={(hero) => {
              const content = serializeCharacterToSrd5Json(hero);
              const filename = formatSrd5Filename(hero.name, 'character');
              triggerSrd5FileDownload(filename, content);
            }}
          />
        )}
      </>
    );
  }

  if (activeView === 'campaign_setup') {
    return (
      <>
        <CampaignSetupWizard
          initialMode="campaign_kaelen"
          initialParty={
            roster.characters.filter((c) => roster.activePartyIds.includes(c.id)).length > 0
              ? roster.characters.filter((c) => roster.activePartyIds.includes(c.id))
              : [
                  getPregenCharacter('pregen-fighter')!,
                  getPregenCharacter('pregen-rogue')!,
                  getPregenCharacter('pregen-wizard')!,
                  getPregenCharacter('pregen-cleric')!,
                ].filter(Boolean)
          }
          availableRosterCharacters={roster.characters}
          onBackToMenu={() => setActiveView('title_menu')}
          onLaunch={(config: CampaignLaunchConfig) => {
            setLoadedGameState(undefined);
            if (config.party.length > 0) {
              const nextRoster = {
                ...roster,
                activePartyIds: config.party.map((c) => c.id),
                characters: [
                  ...roster.characters.filter(
                    (rc) => !config.party.some((c) => c.id === rc.id),
                  ),
                  ...config.party,
                ],
              };
              persistAndSetRoster(nextRoster);
            }
            if (config.mode === 'campaign_kaelen') {
              setActiveView('dungeon');
            } else if (config.mode === 'deep_descent') {
              setActiveView('roguelite');
            } else if (config.mode === 'arena') {
              setActiveView('arena');
            }
          }}
        />

        {activeSheetCharacter && (
          <CharacterSheetDrawer
            character={activeSheetCharacter}
            compendium={defaultCompendium}
            onClose={() => {
              setSheetCharacterId(null);
              setSheetFallbackCharacter(null);
            }}
            onUpdateCharacter={handleUpdateCharacterFromSheetOrLevelUp}
            onOpenLevelUp={(hero) => setLevelUpCharacterId(hero.id)}
            onExportCharacter={(hero) => {
              const content = serializeCharacterToSrd5Json(hero);
              const filename = formatSrd5Filename(hero.name, 'character');
              triggerSrd5FileDownload(filename, content);
            }}
          />
        )}
      </>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-3 sm:p-6 gap-4">
      <div className="max-w-7xl mx-auto w-full space-y-4 flex-1 flex flex-col">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-amber-400">
              SRD {SRD_VERSION} Tactical Dungeon Crawler
            </h1>
            <p className="mt-0.5 text-xs text-slate-400">
              Official SRD 5.1 Character Builder, Party Roster &amp; Compendium &middot;
              Engine v{transportInfo.engine.engineVersion} &middot; Transport v
              {transportInfo.transportVersion}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800">
              <button
                type="button"
                data-testid="app-nav-title"
                aria-pressed={false}
                onClick={() => setActiveView('title_menu')}
                className="px-3 py-1.5 rounded-md text-xs font-semibold transition-colors text-amber-400 hover:text-amber-300"
              >
                🏰 Title Menu
              </button>
              <button
                type="button"
                data-testid="app-nav-builder"
                aria-pressed={activeView === 'builder' || activeView === 'character_builder'}
                onClick={() => setActiveView('builder')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'builder' || activeView === 'character_builder'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Character Builder
              </button>
              <button
                type="button"
                data-testid="app-nav-roster"
                aria-pressed={activeView === 'roster' || activeView === 'character_vault'}
                onClick={() => setActiveView('roster')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'roster' || activeView === 'character_vault'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Party Roster ({roster.activePartyIds.length}/{MAX_PARTY_SIZE})
              </button>
              <button
                type="button"
                data-testid="app-nav-compendium"
                aria-pressed={activeView === 'compendium'}
                onClick={() => setActiveView('compendium')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'compendium'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                SRD 5.1 Compendium
              </button>
              <button
                type="button"
                data-testid="app-nav-arena"
                aria-pressed={activeView === 'arena'}
                onClick={() => setActiveView('arena')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'arena'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                ⚔️ The Arena
              </button>
              <button
                type="button"
                data-testid="app-nav-dungeon"
                aria-pressed={activeView === 'dungeon' || activeView === 'gameplay'}
                onClick={() => setActiveView('dungeon')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'dungeon' || activeView === 'gameplay'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                🏰 Dungeon Delve
              </button>
              <button
                type="button"
                data-testid="app-nav-roguelite"
                aria-pressed={activeView === 'roguelite'}
                onClick={() => setActiveView('roguelite')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'roguelite'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                💀 Deep Descent
              </button>
            </div>

            <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-amber-300 text-xs font-medium">
              {defaultCompendium.races.length} Races &middot;{' '}
              {defaultCompendium.classes.length} Classes &middot;{' '}
              {defaultCompendium.spells.length} Spells &middot;{' '}
              {defaultCompendium.monsters.length} Monsters
            </span>
          </div>
        </header>

        {(activeView === 'builder' || activeView === 'character_builder') && (
          <CharacterBuilderWizard
            compendium={defaultCompendium}
            initialCharacter={builderTargetCharacter}
            onSaveCharacter={handleSaveCharacterFromBuilder}
            onInspectCharacter={handleInspectCharacter}
          />
        )}

        {(activeView === 'roster' || activeView === 'character_vault') && (
          <PartyRosterView
            roster={roster}
            compendium={defaultCompendium}
            onUpdateRoster={persistAndSetRoster}
            onResetToIconics={() => {
              void resetPersistedRosterToIconics(storageAdapter).then((fresh) => {
                setRoster(fresh);
              });
            }}
            onInspectCharacter={handleInspectCharacter}
            onLevelUpCharacter={(hero) => setLevelUpCharacterId(hero.id)}
            onEnterArena={() => setActiveView('arena')}
            onEnterDungeon={() => setActiveView('dungeon')}
            onEditInBuilder={(hero) => {
              setBuilderTargetCharacter(hero);
              setActiveView('builder');
            }}
            onCreateNewHero={() => {
              setBuilderTargetCharacter(undefined);
              setActiveView('builder');
            }}
          />
        )}

        {activeView === 'compendium' && (
          <CompendiumBrowser compendium={defaultCompendium} />
        )}

        {activeView === 'arena' && (
          <ArenaView
            rosterCharacters={roster.characters.filter((c) =>
              roster.activePartyIds.includes(c.id),
            )}
            compendium={defaultCompendium}
            onOpenCharacterSheet={(charId) => {
              const char =
                roster.characters.find((c) => c.id === charId) ??
                getPregenCharacter(charId);
              if (char) {
                handleInspectCharacter(char);
              }
            }}
            onBackToRoster={() => setActiveView('roster')}
          />
        )}

        {(activeView === 'dungeon' || activeView === 'gameplay') && (
          <DungeonView
            partyCharacters={roster.characters.filter((c) =>
              roster.activePartyIds.includes(c.id),
            )}
            initialGameState={loadedGameState}
            compendium={defaultCompendium}
            gameMode="campaign"
            onOpenCharacterSheet={(charId) => {
              const char =
                roster.characters.find((c) => c.id === charId) ??
                getPregenCharacter(charId);
              if (char) {
                handleInspectCharacter(char);
              }
            }}
            onExitToRoster={() => setActiveView('title_menu')}
          />
        )}

        {activeView === 'roguelite' && (
          <DungeonView
            partyCharacters={roster.characters.filter((c) =>
              roster.activePartyIds.includes(c.id),
            )}
            compendium={defaultCompendium}
            gameMode="roguelite"
            onOpenCharacterSheet={(charId) => {
              const char =
                roster.characters.find((c) => c.id === charId) ??
                getPregenCharacter(charId);
              if (char) {
                handleInspectCharacter(char);
              }
            }}
            onExitToRoster={() => setActiveView('roster')}
          />
        )}
      </div>

      {/* Global Slide-Over Character Sheet Drawer */}
      {activeSheetCharacter && (
        <CharacterSheetDrawer
          character={activeSheetCharacter}
          compendium={defaultCompendium}
          onClose={() => {
            setSheetCharacterId(null);
            setSheetFallbackCharacter(null);
          }}
          onUpdateCharacter={handleUpdateCharacterFromSheetOrLevelUp}
          onOpenLevelUp={(hero) => setLevelUpCharacterId(hero.id)}
          onExportCharacter={(hero) => {
            const content = serializeCharacterToSrd5Json(hero);
            const filename = formatSrd5Filename(hero.name, 'character');
            triggerSrd5FileDownload(filename, content);
          }}
        />
      )}

      {/* Global Level-Up Progression Modal */}
      {activeLevelUpCharacter && (
        <LevelUpModal
          character={activeLevelUpCharacter}
          compendium={defaultCompendium}
          onClose={() => setLevelUpCharacterId(null)}
          onApplyLevelUp={(updatedChar) => {
            handleUpdateCharacterFromSheetOrLevelUp(updatedChar);
            setLevelUpCharacterId(null);
          }}
        />
      )}

      <footer className="max-w-7xl mx-auto w-full border-t border-slate-800 pt-3 text-xs text-slate-500">
        <p>{SRD_LEGAL_ATTRIBUTION}</p>
      </footer>
    </main>
  );
}
