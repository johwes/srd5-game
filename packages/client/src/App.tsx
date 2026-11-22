import { useEffect, useState } from 'react';
import {
  type CharacterBuildState,
  SRD_LEGAL_ATTRIBUTION,
  SRD_VERSION,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { type GameState } from '@srd5/engine';
import { type PlayerSlotAssignment, getTransportInfo } from '@srd5/transport';
import {
  MultiplayerLobby,
  getControlledCharacters,
  type MultiplayerMode,
} from './multiplayer/index.js';
import { CharacterBuilderWizard } from './components/builder/index.js';
import { CompendiumBrowser } from './components/compendium/index.js';
import {
  CharacterSheetDrawer,
  LevelUpModal,
  PartyRosterView,
} from './components/roster/index.js';
import { CharacterView } from './components/inventory/index.js';
import type { InventorySlotName } from './components/inventory/index.js';
import { ArenaView } from './components/arena/index.js';
import { DungeonView } from './components/dungeon/index.js';
import { RealmView } from './components/realm/index.js';
import { TitleMenuView } from './components/title/index.js';
import {
  CampaignSetupWizard,
  type CampaignLaunchConfig,
  type WizardStageNumber,
} from './components/campaign/index.js';
import type { VeteranRosterEntry } from '@srd5/engine';
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
  loadVeteranRoster,
  resetPersistedRosterToIconics,
  savePersistedRoster,
  saveVeteranRoster,
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
  | 'roguelite'
  | 'realm'
  | 'multiplayer_lobby';

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
  // SRD-1501: fullscreen BG3-style Character view (roster-backed shell).
  const [characterViewHeroId, setCharacterViewHeroId] = useState<string | null>(null);
  const [levelUpCharacterId, setLevelUpCharacterId] = useState<string | null>(
    null,
  );
  const [returnToPartySlot, setReturnToPartySlot] = useState<number | null>(null);
  const [wizardStage, setWizardStage] = useState<WizardStageNumber>(1);
  const [campaignParty, setCampaignParty] = useState<CharacterBuildState[] | undefined>(
    undefined,
  );
  const [multiplayerCharacterIds, setMultiplayerCharacterIds] = useState<string[] | null>(
    null,
  );
  const [isDailyDescentActive, setIsDailyDescentActive] = useState<boolean>(false);
  // SRD-1405: persistent retired-veteran roster (Heroes Remembered, Spec 13 §7).
  const [veterans, setVeterans] = useState<VeteranRosterEntry[]>([]);
  // SRD-1403: last New Game world options (Realm/Descent session config).
  const [launchWorldOptions, setLaunchWorldOptions] = useState<
    import('@srd5/engine').WorldOptions | undefined
  >(undefined);

  const transportInfo = getTransportInfo();

  // In a networked mission each seat commands only its assigned heroes.
  const missionPartyCharacters = roster.characters.filter((character) => {
    if (!roster.activePartyIds.includes(character.id)) return false;
    return multiplayerCharacterIds === null || multiplayerCharacterIds.includes(character.id);
  });

  // Load persisted roster on mount if stored
  useEffect(() => {
    let active = true;
    void loadStoredRosterIfPresent(storageAdapter).then((loaded) => {
      if (active && loaded) {
        setRoster(loaded);
      }
    });
    // SRD-1405: retired veterans persist in the delve IndexedDB store.
    void loadVeteranRoster(storageAdapter).then((loaded) => {
      if (active) {
        setVeterans(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, [storageAdapter]);

  // SRD-1405: hiring removes the veteran from the remembered roster.
  const handleHireVeteran = (veteranId: string) => {
    setVeterans((prev) => {
      const next = prev.filter((v) => v.veteranId !== veteranId);
      void saveVeteranRoster(next, storageAdapter);
      return next;
    });
  };

  // SRD-1405: releasing forgets a veteran (two-step confirmed in the UI).
  const handleReleaseVeteran = (veteranId: string) => {
    setVeterans((prev) => {
      const next = prev.filter((v) => v.veteranId !== veteranId);
      void saveVeteranRoster(next, storageAdapter);
      return next;
    });
  };

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
      addToPartyIfRoom: returnToPartySlot === null,
    });
    persistAndSetRoster(nextRoster);

    if (returnToPartySlot !== null) {
      const slotIdx = returnToPartySlot;
      setCampaignParty((prev) => {
        const base = prev ?? [
          getPregenCharacter('pregen-fighter')!,
          getPregenCharacter('pregen-rogue')!,
          getPregenCharacter('pregen-wizard')!,
          getPregenCharacter('pregen-cleric')!,
        ];
        const updated = [...base];
        updated[slotIdx] = character;
        return updated;
      });
      setReturnToPartySlot(null);
      setWizardStage(3);
      setActiveView('campaign_setup');
    }
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

  // SRD-1501: heroes shown in the fullscreen Character view (active party, roster fallback).
  const characterViewHeroes =
    roster.characters.filter((c) => roster.activePartyIds.includes(c.id)).length > 0
      ? roster.characters.filter((c) => roster.activePartyIds.includes(c.id))
      : roster.characters.slice(0, 4);
  const characterViewHero =
    characterViewHeroId !== null
      ? (characterViewHeroes.find((c) => c.id === characterViewHeroId) ?? characterViewHeroes[0] ?? null)
      : null;

  const SLOT_KEY_BY_SHORT: Record<InventorySlotName, 'armorInstanceId' | 'shieldInstanceId' | 'mainHandInstanceId' | 'offHandInstanceId' | 'rangedInstanceId'> = {
    armor: 'armorInstanceId',
    shield: 'shieldInstanceId',
    mainHand: 'mainHandInstanceId',
    offHand: 'offHandInstanceId',
    ranged: 'rangedInstanceId',
  };

  const handleCharacterViewEquip = (heroId: string, slot: InventorySlotName, instanceId: string | undefined) => {
    const hero = roster.characters.find((c) => c.id === heroId);
    if (!hero) return;
    const slotKey = SLOT_KEY_BY_SHORT[slot];
    const nextSlots = { ...hero.equippedSlots };
    if (!instanceId) {
      delete nextSlots[slotKey];
    } else {
      // One instance cannot occupy two slots: incoming assignment wins.
      for (const key of Object.values(SLOT_KEY_BY_SHORT)) {
        if (key !== slotKey && nextSlots[key] === instanceId) {
          delete nextSlots[key];
        }
      }
      nextSlots[slotKey] = instanceId;
    }
    handleUpdateCharacterFromSheetOrLevelUp({ ...hero, equippedSlots: nextSlots });
  };

  const handleCharacterViewAttune = (heroId: string, instanceId: string) => {
    const hero = roster.characters.find((c) => c.id === heroId);
    if (!hero || hero.attunedItemInstanceIds.includes(instanceId)) return;
    if (hero.attunedItemInstanceIds.length >= 3) return;
    handleUpdateCharacterFromSheetOrLevelUp({
      ...hero,
      attunedItemInstanceIds: [...hero.attunedItemInstanceIds, instanceId],
    });
  };

  const handleCharacterViewUnattune = (heroId: string, instanceId: string) => {
    const hero = roster.characters.find((c) => c.id === heroId);
    if (!hero) return;
    handleUpdateCharacterFromSheetOrLevelUp({
      ...hero,
      attunedItemInstanceIds: hero.attunedItemInstanceIds.filter((id) => id !== instanceId),
    });
  };

  const handleCharacterViewTransfer = (fromHeroId: string, instanceId: string, toHeroId: string) => {
    const from = roster.characters.find((c) => c.id === fromHeroId);
    const to = roster.characters.find((c) => c.id === toHeroId);
    if (!from || !to || fromHeroId === toHeroId) return;
    const inst = from.inventory.find((i) => i.instanceId === instanceId);
    if (!inst) return;
    const nextFromSlots = { ...from.equippedSlots };
    for (const key of Object.values(SLOT_KEY_BY_SHORT)) {
      if (nextFromSlots[key] === instanceId) delete nextFromSlots[key];
    }
    const nextFrom: CharacterBuildState = {
      ...from,
      inventory: from.inventory.filter((i) => i.instanceId !== instanceId),
      equippedSlots: nextFromSlots,
      attunedItemInstanceIds: from.attunedItemInstanceIds.filter((id) => id !== instanceId),
    };
    const nextTo: CharacterBuildState = {
      ...to,
      inventory: [...to.inventory, inst],
    };
    let nextRoster = upsertRosterCharacter(roster, nextFrom, { addToPartyIfRoom: false });
    nextRoster = upsertRosterCharacter(nextRoster, nextTo, { addToPartyIfRoom: false });
    persistAndSetRoster(nextRoster);
  };

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
            setMultiplayerCharacterIds(null);
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
          onOpenMultiplayer={() => setActiveView('multiplayer_lobby')}
          onDailyDescent={() => {
            setIsDailyDescentActive(true);
            setLoadedGameState(undefined);
            setActiveView('roguelite');
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
            onOpenCharacterView={(id) => setCharacterViewHeroId(id)}
            onExportCharacter={(hero) => {
              const content = serializeCharacterToSrd5Json(hero);
              const filename = formatSrd5Filename(hero.name, 'character');
              triggerSrd5FileDownload(filename, content);
            }}
          />
        )}
        {/* SRD-1501: fullscreen Character view shell (all branches). */}
        {characterViewHero && (
          <CharacterView
            heroes={characterViewHeroes}
            activeHeroId={characterViewHero.id}
            compendium={defaultCompendium}
            onSelectHero={(id) => setCharacterViewHeroId(id)}
            onClose={() => setCharacterViewHeroId(null)}
            onEquipItem={handleCharacterViewEquip}
            onAttuneItem={handleCharacterViewAttune}
            onUnattuneItem={handleCharacterViewUnattune}
            onTransferItem={handleCharacterViewTransfer}
          />
        )}
      </>
    );
  }

  if (activeView === 'campaign_setup') {
    return (
      <>
        <CampaignSetupWizard
          initialStage={wizardStage}
          initialMode="campaign_kaelen"
          initialParty={
            campaignParty ??
            (roster.characters.filter((c) => roster.activePartyIds.includes(c.id)).length > 0
              ? roster.characters.filter((c) => roster.activePartyIds.includes(c.id))
              : [
                  getPregenCharacter('pregen-fighter')!,
                  getPregenCharacter('pregen-rogue')!,
                  getPregenCharacter('pregen-wizard')!,
                  getPregenCharacter('pregen-cleric')!,
                ].filter(Boolean))
          }
          availableRosterCharacters={roster.characters}
          availableVeterans={veterans}
          onHireVeteran={handleHireVeteran}
          onReleaseVeteran={handleReleaseVeteran}
          onBackToMenu={() => {
            setWizardStage(1);
            setActiveView('title_menu');
          }}
          onRollNewHero={(slotIndex) => {
            setReturnToPartySlot(slotIndex);
            setBuilderTargetCharacter(undefined);
            setActiveView('builder');
          }}
          onLaunch={(config: CampaignLaunchConfig) => {
            setLoadedGameState(undefined);
            setMultiplayerCharacterIds(null);
            // SRD-1403: persist the Civ setup-screen session config for Realm/Descent.
            setLaunchWorldOptions(config.worldOptions);
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
            } else if (config.mode === 'realm') {
              setActiveView('realm');
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
            onOpenCharacterView={(id) => setCharacterViewHeroId(id)}
            onExportCharacter={(hero) => {
              const content = serializeCharacterToSrd5Json(hero);
              const filename = formatSrd5Filename(hero.name, 'character');
              triggerSrd5FileDownload(filename, content);
            }}
          />
        )}
        {characterViewHero && (
          <CharacterView
            heroes={characterViewHeroes}
            activeHeroId={characterViewHero.id}
            compendium={defaultCompendium}
            onSelectHero={(id) => setCharacterViewHeroId(id)}
            onClose={() => setCharacterViewHeroId(null)}
            onEquipItem={handleCharacterViewEquip}
            onAttuneItem={handleCharacterViewAttune}
            onUnattuneItem={handleCharacterViewUnattune}
            onTransferItem={handleCharacterViewTransfer}
          />
        )}
      </>
    );
  }

  if (activeView === 'multiplayer_lobby') {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100 p-3 sm:p-6">
        <MultiplayerLobby
          partyCharacters={roster.characters.filter((c) =>
            roster.activePartyIds.includes(c.id),
          )}
          compendium={defaultCompendium}
          onBack={() => setActiveView('title_menu')}
          onLaunch={(
            assignments: PlayerSlotAssignment[],
            mode: MultiplayerMode,
            localPlayerId: string,
          ) => {
            setMultiplayerCharacterIds(getControlledCharacters(assignments, localPlayerId));
            setActiveView(mode === 'pvp' ? 'arena' : 'dungeon');
          }}
        />
      </main>
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
                aria-pressed={(activeView as string) === 'arena'}
                onClick={() => setActiveView('arena')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  (activeView as string) === 'arena'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                ⚔️ The Arena
              </button>
              <button
                type="button"
                data-testid="app-nav-dungeon"
                aria-pressed={(activeView as string) === 'dungeon' || (activeView as string) === 'gameplay'}
                onClick={() => setActiveView('dungeon')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  (activeView as string) === 'dungeon' || (activeView as string) === 'gameplay'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                🏰 Dungeon Delve
              </button>
              <button
                type="button"
                data-testid="app-nav-roguelite"
                aria-pressed={(activeView as string) === 'roguelite'}
                onClick={() => setActiveView('roguelite')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  (activeView as string) === 'roguelite'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                💀 Deep Descent
              </button>
              <button
                type="button"
                data-testid="app-nav-realm"
                aria-pressed={(activeView as string) === 'realm'}
                onClick={() => setActiveView('realm')}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  (activeView as string) === 'realm'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                🗺️ The Realm
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
          <div className="space-y-3">
            {returnToPartySlot !== null && (
              <div
                data-testid="builder-return-slot-banner"
                className="rounded-xl border border-amber-600/40 bg-amber-950/30 p-3 flex items-center justify-between gap-2 text-xs text-amber-200"
              >
                <div className="flex items-center gap-2">
                  <span>🎲</span>
                  <span className="font-semibold">
                    Recruiting Hero for Campaign Party Slot {returnToPartySlot + 1}
                  </span>
                  <span className="text-slate-400">
                    &middot; Saving this character will automatically return them to your campfire lineup.
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="builder-cancel-return-btn"
                  onClick={() => {
                    setReturnToPartySlot(null);
                    setWizardStage(3);
                    setActiveView('campaign_setup');
                  }}
                  className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  ✕ Cancel &amp; Return to Setup
                </button>
              </div>
            )}
            <CharacterBuilderWizard
              compendium={defaultCompendium}
              initialCharacter={builderTargetCharacter}
              onSaveCharacter={handleSaveCharacterFromBuilder}
              onInspectCharacter={handleInspectCharacter}
            />
          </div>
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
            onOpenCharacterView={(id) => setCharacterViewHeroId(id)}
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
            rosterCharacters={missionPartyCharacters}
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
            partyCharacters={missionPartyCharacters}
            initialGameState={loadedGameState}
            compendium={defaultCompendium}
            gameMode="campaign"
            storageAdapter={dungeonStorageAdapter}
            onOpenCharacterSheet={(charId) => {
              const char =
                roster.characters.find((c) => c.id === charId) ??
                getPregenCharacter(charId);
              if (char) {
                handleInspectCharacter(char);
              }
            }}
            onOpenCharacterView={(id) => setCharacterViewHeroId(id)}
            onExitToRoster={() => setActiveView('title_menu')}
          />
        )}

        {activeView === 'realm' && (
          <RealmView
            partyCharacters={missionPartyCharacters}
            compendium={defaultCompendium}
            storageAdapter={dungeonStorageAdapter}
            worldOptions={launchWorldOptions}
            onSyncPartyBuilds={(updatedBuilds) => {
              let nextRoster = roster;
              let changed = false;
              for (const build of updatedBuilds) {
                if (nextRoster.characters.some((c) => c.id === build.id)) {
                  nextRoster = upsertRosterCharacter(nextRoster, build, {
                    addToPartyIfRoom: false,
                  });
                  changed = true;
                }
              }
              if (changed) {
                persistAndSetRoster(nextRoster);
              }
            }}
            onRemovePartyBuilds={(buildIds) => {
              // SRD-1405: retired veterans leave the vault roster as well.
              const removed = new Set(buildIds);
              persistAndSetRoster({
                ...roster,
                characters: roster.characters.filter((c) => !removed.has(c.id)),
                activePartyIds: roster.activePartyIds.filter((id) => !removed.has(id)),
                updatedAt: new Date().toISOString(),
              });
            }}
            onOpenCharacterSheet={(charId, liveBuild) => {
              if (liveBuild && !roster.characters.some((c) => c.id === charId)) {
                setSheetCharacterId(null);
                setSheetFallbackCharacter(liveBuild);
                return;
              }
              const char =
                liveBuild ??
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
            partyCharacters={missionPartyCharacters}
            initialGameState={loadedGameState}
            compendium={defaultCompendium}
            gameMode="roguelite"
            storageAdapter={dungeonStorageAdapter}
            isDaily={isDailyDescentActive}
            worldOptions={launchWorldOptions}
            onOpenCharacterSheet={(charId) => {
              const char =
                roster.characters.find((c) => c.id === charId) ??
                getPregenCharacter(charId);
              if (char) {
                handleInspectCharacter(char);
              }
            }}
            onOpenCharacterView={(id) => setCharacterViewHeroId(id)}
            onExitToRoster={() => {
              setIsDailyDescentActive(false);
              setActiveView('title_menu');
            }}
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
          onOpenCharacterView={(id) => setCharacterViewHeroId(id)}
          onExportCharacter={(hero) => {
            const content = serializeCharacterToSrd5Json(hero);
            const filename = formatSrd5Filename(hero.name, 'character');
            triggerSrd5FileDownload(filename, content);
          }}
        />
      )}

      {/* SRD-1501: fullscreen BG3-style Character view shell. */}
      {characterViewHero && (
        <CharacterView
          heroes={characterViewHeroes}
          activeHeroId={characterViewHero.id}
          compendium={defaultCompendium}
          onSelectHero={(id) => setCharacterViewHeroId(id)}
          onClose={() => setCharacterViewHeroId(null)}
          onEquipItem={handleCharacterViewEquip}
          onAttuneItem={handleCharacterViewAttune}
          onUnattuneItem={handleCharacterViewUnattune}
          onTransferItem={handleCharacterViewTransfer}
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
