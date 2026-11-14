import { useEffect, useState } from 'react';
import {
  type CharacterBuildState,
  SRD_LEGAL_ATTRIBUTION,
  SRD_VERSION,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
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
import {
  MAX_PARTY_SIZE,
  type PersistedRosterData,
  type RosterStorageAdapter,
  createDefaultRosterData,
  defaultRosterStorageAdapter,
  formatSrd5Filename,
  loadStoredRosterIfPresent,
  resetPersistedRosterToIconics,
  savePersistedRoster,
  serializeCharacterToSrd5Json,
  triggerSrd5FileDownload,
  upsertRosterCharacter,
} from './persistence/index.js';

export type AppViewMode = 'builder' | 'roster' | 'compendium' | 'arena' | 'dungeon';

export interface AppProps {
  initialView?: AppViewMode;
  storageAdapter?: RosterStorageAdapter;
}

export function App({
  initialView = 'builder',
  storageAdapter = defaultRosterStorageAdapter,
}: AppProps) {
  const [activeView, setActiveView] = useState<AppViewMode>(initialView);
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

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-8 gap-6">
      <div className="max-w-7xl mx-auto w-full space-y-6 flex-1">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-amber-400">
              SRD {SRD_VERSION} Tactical Dungeon Crawler
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-400">
              Official SRD 5.1 Character Builder, Party Roster &amp; Compendium &middot;
              Engine v{transportInfo.engine.engineVersion} &middot; Transport v
              {transportInfo.transportVersion}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800">
              <button
                type="button"
                data-testid="app-nav-builder"
                aria-pressed={activeView === 'builder'}
                onClick={() => setActiveView('builder')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'builder'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Character Builder
              </button>
              <button
                type="button"
                data-testid="app-nav-roster"
                aria-pressed={activeView === 'roster'}
                onClick={() => setActiveView('roster')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'roster'
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
                aria-pressed={activeView === 'dungeon'}
                onClick={() => setActiveView('dungeon')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  activeView === 'dungeon'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                🏰 Dungeon Delve
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

        {activeView === 'builder' && (
          <CharacterBuilderWizard
            compendium={defaultCompendium}
            initialCharacter={builderTargetCharacter}
            onSaveCharacter={handleSaveCharacterFromBuilder}
            onInspectCharacter={handleInspectCharacter}
          />
        )}

        {activeView === 'roster' && (
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

        {activeView === 'dungeon' && (
          <DungeonView
            partyCharacters={roster.characters.filter((c) =>
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

      <footer className="max-w-7xl mx-auto w-full border-t border-slate-800 pt-4 text-xs text-slate-500">
        <p>{SRD_LEGAL_ATTRIBUTION}</p>
      </footer>
    </main>
  );
}
