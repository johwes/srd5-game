import { useState } from 'react';
import {
  type CharacterBuildState,
  type EquipmentOptionBranch,
  type SrdCompendium,
  defaultCompendium,
} from '@srd5/data';
import {
  formatCopperCost,
  formatTitleCase,
} from '../compendium/formatters.js';
import {
  type CharacterBuilderWizardState,
  type EquipmentAcquisitionMode,
  type StartingGoldMethod,
  computeAverageStartingGoldGp,
  materializeBundleEquipment,
  materializeGoldShopEquipment,
  rollStartingGoldGp,
} from './builderState.js';

export interface EquipmentStepProps {
  wizard: CharacterBuilderWizardState;
  onWizardChange: (
    updater: (prev: CharacterBuilderWizardState) => CharacterBuilderWizardState,
  ) => void;
  compendium?: SrdCompendium;
}

export function EquipmentStep({
  wizard,
  onWizardChange,
  compendium = defaultCompendium,
}: EquipmentStepProps) {
  const [shopSearch, setShopSearch] = useState('');
  const [shopKindFilter, setShopKindFilter] = useState<
    'all' | 'weapon' | 'armor' | 'gear' | 'tool' | 'pack'
  >('all');

  const { buildState, equipmentMode, goldMethod, goldRollSeed, startingGoldGp, goldShopCart } =
    wizard;
  const primaryEntry = buildState.classes[0];
  const classData = primaryEntry
    ? compendium.getClass(primaryEntry.classId)
    : undefined;
  const lvl1Selections = primaryEntry?.choiceSelectionsByLevel[1] ?? {};

  const handleModeChange = (mode: EquipmentAcquisitionMode) => {
    onWizardChange((prev) => {
      if (prev.equipmentMode === mode) return prev;
      const entry = prev.buildState.classes[0];
      const cls = entry ? compendium.getClass(entry.classId) : undefined;

      if (mode === 'bundles') {
        const materialized = materializeBundleEquipment(
          prev.buildState,
          compendium,
        );
        return {
          ...prev,
          equipmentMode: 'bundles',
          buildState: {
            ...prev.buildState,
            ...materialized,
          },
        };
      }

      const formula = cls?.startingGoldFormula ?? '5d4 * 10';
      const goldGp =
        prev.goldMethod === 'average'
          ? computeAverageStartingGoldGp(formula)
          : rollStartingGoldGp(formula, prev.goldRollSeed);

      // Remove starting equipment keys from choiceSelectionsByLevel[1] when using Gold Shop
      const equipIds = new Set(
        (cls?.startingEquipmentChoices ?? []).flatMap((c) =>
          c.type === 'equipment_bundle'
            ? [
                c.id,
                ...c.options.map((b: EquipmentOptionBranch) => `${c.id}:${b.id}`),
              ]
            : [c.id],
        ),
      );
      const cleanedLvl1: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(
        entry?.choiceSelectionsByLevel[1] ?? {},
      )) {
        if (!equipIds.has(k)) {
          cleanedLvl1[k] = v;
        }
      }

      const shopMat = materializeGoldShopEquipment(
        goldGp,
        prev.goldShopCart,
        compendium,
      );

      return {
        ...prev,
        equipmentMode: 'gold',
        startingGoldGp: goldGp,
        buildState: {
          ...prev.buildState,
          classes: entry
            ? [
                {
                  ...entry,
                  choiceSelectionsByLevel: {
                    ...entry.choiceSelectionsByLevel,
                    1: cleanedLvl1,
                  },
                },
              ]
            : prev.buildState.classes,
          inventory: shopMat.inventory,
          currency: shopMat.currency,
          equippedSlots: shopMat.equippedSlots,
        },
      };
    });
  };

  const handleSelectBundleBranch = (choiceId: string, branchId: string) => {
    onWizardChange((prev) => {
      const entry = prev.buildState.classes[0];
      if (!entry) return prev;
      const cls = compendium.getClass(entry.classId);
      const equipChoice = cls?.startingEquipmentChoices.find(
        (c) => c.id === choiceId,
      );
      const branch =
        equipChoice?.type === 'equipment_bundle'
          ? equipChoice.options.find(
              (b: EquipmentOptionBranch) => b.id === branchId,
            )
          : undefined;

      const nextLvl1: Record<string, string[]> = {
        ...(entry.choiceSelectionsByLevel[1] ?? {}),
        [choiceId]: [branchId],
      };

      // Pre-populate default sub-selection if branch has category_choice items
      if (branch) {
        const catItems = branch.items.filter(
          (
            i: EquipmentOptionBranch['items'][number],
          ): i is Extract<
            EquipmentOptionBranch['items'][number],
            { kind: 'category_choice' }
          > => i.kind === 'category_choice',
        );
        if (catItems.length > 0) {
          const subKey = `${choiceId}:${branch.id}`;
          if (!nextLvl1[subKey] || nextLvl1[subKey].length === 0) {
            const defaults: string[] = [];
            for (const catItem of catItems) {
              const options = compendium.resolveEquipmentCategory(
                catItem.category,
              );
              const firstId = options[0]?.id;
              if (firstId) {
                for (let k = 0; k < catItem.count; k++) {
                  defaults.push(firstId);
                }
              }
            }
            nextLvl1[subKey] = defaults;
          }
        }
      }

      const nextBuild: CharacterBuildState = {
        ...prev.buildState,
        classes: [
          {
            ...entry,
            choiceSelectionsByLevel: {
              ...entry.choiceSelectionsByLevel,
              1: nextLvl1,
            },
          },
        ],
      };

      const materialized = materializeBundleEquipment(nextBuild, compendium);
      return {
        ...prev,
        buildState: {
          ...nextBuild,
          ...materialized,
        },
      };
    });
  };

  const handleSelectBundleCategorySubItem = (
    choiceId: string,
    branchId: string,
    slotIdx: number,
    itemId: string,
  ) => {
    onWizardChange((prev) => {
      const entry = prev.buildState.classes[0];
      if (!entry) return prev;
      const subKey = `${choiceId}:${branchId}`;
      const existing = [...(entry.choiceSelectionsByLevel[1]?.[subKey] ?? [])];
      existing[slotIdx] = itemId;

      const nextBuild: CharacterBuildState = {
        ...prev.buildState,
        classes: [
          {
            ...entry,
            choiceSelectionsByLevel: {
              ...entry.choiceSelectionsByLevel,
              1: {
                ...(entry.choiceSelectionsByLevel[1] ?? {}),
                [subKey]: existing,
              },
            },
          },
        ],
      };

      const materialized = materializeBundleEquipment(nextBuild, compendium);
      return {
        ...prev,
        buildState: {
          ...nextBuild,
          ...materialized,
        },
      };
    });
  };

  const handleGoldMethodChange = (method: StartingGoldMethod, seedInput?: number) => {
    onWizardChange((prev) => {
      const entry = prev.buildState.classes[0];
      const cls = entry ? compendium.getClass(entry.classId) : undefined;
      const formula = cls?.startingGoldFormula ?? '5d4 * 10';
      const nextSeed = seedInput ?? prev.goldRollSeed;
      const goldGp =
        method === 'average'
          ? computeAverageStartingGoldGp(formula)
          : rollStartingGoldGp(formula, nextSeed);

      const shopMat = materializeGoldShopEquipment(
        goldGp,
        prev.goldShopCart,
        compendium,
      );

      return {
        ...prev,
        goldMethod: method,
        goldRollSeed: nextSeed,
        startingGoldGp: goldGp,
        buildState: {
          ...prev.buildState,
          inventory: shopMat.inventory,
          currency: shopMat.currency,
          equippedSlots: shopMat.equippedSlots,
        },
      };
    });
  };

  const handleCartQuantityDelta = (itemId: string, delta: number) => {
    onWizardChange((prev) => {
      const currentQty = prev.goldShopCart[itemId] ?? 0;
      const nextQty = Math.max(0, currentQty + delta);
      const nextCart = { ...prev.goldShopCart };
      if (nextQty === 0) {
        delete nextCart[itemId];
      } else {
        nextCart[itemId] = nextQty;
      }

      const shopMat = materializeGoldShopEquipment(
        prev.startingGoldGp,
        nextCart,
        compendium,
      );

      return {
        ...prev,
        goldShopCart: nextCart,
        buildState: {
          ...prev.buildState,
          inventory: shopMat.inventory,
          currency: shopMat.currency,
          equippedSlots: shopMat.equippedSlots,
        },
      };
    });
  };

  const handleEquipSlotChange = (
    slotKey:
      | 'armorInstanceId'
      | 'shieldInstanceId'
      | 'mainHandInstanceId'
      | 'offHandInstanceId'
      | 'rangedInstanceId',
    instanceId: string,
  ) => {
    onWizardChange((prev) => {
      const nextSlots: CharacterBuildState['equippedSlots'] = {
        ...prev.buildState.equippedSlots,
      };
      if (!instanceId) {
        delete nextSlots[slotKey];
      } else {
        nextSlots[slotKey] = instanceId;
      }
      return {
        ...prev,
        buildState: {
          ...prev.buildState,
          equippedSlots: nextSlots,
        },
      };
    });
  };

  const filteredCatalog = compendium.equipment.filter((eq) => {
    if (shopKindFilter !== 'all' && eq.kind !== shopKindFilter) {
      return false;
    }
    if (shopSearch.trim().length > 0) {
      const q = shopSearch.trim().toLowerCase();
      return (
        eq.name.toLowerCase().includes(q) || eq.id.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const shopSummary = materializeGoldShopEquipment(
    startingGoldGp,
    goldShopCart,
    compendium,
  );

  return (
    <div data-testid="builder-step-equipment" className="space-y-6">
      {/* Mode Switcher: Bundles vs Gold Shop */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-amber-300">
            Starting Equipment Acquisition Mode
          </h3>
          <p className="text-xs text-slate-400">
            Select standard class &amp; background equipment bundles or purchase gear with starting gold.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            data-testid="builder-equip-mode-bundles"
            aria-pressed={equipmentMode === 'bundles'}
            onClick={() => handleModeChange('bundles')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              equipmentMode === 'bundles'
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Mode A: Equipment Bundles
          </button>
          <button
            type="button"
            data-testid="builder-equip-mode-gold"
            aria-pressed={equipmentMode === 'gold'}
            onClick={() => handleModeChange('gold')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              equipmentMode === 'gold'
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Mode B: Starting Gold Shop
          </button>
        </div>
      </section>

      {/* Mode A: Starting Equipment Bundles */}
      {equipmentMode === 'bundles' && classData && (
        <section
          data-testid="builder-equip-bundles-section"
          className="space-y-4"
        >
          <h4 className="text-sm font-semibold text-amber-300">
            {classData.name} Starting Equipment Choices
          </h4>

          <div className="space-y-3">
            {classData.startingEquipmentChoices.map((equipChoice) => {
              if (equipChoice.type !== 'equipment_bundle') return null;
              const selectedBranchId = lvl1Selections[equipChoice.id]?.[0];
              const selectedBranch = equipChoice.options.find(
                (b: EquipmentOptionBranch) => b.id === selectedBranchId,
              );

              return (
                <div
                  key={equipChoice.id}
                  data-testid={`builder-equip-choice-${equipChoice.id}`}
                  className="rounded-lg border border-slate-800 bg-slate-900/70 p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-200">
                      {equipChoice.label}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium border ${
                        selectedBranch
                          ? 'bg-emerald-950/60 border-emerald-700/60 text-emerald-300'
                          : 'bg-amber-950/60 border-amber-700/60 text-amber-300'
                      }`}
                    >
                      {selectedBranch ? selectedBranch.label : 'Choose 1'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {equipChoice.options.map((branch: EquipmentOptionBranch) => {
                      const isPicked = selectedBranchId === branch.id;
                      return (
                        <button
                          key={branch.id}
                          type="button"
                          data-testid={`builder-equip-branch-${equipChoice.id}-${branch.id}`}
                          aria-pressed={isPicked}
                          onClick={() =>
                            handleSelectBundleBranch(equipChoice.id, branch.id)
                          }
                          className={`text-left px-3 py-2.5 rounded-md border text-xs transition-colors ${
                            isPicked
                              ? 'bg-amber-500/15 border-amber-500 text-amber-200 font-medium'
                              : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {branch.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Category Sub-Choices (if selected branch has category_choice items) */}
                  {selectedBranch &&
                    (() => {
                      const catItems = selectedBranch.items.filter(
                        (
                          i: EquipmentOptionBranch['items'][number],
                        ): i is Extract<
                          EquipmentOptionBranch['items'][number],
                          { kind: 'category_choice' }
                        > => i.kind === 'category_choice',
                      );
                      if (catItems.length === 0) return null;

                      const subKey = `${equipChoice.id}:${selectedBranch.id}`;
                      const subSelected = lvl1Selections[subKey] ?? [];
                      let slotCounter = 0;

                      return (
                        <div className="pt-2 border-t border-slate-800 space-y-2">
                          {catItems.map((catItem, cIdx) => {
                            const allowedEq = compendium.resolveEquipmentCategory(
                              catItem.category,
                            );
                            return Array.from(
                              { length: catItem.count },
                              (_, k) => {
                                const currentSlotIdx = slotCounter++;
                                const currentVal =
                                  subSelected[currentSlotIdx] ?? '';
                                return (
                                  <div
                                    key={`${cIdx}-${k}`}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    <label
                                      htmlFor={`sub-equip-${subKey}-${currentSlotIdx}`}
                                      className="text-slate-300"
                                    >
                                      Select {formatTitleCase(catItem.category)}:
                                    </label>
                                    <select
                                      id={`sub-equip-${subKey}-${currentSlotIdx}`}
                                      data-testid={`builder-equip-subselect-${equipChoice.id}-${selectedBranch.id}-${currentSlotIdx}`}
                                      value={currentVal}
                                      onChange={(e) =>
                                        handleSelectBundleCategorySubItem(
                                          equipChoice.id,
                                          selectedBranch.id,
                                          currentSlotIdx,
                                          e.target.value,
                                        )
                                      }
                                      className="rounded bg-slate-950 border border-slate-700 px-2.5 py-1 text-xs text-amber-300"
                                    >
                                      <option value="">-- Select Item --</option>
                                      {allowedEq.map((eq) => (
                                        <option key={eq.id} value={eq.id}>
                                          {eq.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                );
                              },
                            );
                          })}
                        </div>
                      );
                    })()}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Mode B: Starting Gold Shop */}
      {equipmentMode === 'gold' && classData && (
        <section
          data-testid="builder-equip-gold-section"
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div className="space-y-0.5">
              <h4 className="text-sm font-semibold text-amber-300">
                {classData.name} Starting Wealth ({classData.startingGoldFormula} gp)
              </h4>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  data-testid="builder-gold-method-average"
                  onClick={() => handleGoldMethodChange('average')}
                  className={`px-2 py-0.5 rounded border ${
                    goldMethod === 'average'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Take Average (
                  {computeAverageStartingGoldGp(classData.startingGoldFormula)} gp)
                </button>
                <button
                  type="button"
                  data-testid="builder-gold-method-roll"
                  onClick={() =>
                    handleGoldMethodChange('roll', goldRollSeed + 1)
                  }
                  className={`px-2 py-0.5 rounded border ${
                    goldMethod === 'roll'
                      ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Roll Gold (Seed {goldRollSeed})
                </button>
              </div>
            </div>

            <div className="text-right">
              <div
                data-testid="builder-gold-budget-display"
                className={`text-sm font-bold font-mono ${
                  shopSummary.remainingCopper < 0
                    ? 'text-rose-400'
                    : 'text-emerald-300'
                }`}
              >
                Remaining: {(shopSummary.remainingCopper / 100).toFixed(2)} gp /{' '}
                {startingGoldGp} gp
              </div>
              <div className="text-[11px] text-slate-400">
                Spent: {formatCopperCost(shopSummary.spentCopper)}
              </div>
            </div>
          </div>

          {/* Shop Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              data-testid="builder-gold-shop-search"
              placeholder="Search SRD weapons, armor, packs, tools..."
              value={shopSearch}
              onChange={(e) => setShopSearch(e.target.value)}
              className="flex-1 min-w-[200px] rounded bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs text-slate-100"
            />
            <select
              aria-label="Filter shop by item kind"
              data-testid="builder-gold-shop-kind-filter"
              value={shopKindFilter}
              onChange={(e) =>
                setShopKindFilter(
                  e.target.value as typeof shopKindFilter,
                )
              }
              className="rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="all">All Categories</option>
              <option value="weapon">Weapons</option>
              <option value="armor">Armor &amp; Shields</option>
              <option value="pack">Equipment Packs</option>
              <option value="gear">Adventuring Gear</option>
              <option value="tool">Tools</option>
            </select>
          </div>

          {/* Shop Catalog Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
            {filteredCatalog.slice(0, 45).map((eq) => {
              const inCart = goldShopCart[eq.id] ?? 0;
              const canAffordMore =
                shopSummary.remainingCopper >= eq.costCopper;

              return (
                <div
                  key={eq.id}
                  data-testid={`builder-shop-item-${eq.id}`}
                  className="rounded-lg bg-slate-950/80 border border-slate-800 p-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 truncate">
                      {eq.name}
                    </div>
                    <div className="text-[11px] text-amber-300/90 font-mono">
                      {formatCopperCost(eq.costCopper)} &middot; {eq.weightLb} lb
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {inCart > 0 && (
                      <>
                        <button
                          type="button"
                          data-testid={`builder-shop-sell-${eq.id}`}
                          onClick={() => handleCartQuantityDelta(eq.id, -1)}
                          className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 hover:bg-slate-700"
                        >
                          &minus;
                        </button>
                        <span
                          data-testid={`builder-shop-qty-${eq.id}`}
                          className="font-mono font-bold text-amber-300 px-1"
                        >
                          {inCart}
                        </span>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={!canAffordMore}
                      data-testid={`builder-shop-buy-${eq.id}`}
                      onClick={() => handleCartQuantityDelta(eq.id, 1)}
                      className="px-2 py-1 rounded bg-amber-500/20 border border-amber-500/50 text-amber-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-500/30"
                    >
                      Buy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Resulting Inventory & Equipped Loadout */}
      <section
        data-testid="builder-inventory-summary"
        className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
          <div>
            <h4 className="text-sm font-semibold text-slate-200">
              Current Inventory &amp; Equipped Loadout ({buildState.inventory.length}{' '}
              items)
            </h4>
            <p className="text-xs text-slate-400">
              Starting Coin Pouch: {buildState.currency.gp} gp,{' '}
              {buildState.currency.sp} sp, {buildState.currency.cp} cp
            </p>
          </div>
        </div>

        {/* Equipped Loadout Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="builder-equip-slot-armor"
              className="block text-xs text-slate-400 mb-1"
            >
              Equipped Body Armor
            </label>
            <select
              id="builder-equip-slot-armor"
              data-testid="builder-equip-slot-armor"
              value={buildState.equippedSlots.armorInstanceId ?? ''}
              onChange={(e) =>
                handleEquipSlotChange('armorInstanceId', e.target.value)
              }
              className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="">Unarmored</option>
              {buildState.inventory
                .filter((inst) => {
                  const eq = compendium.getEquipment(inst.itemId);
                  return eq?.kind === 'armor' && eq.category !== 'shield';
                })
                .map((inst) => (
                  <option key={inst.instanceId} value={inst.instanceId}>
                    {compendium.getEquipment(inst.itemId)?.name ?? inst.itemId}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="builder-equip-slot-shield"
              className="block text-xs text-slate-400 mb-1"
            >
              Equipped Shield
            </label>
            <select
              id="builder-equip-slot-shield"
              data-testid="builder-equip-slot-shield"
              value={buildState.equippedSlots.shieldInstanceId ?? ''}
              onChange={(e) =>
                handleEquipSlotChange('shieldInstanceId', e.target.value)
              }
              className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="">None</option>
              {buildState.inventory
                .filter((inst) => {
                  const eq = compendium.getEquipment(inst.itemId);
                  return eq?.kind === 'armor' && eq.category === 'shield';
                })
                .map((inst) => (
                  <option key={inst.instanceId} value={inst.instanceId}>
                    {compendium.getEquipment(inst.itemId)?.name ?? inst.itemId}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="builder-equip-slot-mainhand"
              className="block text-xs text-slate-400 mb-1"
            >
              Main-Hand Weapon
            </label>
            <select
              id="builder-equip-slot-mainhand"
              data-testid="builder-equip-slot-mainhand"
              value={buildState.equippedSlots.mainHandInstanceId ?? ''}
              onChange={(e) =>
                handleEquipSlotChange('mainHandInstanceId', e.target.value)
              }
              className="w-full rounded bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="">Unarmed</option>
              {buildState.inventory
                .filter(
                  (inst) =>
                    compendium.getEquipment(inst.itemId)?.kind === 'weapon',
                )
                .map((inst) => (
                  <option key={inst.instanceId} value={inst.instanceId}>
                    {compendium.getEquipment(inst.itemId)?.name ?? inst.itemId}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Inventory Badges */}
        <div className="flex flex-wrap gap-1.5">
          {buildState.inventory.map((inst) => {
            const eq = compendium.getEquipment(inst.itemId);
            return (
              <span
                key={inst.instanceId}
                data-testid={`builder-inv-badge-${inst.itemId}`}
                className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-300"
              >
                {eq?.name ?? inst.itemId}{' '}
                {inst.quantity > 1 && (
                  <strong className="text-amber-300 font-mono">
                    &times;{inst.quantity}
                  </strong>
                )}
              </span>
            );
          })}
        </div>
      </section>
    </div>
  );
}
