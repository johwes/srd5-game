import {
  SRD_LEGAL_ATTRIBUTION,
  defaultCompendium,
  getPregenCharacter,
} from '@srd5/data';
import { computeDerivedCharacter } from '@srd5/engine';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import {
  CharacterSheetDrawer,
  LevelUpModal,
  PartyRosterView,
} from '../components/roster/index.js';
import {
  MAX_PARTY_SIZE,
  createDefaultRosterData,
  createInMemoryRosterStorageAdapter,
  formatSrd5Filename,
  loadPersistedRoster,
  mergeImportedCharactersIntoRoster,
  movePartyMemberOrder,
  parseSrd5JsonImport,
  removeRosterCharacter,
  savePersistedRoster,
  serializeCharacterToSrd5Json,
  serializeRosterToSrd5Json,
  togglePartyMember,
  upsertRosterCharacter,
} from '../persistence/index.js';

afterEach(() => {
  cleanup();
});

describe('SRD-208: Character Sheet Drawer, Level-Up Modal, and .srd5.json Roster Persistence', () => {
  it('persists and reloads roster data and enforces 1-4 hero Active Party assembly rules', async () => {
    const adapter = createInMemoryRosterStorageAdapter();

    // 1. Default load returns the 4 iconic SRD heroes in activePartyIds
    const initial = await loadPersistedRoster(adapter);
    expect(initial.characters).toHaveLength(4);
    expect(initial.activePartyIds).toHaveLength(4);

    // 2. Attempting to add a 5th hero to activePartyIds while 4 are active is blocked
    const customHero = {
      ...getPregenCharacter('pregen-fighter')!,
      id: 'hero-fifth-paladin',
      name: 'Valerius Dawnshield',
    };
    const withFifth = upsertRosterCharacter(initial, customHero, {
      addToPartyIfRoom: true,
    });
    expect(withFifth.characters).toHaveLength(5);
    expect(withFifth.activePartyIds).toHaveLength(MAX_PARTY_SIZE);

    const fullToggle = togglePartyMember(withFifth, 'hero-fifth-paladin');
    expect(fullToggle.inParty).toBe(false);
    expect(fullToggle.error).toContain('maximum 4 heroes');

    // 3. Remove 1 party member -> now 3 in party -> add the 5th hero -> 4 in party
    const afterRemoveOne = togglePartyMember(withFifth, 'pregen-rogue');
    expect(afterRemoveOne.inParty).toBe(false);
    expect(afterRemoveOne.roster.activePartyIds).toHaveLength(3);

    const afterAddFifth = togglePartyMember(
      afterRemoveOne.roster,
      'hero-fifth-paladin',
    );
    expect(afterAddFifth.inParty).toBe(true);
    expect(afterAddFifth.roster.activePartyIds).toEqual([
      'pregen-fighter',
      'pregen-wizard',
      'pregen-cleric',
      'hero-fifth-paladin',
    ]);

    // 4. Reorder marching order and persist/reload
    const reordered = movePartyMemberOrder(
      afterAddFifth.roster,
      'hero-fifth-paladin',
      'up',
    );
    expect(reordered.activePartyIds[2]).toBe('hero-fifth-paladin');

    await savePersistedRoster(reordered, adapter);
    const reloaded = await loadPersistedRoster(adapter);
    expect(reloaded.characters).toHaveLength(5);
    expect(reloaded.activePartyIds).toEqual(reordered.activePartyIds);

    // 5. Removing a character removes them from both characters and activePartyIds
    const afterDelete = removeRosterCharacter(reloaded, 'hero-fifth-paladin');
    expect(afterDelete.characters).toHaveLength(4);
    expect(afterDelete.activePartyIds).not.toContain('hero-fifth-paladin');
  });

  it('exports and imports .srd5.json character and party files with CC-BY-4.0 attribution and Product Identity guardrails', () => {
    const fighter = getPregenCharacter('pregen-fighter')!;
    const filename = formatSrd5Filename(fighter.name, 'character');
    expect(filename).toBe('garrick-vance.srd5.json');

    // 1. Single-character .srd5.json export & round-trip import
    const charJson = serializeCharacterToSrd5Json(fighter);
    expect(JSON.parse(charJson).legalAttribution).toBe(SRD_LEGAL_ATTRIBUTION);
    expect(charJson).toContain('"format": "srd5-character"');

    const parsedChar = parseSrd5JsonImport(charJson);
    expect(parsedChar.ok).toBe(true);
    if (parsedChar.ok) {
      expect(parsedChar.format).toBe('srd5-character');
      expect(parsedChar.characters[0]?.name).toBe(fighter.name);
    }

    // 2. Full Party Roster .srd5.json export & round-trip import
    const defaultRoster = createDefaultRosterData();
    const rosterJson = serializeRosterToSrd5Json(defaultRoster);
    expect(JSON.parse(rosterJson).legalAttribution).toBe(SRD_LEGAL_ATTRIBUTION);
    expect(rosterJson).toContain('"format": "srd5-roster"');

    const parsedRoster = parseSrd5JsonImport(rosterJson);
    expect(parsedRoster.ok).toBe(true);
    if (parsedRoster.ok) {
      expect(parsedRoster.format).toBe('srd5-roster');
      expect(parsedRoster.characters).toHaveLength(4);
      const merged = mergeImportedCharactersIntoRoster(
        createDefaultRosterData(),
        parsedRoster,
        { replaceActiveParty: true },
      );
      expect(merged.activePartyIds).toHaveLength(4);
    }

    // 3. Rejects non-SRD Product Identity proper names & monsters on import
    const piChar = {
      ...fighter,
      name: 'Mordenkainen the Mind Flayer',
    };
    const piResult = parseSrd5JsonImport(serializeCharacterToSrd5Json(piChar));
    expect(piResult.ok).toBe(false);
    if (!piResult.ok) {
      expect(piResult.errors.join(' ')).toContain('Product Identity');
    }

    // 4. Rejects malformed JSON
    const badJsonResult = parseSrd5JsonImport('{ invalid json ');
    expect(badJsonResult.ok).toBe(false);
  });

  it('renders CharacterSheetDrawer with interactive formula breakdowns, equipment paperdoll, spell preparation, and XP awards', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    let currentChar = structuredClone(wizard);
    const onClose = vi.fn();
    const onOpenLevelUp = vi.fn();

    const { rerender } = render(
      <CharacterSheetDrawer
        character={currentChar}
        onClose={onClose}
        onOpenLevelUp={onOpenLevelUp}
        onUpdateCharacter={(updated) => {
          currentChar = updated;
        }}
      />,
    );

    // Verify identity & default AC formula breakdown in Formula Inspector
    expect(screen.getByTestId('sheet-character-name').textContent).toBe(
      wizard.name,
    );
    expect(screen.getByTestId('sheet-ac-value').textContent).toBe('13');
    expect(
      screen.getByTestId('sheet-formula-inspector-summary').textContent,
    ).toContain('Unarmored');

    // Click INT ability score to inspect its formula breakdown
    fireEvent.click(screen.getByTestId('sheet-inspect-ability-int'));
    expect(
      screen.getByTestId('sheet-formula-inspector-total').textContent,
    ).toBe('16 (+3)');
    expect(
      screen.getByTestId('sheet-formula-inspector-summary').textContent,
    ).toContain('Base Score (15)');

    // Click Arcana skill row to inspect its formula breakdown
    fireEvent.click(screen.getByTestId('sheet-skill-row-arcana'));
    expect(
      screen.getByTestId('sheet-formula-inspector-total').textContent,
    ).toBe('+5');

    // Award 350 XP -> unlocks Level 2 Ready badge
    fireEvent.change(screen.getByTestId('sheet-award-xp-input'), {
      target: { value: '350' },
    });
    fireEvent.click(screen.getByTestId('sheet-award-xp-btn'));
    rerender(
      <CharacterSheetDrawer
        character={currentChar}
        onClose={onClose}
        onOpenLevelUp={onOpenLevelUp}
        onUpdateCharacter={(updated) => {
          currentChar = updated;
        }}
      />,
    );
    expect(screen.getByTestId('sheet-xp-ready-badge')).toBeDefined();

    // Switch to Spellbook & Preparation tab and toggle a prepared spell
    fireEvent.click(screen.getByTestId('sheet-tab-spells'));
    expect(screen.getByTestId('sheet-panel-spells')).toBeDefined();
    expect(screen.getByTestId('sheet-prepared-counter').textContent).toContain(
      '4 / 4 Prepared',
    );

    // Unprepare magic-missile -> 3 / 4 Prepared
    fireEvent.click(screen.getByTestId('sheet-prep-spell-toggle-magic-missile'));
    rerender(
      <CharacterSheetDrawer
        character={currentChar}
        onClose={onClose}
        onOpenLevelUp={onOpenLevelUp}
        onUpdateCharacter={(updated) => {
          currentChar = updated;
        }}
      />,
    );
    expect(screen.getByTestId('sheet-prepared-counter').textContent).toContain(
      '3 / 4 Prepared',
    );

    // Switch to Equipment tab on Fighter and test unequipping shield updates AC live (19 -> 17)
    let fighterChar = structuredClone(getPregenCharacter('pregen-fighter')!);
    rerender(
      <CharacterSheetDrawer
        character={fighterChar}
        onClose={onClose}
        onUpdateCharacter={(updated) => {
          fighterChar = updated;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('sheet-tab-equipment'));
    expect(screen.getByTestId('sheet-panel-equipment')).toBeDefined();

    // Inspect Longsword attack profile breakdown
    fireEvent.click(screen.getByTestId('sheet-attack-profile-longsword'));
    expect(
      screen.getByTestId('sheet-formula-inspector-summary').textContent,
    ).toContain('Attack Roll: 1d20');

    // Unequip Shield -> AC drops from 19 to 17
    fireEvent.click(screen.getByTestId('sheet-paperdoll-slot-shield'));
    const updatedDerived = computeDerivedCharacter(
      fighterChar,
      defaultCompendium,
    );
    expect(updatedDerived.armorClass.totalAc).toBe(17);

    // Paperdoll shows the loadout graphically: shield slot is now empty,
    // main hand still shows the longsword icon slot.
    rerender(
      <CharacterSheetDrawer
        character={fighterChar}
        onClose={onClose}
        onUpdateCharacter={(updated) => {
          fighterChar = updated;
        }}
      />,
    );
    expect(screen.getByTestId('sheet-paperdoll-slot-shield').textContent).toContain(
      'No Shield',
    );
    expect(screen.getByTestId('sheet-paperdoll-slot-mainHand').textContent).toContain(
      'Longsword',
    );

    // Equip the handaxe to the main hand from the inventory row.
    fireEvent.click(screen.getByTestId('sheet-inventory-equip-fighter-handaxe-mainHand'));
    rerender(
      <CharacterSheetDrawer
        character={fighterChar}
        onClose={onClose}
        onUpdateCharacter={(updated) => {
          fighterChar = updated;
        }}
      />,
    );
    expect(fighterChar.equippedSlots.mainHandInstanceId).toBe('fighter-handaxe');
    expect(screen.getByTestId('sheet-paperdoll-slot-mainHand').textContent).toContain(
      'Handaxe',
    );
  });

  it('levels up characters through LevelUpModal (Fixed/Rolled HP, Subclass unlock, Spellbook additions, and L4 ASI/Feat)', () => {
    // 1. Level up Wizard from L1 -> L2 (requires Evocation Arcane Tradition subclass + 2 Spellbook spells)
    const wizardL1 = getPregenCharacter('pregen-wizard')!;
    const onApplyWizard = vi.fn();

    const { unmount } = render(
      <LevelUpModal
        character={wizardL1}
        onClose={() => {}}
        onApplyLevelUp={onApplyWizard}
      />,
    );

    expect(screen.getByTestId('level-up-subclass-section')).toBeDefined();
    expect(screen.getByTestId('level-up-spellcasting-section')).toBeDefined();
    // Confirm button is disabled until subclass + 2 spellbook spells are chosen
    expect(
      (screen.getByTestId('level-up-confirm-btn') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Select School of Evocation subclass
    fireEvent.click(screen.getByTestId('level-up-subclass-card-evocation'));

    // Select 2 new Wizard spellbook spells
    const spellOptions = screen.getAllByTestId(/^level-up-spellbook-option-/);
    fireEvent.click(spellOptions[0]!);
    fireEvent.click(spellOptions[1]!);

    expect(
      (screen.getByTestId('level-up-confirm-btn') as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByTestId('level-up-confirm-btn'));
    expect(onApplyWizard).toHaveBeenCalledTimes(1);
    const leveledWizard = onApplyWizard.mock.calls[0]![0];
    expect(leveledWizard.classes[0].level).toBe(2);
    expect(leveledWizard.classes[0].subclassId).toBe('evocation');
    expect(leveledWizard.spellcasting.spellbookSpellIds).toHaveLength(8);
    unmount();

    // 2. Level up a Level 3 Fighter to Level 4 (requires ASI +2 STR or Feat)
    const fighterL1 = getPregenCharacter('pregen-fighter')!;
    const fighterL3 = {
      ...fighterL1,
      classes: [
        {
          ...fighterL1.classes[0]!,
          subclassId: 'champion',
          level: 3,
          hpRollsByLevel: [10, 6, 6],
        },
      ],
    };
    const onApplyFighter = vi.fn();
    render(
      <LevelUpModal
        character={fighterL3}
        onClose={() => {}}
        onApplyLevelUp={onApplyFighter}
      />,
    );

    expect(screen.getByTestId('level-up-asi-section')).toBeDefined();
    expect(
      (screen.getByTestId('level-up-confirm-btn') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Switch HP method to Seeded Roll and back to Fixed Average
    fireEvent.click(screen.getByTestId('level-up-hp-method-roll'));
    expect(screen.getByTestId('level-up-reroll-hp-btn')).toBeDefined();
    fireEvent.click(screen.getByTestId('level-up-hp-method-fixed'));

    // Pick +2 STR ASI
    fireEvent.click(screen.getByTestId('level-up-asi-plus2-str'));
    expect(
      (screen.getByTestId('level-up-confirm-btn') as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByTestId('level-up-confirm-btn'));
    expect(onApplyFighter).toHaveBeenCalledTimes(1);
    const fighterL4 = onApplyFighter.mock.calls[0]![0];
    const summaryL4 = onApplyFighter.mock.calls[0]![1];
    expect(fighterL4.classes[0].level).toBe(4);
    expect(summaryL4.newTotalLevel).toBe(4);
    expect(summaryL4.abilityScoreChanges[0]?.ability).toBe('str');
    expect(summaryL4.abilityScoreChanges[0]?.newScore).toBe(18);
  });

  it('integrates Builder, Party Roster, Character Sheet Drawer, Level-Up Modal, and .srd5.json Import/Export in App shell', async () => {
    const adapter = createInMemoryRosterStorageAdapter();
    render(<App initialView="roster" storageAdapter={adapter} />);

    // Wait for initial roster load
    await waitFor(() => {
      expect(screen.getByTestId('party-roster-view')).toBeDefined();
    });
    expect(screen.getByTestId('roster-active-party-badge').textContent).toContain(
      'Active Party: 4 / 4 Heroes',
    );

    // Open Character Sheet Drawer from Roster card
    fireEvent.click(screen.getByTestId('roster-inspect-sheet-pregen-fighter'));
    expect(screen.getByTestId('character-sheet-drawer')).toBeDefined();
    fireEvent.click(screen.getByTestId('sheet-close-btn'));
    expect(screen.queryByTestId('character-sheet-drawer')).toBeNull();

    // Level up Fighter from L1 -> L2 directly from Roster
    fireEvent.click(screen.getByTestId('roster-level-up-pregen-fighter'));
    expect(screen.getByTestId('level-up-modal')).toBeDefined();
    fireEvent.click(screen.getByTestId('level-up-confirm-btn'));
    expect(screen.queryByTestId('level-up-modal')).toBeNull();
    expect(
      screen.getByTestId('roster-hero-level-pregen-fighter').textContent,
    ).toBe('Level 2');

    // Export character to .srd5.json modal and inspect JSON
    fireEvent.click(screen.getByTestId('roster-export-char-pregen-fighter'));
    expect(screen.getByTestId('roster-srd5-json-modal')).toBeDefined();
    const exportedText = (
      screen.getByTestId('roster-json-textarea') as HTMLTextAreaElement
    ).value;
    expect(exportedText).toContain('"level": 2');
    fireEvent.click(screen.getByTestId('roster-json-modal-close-btn'));

    // Import a new custom hero via .srd5.json Import Modal
    const customRanger = {
      ...getPregenCharacter('pregen-rogue')!,
      id: 'imported-hero-lyra',
      name: 'Lyra Swiftbow',
    };
    fireEvent.click(screen.getByTestId('roster-open-import-btn'));
    fireEvent.change(screen.getByTestId('roster-json-textarea'), {
      target: { value: serializeCharacterToSrd5Json(customRanger) },
    });
    fireEvent.click(screen.getByTestId('roster-confirm-import-btn'));

    expect(
      screen.getByTestId('roster-hero-card-imported-hero-lyra'),
    ).toBeDefined();
    expect(
      within(
        screen.getByTestId('roster-hero-card-imported-hero-lyra'),
      ).getByText('Lyra Swiftbow'),
    ).toBeDefined();
  });
});
