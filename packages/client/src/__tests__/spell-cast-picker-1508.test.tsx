import { defaultCompendium, getPregenCharacter } from '@srd5/data';
import { computeDerivedCharacter, type DerivedCharacterSheet } from '@srd5/engine';
import type { PlayerViewCombatant } from '@srd5/transport';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TargetingCommitBar,
  buildCastSpellContext,
  useManualTargeting,
  type ManualTargetingDeps,
} from '../components/combat/index.js';
import {
  SpellCastPicker,
  findSpellSaveAbility,
  getEffectiveCastFormula,
  getSpellSlotOptions,
  getUpcastPreview,
  parseDiceRange,
} from '../components/combat/SpellCastPicker.js';
import { CharacterSpellbook } from '../components/inventory/CharacterSpellbook.js';
import type { PendingTarget } from '../utils/pendingTargeting.js';

afterEach(() => {
  cleanup();
});

const compendium = defaultCompendium;
const fireball = compendium.getSpell('fireball')!;
const cureWounds = compendium.getSpell('cure-wounds')!;
const magicMissile = compendium.getSpell('magic-missile')!;
const fireBolt = compendium.getSpell('fire-bolt')!;
const bless = compendium.getSpell('bless')!;

function makeWizardCombatant(overrides?: Partial<PlayerViewCombatant>): PlayerViewCombatant {
  const pregen = getPregenCharacter('pregen-wizard')!;
  const derivedSheet: DerivedCharacterSheet = computeDerivedCharacter(pregen, compendium);
  return {
    id: 'hero-wizard',
    name: derivedSheet.name,
    side: 'party',
    size: 'medium',
    position: { x: 2, y: 3 },
    speedFeet: derivedSheet.speedFeet,
    currentHp: derivedSheet.currentHp,
    maxHp: derivedSheet.maxHp,
    tempHp: 0,
    armorClass: derivedSheet.armorClass.totalAc,
    conditions: [],
    isDead: false,
    isStable: true,
    reactionAvailable: true,
    characterSheet: derivedSheet,
    ...overrides,
  };
}

describe('SRD-1508: cast-flow dice math helpers', () => {
  it('parseDiceRange computes exact min/max for plain and bonused formulas', () => {
    expect(parseDiceRange('8d6')).toEqual({ min: 8, max: 48 });
    expect(parseDiceRange('1d8 + 3')).toEqual({ min: 4, max: 11 });
    expect(parseDiceRange('2d6+1d8+2')).toEqual({ min: 5, max: 22 });
    // Unresolved variables or empty input cannot produce an exact range.
    expect(parseDiceRange('@spellMod')).toBeNull();
    expect(parseDiceRange('')).toBeNull();
  });

  it('getEffectiveCastFormula adds per-slot bonus dice above the base level', () => {
    // Fireball L3 -> L4: 8d6 + 1d6.
    expect(getEffectiveCastFormula('8d6', fireball, 3, null)).toBe('8d6');
    expect(getEffectiveCastFormula('8d6', fireball, 4, null)).toBe('8d6 + 1d6');
    expect(getEffectiveCastFormula('8d6', fireball, 5, null)).toBe('8d6 + 2d6');
    // No scaling path: base formula unchanged.
    expect(getEffectiveCastFormula('1d4 + 1', magicMissile, 2, null)).toBe('1d4 + 1');
  });

  it('getUpcastPreview names the bonus dice and the base level', () => {
    const fireballPreview = getUpcastPreview(fireball);
    expect(fireballPreview).toContain('1d6');
    expect(fireballPreview).toContain('3');
    const blessPreview = getUpcastPreview(bless);
    expect(blessPreview).toContain('additional creature');
  });

  it('findSpellSaveAbility locates nested saving throws', () => {
    expect(findSpellSaveAbility(fireball)).toBe('dex');
    expect(findSpellSaveAbility(bless)).toBeNull();
  });

  it('getSpellSlotOptions lists known pools at/above base, flagging exhausted ones', () => {
    const options = getSpellSlotOptions(cureWounds, {
      1: { available: 2, max: 2 },
      2: { available: 0, max: 2 },
      3: { available: 1, max: 1 },
    });
    expect(options.map((o) => o.level)).toEqual([1, 2, 3]);
    expect(options.find((o) => o.level === 2)?.disabled).toBe(true);
    expect(options.find((o) => o.level === 1)?.disabled).toBe(false);
    // Cantrips never take a slot picker.
    expect(getSpellSlotOptions(fireBolt, { 1: { available: 2, max: 2 } })).toEqual([]);
  });
});

describe('SRD-1508: SpellCastPicker inspect card', () => {
  it('previews exact upcast math: fireball 8-48 at L3, 9-54 at L4', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <SpellCastPicker
        spell={fireball}
        caster={null}
        spellSlots={{ 3: { available: 2, max: 3 }, 4: { available: 1, max: 2 } }}
        selectedSlot={3}
        onSelectSlot={onSelect}
      />,
    );
    expect(screen.getByTestId('spell-cast-picker')).toBeDefined();
    expect(screen.getByTestId('spell-cast-damage-range').textContent).toContain('8-48 Damage');
    expect(screen.getByTestId('spell-cast-dice-line').textContent).toContain('8d6 Fire');
    expect(screen.getByTestId('spell-cast-dice-line').textContent).toContain('half on successful save');
    expect(screen.getByTestId('spell-cast-range').textContent).toContain('150');
    expect(screen.getByTestId('spell-cast-save').textContent).toContain('DEX');
    expect(screen.getByTestId('spell-cast-cost').textContent).toContain('Level 3 Slot');
    expect(screen.getByTestId('spell-cast-upcast-preview').textContent).toContain('1d6');

    // Picking the L4 slot re-resolves the preview math exactly.
    fireEvent.click(screen.getByTestId('spell-cast-slot-4'));
    expect(onSelect).toHaveBeenCalledWith(4);
    rerender(
      <SpellCastPicker
        spell={fireball}
        caster={null}
        spellSlots={{ 3: { available: 2, max: 3 }, 4: { available: 1, max: 2 } }}
        selectedSlot={4}
        onSelectSlot={onSelect}
      />,
    );
    expect(screen.getByTestId('spell-cast-damage-range').textContent).toContain('9-54 Damage');
    expect(screen.getByTestId('spell-cast-cost').textContent).toContain('Level 4 Slot');
  });

  it('resolves @spellMod through the caster: cure wounds shows 4-11 healing', () => {
    const wizard = makeWizardCombatant();
    render(
      <SpellCastPicker
        spell={cureWounds}
        caster={wizard}
        spellSlots={{ 1: { available: 2, max: 2 }, 2: { available: 1, max: 2 } }}
        selectedSlot={1}
        onSelectSlot={() => {}}
      />,
    );
    expect(screen.getByTestId('spell-cast-damage-range').textContent).toContain('4-11 Healing');
  });

  it('renders unavailable slots visible-but-disabled', () => {
    render(
      <SpellCastPicker
        spell={cureWounds}
        caster={null}
        spellSlots={{ 1: { available: 2, max: 2 }, 2: { available: 0, max: 2 } }}
        selectedSlot={1}
        onSelectSlot={() => {}}
      />,
    );
    const exhausted = screen.getByTestId('spell-cast-slot-2') as HTMLButtonElement;
    expect(exhausted.disabled).toBe(true);
    expect(exhausted.textContent).toContain('0/2');
    // The available slot stays clickable.
    expect((screen.getByTestId('spell-cast-slot-1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('cantrips skip the slot picker entirely', () => {
    render(
      <SpellCastPicker
        spell={fireBolt}
        caster={null}
        spellSlots={{ 1: { available: 2, max: 2 } }}
        selectedSlot={0}
        onSelectSlot={() => {}}
      />,
    );
    expect(screen.getByTestId('spell-cast-damage-range')).toBeDefined();
    expect(document.querySelector('[data-testid="spell-cast-slots"]')).toBeNull();
    expect(document.querySelector('[data-testid="spell-cast-slot-1"]')).toBeNull();
    expect(screen.getByTestId('spell-cast-badge').textContent).toContain('Cantrip');
  });

  it('enforces the Bonus-Action casting rule inline', () => {
    render(
      <SpellCastPicker
        spell={fireball}
        caster={null}
        spellSlots={{ 3: { available: 2, max: 3 } }}
        selectedSlot={3}
        onSelectSlot={() => {}}
        bonusActionSpellCast
      />,
    );
    const warning = screen.getByTestId('spell-cast-warning');
    expect(warning.textContent).toMatch(/Bonus Action/i);
    expect(warning.textContent).toMatch(/cantrips/i);
  });

  it('warns when the selected slot pool is exhausted', () => {
    render(
      <SpellCastPicker
        spell={cureWounds}
        caster={null}
        spellSlots={{ 1: { available: 0, max: 2 } }}
        selectedSlot={1}
        onSelectSlot={() => {}}
      />,
    );
    expect(screen.getByTestId('spell-cast-warning').textContent).toContain(
      'No level 1 spell slots left',
    );
  });
});

describe('SRD-1508: commit-bar cast context + picker wiring', () => {
  const multiPending: PendingTarget = {
    kind: 'multi',
    spellId: 'magic-missile',
    slotLevel: 1,
    picked: [],
    maxTargets: 3,
    allowDuplicates: true,
    disposition: 'hostile',
    rangeFeet: 120,
    label: 'Magic Missile',
  };

  it('buildCastSpellContext resolves armed spells and rejects non-spell arms', () => {
    const wizard = makeWizardCombatant();
    const ctx = buildCastSpellContext(
      multiPending,
      wizard,
      compendium,
      false,
      () => {},
    );
    expect(ctx?.spell.id).toBe('magic-missile');
    expect(ctx?.selectedSlotLevel).toBe(1);
    expect(ctx?.caster?.id).toBe('hero-wizard');

    expect(
      buildCastSpellContext({ kind: 'none' }, wizard, compendium, false, () => {}),
    ).toBeNull();
    expect(
      buildCastSpellContext(
        { kind: 'single', action: 'attack', weaponId: 'longsword', disposition: 'hostile', rangeFeet: 5, label: 'Longsword' },
        wizard,
        compendium,
        false,
        () => {},
      ),
    ).toBeNull();
  });

  it('commit bar renders the picker for armed spells and re-slots without losing the arm', () => {
    const onSelect = vi.fn();
    const wizard = makeWizardCombatant();
    const ctx = buildCastSpellContext(multiPending, wizard, compendium, false, onSelect)!;
    render(
      <TargetingCommitBar
        pendingTarget={multiPending}
        pendingAoeFoes={[]}
        pendingAoeAllies={[]}
        pendingMultiNames={[]}
        friendlyFireOff={false}
        onConfirmMulti={() => {}}
        onConfirmAoe={() => {}}
        onCancel={() => {}}
        castSpell={ctx}
      />,
    );
    // Cast picker sits above the hint row while the multi arm stays live.
    expect(screen.getByTestId('targeting-cast-picker')).toBeDefined();
    expect(screen.getByTestId('targeting-hint').textContent).toMatch(/Magic Missile/);
    expect(screen.getByTestId('targeting-counter')).toBeDefined();
    fireEvent.click(screen.getByTestId('targeting-cast-slot-1'));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('commit bar omits the picker when no spell context is provided', () => {
    render(
      <TargetingCommitBar
        pendingTarget={multiPending}
        pendingAoeFoes={[]}
        pendingAoeAllies={[]}
        pendingMultiNames={[]}
        friendlyFireOff={false}
        onConfirmMulti={() => {}}
        onConfirmAoe={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.querySelector('[data-testid="targeting-cast-picker"]')).toBeNull();
    expect(screen.getByTestId('targeting-hint')).toBeDefined();
  });

  it('reslotSpell updates the slot (and multi budget) while preserving picks', () => {
    const wizard = makeWizardCombatant();
    const goblin: PlayerViewCombatant = {
      id: 'goblin-1',
      name: 'Goblin',
      side: 'monster',
      size: 'small',
      position: { x: 4, y: 4 },
      speedFeet: 30,
      currentHp: 7,
      maxHp: 7,
      tempHp: 0,
      armorClass: 15,
      conditions: [],
      isDead: false,
      isStable: false,
      reactionAvailable: true,
    };
    const combatants: Record<string, PlayerViewCombatant> = {
      [wizard.id]: wizard,
      [goblin.id]: goblin,
    };
    const deps: ManualTargetingDeps = {
      combatants,
      activeCombatant: wizard,
      activeCombatantId: wizard.id,
      isMonsterTurn: false,
      hoveredCell: null,
      compendium,
      showFeedback: () => {},
      dispatch: () => {},
      getCombatContext: () => ({}),
      onInspectCombatant: () => {},
    };
    function Harness() {
      const targeting = useManualTargeting(deps);
      const pending = targeting.pendingTarget;
      const slot = pending.kind === 'none' ? -1 : (pending as { slotLevel?: number }).slotLevel ?? -1;
      const max =
        pending.kind === 'multi' ? pending.maxTargets : pending.kind === 'single' ? 1 : 0;
      const picked = pending.kind === 'multi' ? pending.picked.join(',') : '';
      return (
        <div>
          <button type="button" data-testid="harness-arm" onClick={() => targeting.armSpell('magic-missile', 1)}>
            arm
          </button>
          <button type="button" data-testid="harness-pick" onClick={() => targeting.handleCombatantClick('goblin-1')}>
            pick
          </button>
          <button type="button" data-testid="harness-reslot" onClick={() => targeting.reslotSpell(2)}>
            reslot
          </button>
          <div data-testid="harness-slot">{slot}</div>
          <div data-testid="harness-max">{max}</div>
          <div data-testid="harness-picked">{picked}</div>
        </div>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByTestId('harness-arm'));
    expect(screen.getByTestId('harness-slot').textContent).toBe('1');
    fireEvent.click(screen.getByTestId('harness-pick'));
    expect(screen.getByTestId('harness-picked').textContent).toBe('goblin-1');
    fireEvent.click(screen.getByTestId('harness-reslot'));
    // Slot + upcast target budget update; the armed pick is preserved.
    expect(screen.getByTestId('harness-slot').textContent).toBe('2');
    expect(screen.getByTestId('harness-max').textContent).toBe('4');
    expect(screen.getByTestId('harness-picked').textContent).toBe('goblin-1');
  });
});

describe('SRD-1508: spellbook cell inspect step', () => {
  it('clicking a spellbook cell opens the shared picker preview with slot pips', () => {
    const wizard = getPregenCharacter('pregen-wizard')!;
    render(<CharacterSpellbook hero={wizard} compendium={compendium} />);
    fireEvent.click(screen.getByTestId('character-view-spellbook-cell-magic-missile'));
    const inspect = screen.getByTestId('character-view-spellbook-inspect');
    expect(inspect).toBeDefined();
    expect(
      screen.getByTestId('character-view-spellbook-inspect-picker'),
    ).toBeDefined();
    // Preview resolves through the hero sheet; slot pips render for L1.
    expect(
      screen.getByTestId('character-view-spellbook-inspect-damage-range').textContent,
    ).toContain('Damage');
    expect(
      screen.getByTestId('character-view-spellbook-inspect-slot-1'),
    ).toBeDefined();
    // Dismiss returns to the plain grid.
    fireEvent.click(screen.getByTestId('character-view-spellbook-inspect-close'));
    expect(
      document.querySelector('[data-testid="character-view-spellbook-inspect"]'),
    ).toBeNull();
  });
});
