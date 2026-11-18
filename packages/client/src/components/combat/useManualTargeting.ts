import { useCallback, useEffect, useRef, useState } from 'react';
import type { SrdCompendium } from '@srd5/data';
import type {
  DerivedWeaponAttackProfile,
  DispositionMatrix,
  GameCommand,
  GridPoint,
} from '@srd5/engine';
import { getFootprintDistanceFeet } from '@srd5/engine';
import type { PlayerViewCombatant } from '@srd5/transport';
import { computeAoeOverlay } from '../../canvas/layers/PathAndAoeLayer.js';
import { isUntargetableSummon } from '../../utils/summonPresentation.js';
import {
  aimRangeFeet,
  buildPendingTargetForAttack,
  buildPendingTargetForSpell,
  canCommitPending,
  commitAoeTarget,
  isSelfEmanation,
  needsDirectionPick,
  validateTargetPick,
  type PendingTarget,
} from '../../utils/pendingTargeting.js';
import { resolveSpellTargets } from '../../utils/combatTargeting.js';

/**
 * Shared SRD-410 manual targeting state machine for every tactical view
 * (Arena, Dungeon, Realm battles). Hotbar actions arm a pending target;
 * token clicks validate range/disposition and commit single shots; cell
 * clicks pick AOE origins/bearings; multi-target spells stack picks and
 * commit through the shared commit bar.
 *
 * Views keep only: Esc wiring, viewport props, and the commit-bar placement.
 */
export interface ManualTargetingDeps {
  combatants: Record<string, PlayerViewCombatant>;
  activeCombatant: PlayerViewCombatant | null;
  activeCombatantId: string | null;
  isMonsterTurn: boolean;
  hoveredCell: GridPoint | null;
  compendium: SrdCompendium;
  showFeedback: (msg: string) => void;
  dispatch: (command: GameCommand) => void;
  /** Authoritative combat context (disposition matrix, friendly-fire ruleset). */
  getCombatContext: () => {
    dispositionMatrix?: DispositionMatrix;
    friendlyFireEnabled?: boolean;
  };
  /** Plain inspect clicks (no pending target armed). */
  onInspectCombatant: (combatantId: string) => void;
}

export interface ManualTargetingApi {
  pendingTarget: PendingTarget;
  cancelPendingTarget: () => void;
  armAttack: (
    weapon: DerivedWeaponAttackProfile,
    opts?: { isOffHand?: boolean; twoHanded?: boolean },
  ) => void;
  armSpell: (spellId: string, slotLevel: number) => void;
  /** Token clicks: commit armed picks, otherwise inspect. */
  handleCombatantClick: (combatantId: string) => void;
  /**
   * Combat cell clicks: routes AOE origin/bearing picks and swallows clicks
   * while single/multi picks are armed. Returns true when the click was
   * consumed (caller must skip movement), false otherwise.
   */
  handleCombatCellClick: (cell: GridPoint, button?: number) => boolean;
  handleCommitMulti: () => void;
  handleCommitAoe: () => void;
  pendingTargetingMode: 'aoe' | 'attack' | 'none';
  pendingAoeOverlay: unknown;
  pendingAoeFoes: string[];
  pendingAoeAllies: string[];
  pendingMultiNames: string[];
  friendlyFireOff: boolean;
  activeTeamId: string;
}

export function useManualTargeting(deps: ManualTargetingDeps): ManualTargetingApi {
  const {
    combatants,
    activeCombatant,
    activeCombatantId,
    isMonsterTurn,
    hoveredCell,
    compendium,
    showFeedback,
    dispatch,
    getCombatContext,
    onInspectCombatant,
  } = deps;

  const [pendingTarget, setPendingTarget] = useState<PendingTarget>({ kind: 'none' });
  const pendingAttackOptsRef = useRef<{ isOffHand?: boolean; twoHanded?: boolean } | null>(null);

  const cancelPendingTarget = useCallback(() => {
    setPendingTarget({ kind: 'none' });
    pendingAttackOptsRef.current = null;
  }, []);

  // Clear armed targeting when the turn changes.
  useEffect(() => {
    setPendingTarget({ kind: 'none' });
    pendingAttackOptsRef.current = null;
  }, [activeCombatantId]);

  const armAttack = useCallback(
    (
      weapon: DerivedWeaponAttackProfile,
      opts?: { isOffHand?: boolean; twoHanded?: boolean },
    ) => {
      if (!activeCombatantId || !activeCombatant) return;
      pendingAttackOptsRef.current = {
        ...(opts?.isOffHand ? { isOffHand: opts.isOffHand } : {}),
        ...(opts?.twoHanded ? { twoHanded: opts.twoHanded } : {}),
      };
      setPendingTarget(
        buildPendingTargetForAttack({
          id: weapon.id,
          weaponId: weapon.weaponId,
          name: weapon.name,
          rangeType: weapon.rangeType,
          rangeFeet: weapon.rangeFeet,
          reachFeet: weapon.reachFeet,
        }),
      );
    },
    [activeCombatantId, activeCombatant],
  );

  const armSpell = useCallback(
    (spellId: string, slotLevel: number) => {
      if (!activeCombatantId || !activeCombatant) return;
      const spell = compendium.getSpell(spellId);
      if (!spell) return;
      const pending = buildPendingTargetForSpell(spell, slotLevel);
      if (!pending || pending.kind === 'none') {
        dispatch({
          type: 'DECLARE_CAST_SPELL',
          actorId: activeCombatantId,
          spellId,
          slotLevel,
          targetIds: [activeCombatant.id],
          targetCell: activeCombatant.position,
        });
        return;
      }
      // Self spheres/cubes anchor on the caster — pre-set the origin so the
      // player only Confirms (cones/lines still pick a bearing).
      if (pending.kind === 'aoe' && isSelfEmanation(pending) && !needsDirectionPick(pending)) {
        setPendingTarget({ ...pending, origin: { ...activeCombatant.position } });
      } else {
        setPendingTarget(pending);
      }
    },
    [activeCombatantId, activeCombatant, compendium, dispatch],
  );

  const handleCombatantClick = useCallback(
    (combatantId: string) => {
      if (!activeCombatant || isMonsterTurn) {
        onInspectCombatant(combatantId);
        return;
      }
      if (pendingTarget.kind === 'none') {
        onInspectCombatant(combatantId);
        return;
      }
      const candidate = combatants[combatantId];
      if (!candidate) return;
      const validation = validateTargetPick(pendingTarget, candidate, activeCombatant, combatants, {
        dispositionMatrix: getCombatContext().dispositionMatrix,
      });
      if (!validation.ok) {
        showFeedback(validation.error ?? 'Invalid target.');
        return;
      }
      if (pendingTarget.kind === 'single') {
        if (pendingTarget.action === 'attack') {
          const attackOpts = pendingAttackOptsRef.current ?? {};
          pendingAttackOptsRef.current = null;
          dispatch({
            type: 'DECLARE_ATTACK',
            actorId: activeCombatant.id,
            targetId: combatantId,
            attackProfileId: pendingTarget.attackProfileId ?? pendingTarget.weaponId ?? '',
            weaponInstanceId: pendingTarget.weaponId,
            ...(attackOpts.isOffHand ? { isOffHand: attackOpts.isOffHand } : {}),
            ...(attackOpts.twoHanded ? { twoHanded: attackOpts.twoHanded } : {}),
          });
        } else if (pendingTarget.spellId) {
          dispatch({
            type: 'DECLARE_CAST_SPELL',
            actorId: activeCombatant.id,
            spellId: pendingTarget.spellId,
            slotLevel: pendingTarget.slotLevel ?? 0,
            targetIds: [combatantId],
            targetCell: candidate.position,
          });
        }
        setPendingTarget({ kind: 'none' });
        return;
      }
      if (pendingTarget.kind === 'multi') {
        const picked = pendingTarget.picked;
        if (picked.includes(combatantId)) {
          if (pendingTarget.allowDuplicates) {
            if (picked.length >= pendingTarget.maxTargets) {
              showFeedback(`${pendingTarget.label} can target at most ${pendingTarget.maxTargets}.`);
              return;
            }
            setPendingTarget({ ...pendingTarget, picked: [...picked, combatantId] });
          } else {
            setPendingTarget({ ...pendingTarget, picked: picked.filter((id) => id !== combatantId) });
          }
        } else {
          if (picked.length >= pendingTarget.maxTargets) {
            showFeedback(`${pendingTarget.label} can target at most ${pendingTarget.maxTargets}.`);
            return;
          }
          setPendingTarget({ ...pendingTarget, picked: [...picked, combatantId] });
        }
      }
    },
    [activeCombatant, isMonsterTurn, pendingTarget, combatants, getCombatContext, showFeedback, dispatch, onInspectCombatant],
  );

  const handleCombatCellClick = useCallback(
    (cell: GridPoint, button?: number): boolean => {
      if (button === 2) {
        cancelPendingTarget();
        return true;
      }
      if (pendingTarget.kind === 'none' || !activeCombatant) return false;
      if (pendingTarget.kind === 'aoe') {
        // Self spheres/cubes are anchored on the caster — just Confirm.
        if (isSelfEmanation(pendingTarget) && !needsDirectionPick(pendingTarget)) {
          showFeedback(`${pendingTarget.label} originates from you — Confirm to cast.`);
          return true;
        }
        const dist = getFootprintDistanceFeet(
          activeCombatant.position,
          activeCombatant.size,
          cell,
          'small',
        );
        const aimRange = aimRangeFeet(pendingTarget);
        if (dist > aimRange) {
          showFeedback(
            `AOE ${needsDirectionPick(pendingTarget) ? 'direction' : 'origin'} out of range (${dist}ft > ${aimRange}ft). Pick a closer point!`,
          );
          return true;
        }
        setPendingTarget({ ...pendingTarget, origin: { x: cell.x, y: cell.y } });
        return true;
      }
      // Single/multi picks commit via token clicks; cell clicks never move.
      return true;
    },
    [pendingTarget, activeCombatant, showFeedback, cancelPendingTarget],
  );

  const handleCommitMulti = useCallback(() => {
    if (pendingTarget.kind !== 'multi' || !activeCombatantId || !activeCombatant) return;
    if (!canCommitPending(pendingTarget)) {
      showFeedback(`Pick at least 1 target for ${pendingTarget.label}.`);
      return;
    }
    const spell = compendium.getSpell(pendingTarget.spellId);
    if (!spell) return;
    const targetResult = resolveSpellTargets({
      spell,
      slotLevel: pendingTarget.slotLevel,
      caster: activeCombatant,
      combatants,
      pickedTargetIds: pendingTarget.picked,
      allowDuplicates: pendingTarget.allowDuplicates,
      dispositionMatrix: getCombatContext().dispositionMatrix,
    });
    if (targetResult.errorFeedback) {
      showFeedback(targetResult.errorFeedback);
      return;
    }
    dispatch({
      type: 'DECLARE_CAST_SPELL',
      actorId: activeCombatantId,
      spellId: pendingTarget.spellId,
      slotLevel: pendingTarget.slotLevel,
      targetIds: targetResult.targetIds,
      targetCell: targetResult.primaryTarget
        ? targetResult.primaryTarget.position
        : activeCombatant.position,
    });
    setPendingTarget({ kind: 'none' });
  }, [pendingTarget, activeCombatantId, activeCombatant, compendium, combatants, getCombatContext, showFeedback, dispatch]);

  const handleCommitAoe = useCallback(() => {
    if (pendingTarget.kind !== 'aoe' || !activeCombatantId || !activeCombatant) return;
    const commit = commitAoeTarget(pendingTarget, activeCombatant.position);
    if (!commit) {
      showFeedback(`Pick a point within range for ${pendingTarget.label}.`);
      return;
    }
    dispatch({
      type: 'DECLARE_CAST_SPELL',
      actorId: activeCombatantId,
      spellId: pendingTarget.spellId,
      slotLevel: pendingTarget.slotLevel,
      targetCell: commit.targetCell,
      ...(commit.directionRad !== undefined ? { directionRad: commit.directionRad } : {}),
    });
    setPendingTarget({ kind: 'none' });
  }, [pendingTarget, activeCombatantId, activeCombatant, showFeedback, dispatch]);

  const activeTeamId = activeCombatant?.teamId ?? activeCombatant?.side ?? 'party';
  const pendingAoeCursor =
    pendingTarget.kind === 'aoe' ? (pendingTarget.origin ?? hoveredCell) : null;
  const pendingAoeOverlay =
    pendingTarget.kind === 'aoe' && pendingAoeCursor && activeCombatant
      ? {
          shape: pendingTarget.shape,
          cursor: pendingAoeCursor,
          casterPosition: activeCombatant.position,
          casterSize: activeCombatant.size,
          radiusFeet: pendingTarget.shape === 'sphere' || pendingTarget.shape === 'cylinder' ? pendingTarget.sizeFeet : undefined,
          lengthFeet:
            pendingTarget.shape === 'cone' || pendingTarget.shape === 'line' ? pendingTarget.sizeFeet : undefined,
          widthFeet: pendingTarget.widthFeet,
          sideFeet: pendingTarget.shape === 'cube' ? pendingTarget.sizeFeet : undefined,
          creatures: Object.values(combatants),
        }
      : null;
  const pendingAoePreview =
    pendingAoeOverlay && pendingTarget.kind === 'aoe'
      ? computeAoeOverlay(pendingAoeOverlay as never)
      : null;
  const friendlyFireOff = getCombatContext().friendlyFireEnabled === false;
  const pendingAoeFoes = (pendingAoePreview?.affectedCreatureIds ?? []).filter((id) => {
    const c = combatants[id];
    return (
      c &&
      (c.teamId ?? c.side) !== activeTeamId &&
      !c.isDead &&
      c.currentHp > 0 &&
      !isUntargetableSummon(c)
    );
  });
  const pendingAoeAllies = (pendingAoePreview?.affectedCreatureIds ?? []).filter((id) => {
    const c = combatants[id];
    return (
      c &&
      (c.teamId ?? c.side) === activeTeamId &&
      !c.isDead &&
      c.currentHp > 0 &&
      !isUntargetableSummon(c)
    );
  });
  const pendingTargetingMode =
    pendingTarget.kind === 'aoe' ? 'aoe' : pendingTarget.kind === 'none' ? 'none' : 'attack';
  const pendingMultiNames =
    pendingTarget.kind === 'multi'
      ? pendingTarget.picked.map((id) => combatants[id]?.name ?? id)
      : [];

  return {
    pendingTarget,
    cancelPendingTarget,
    armAttack,
    armSpell,
    handleCombatantClick,
    handleCombatCellClick,
    handleCommitMulti,
    handleCommitAoe,
    pendingTargetingMode,
    pendingAoeOverlay,
    pendingAoeFoes,
    pendingAoeAllies,
    pendingMultiNames,
    friendlyFireOff,
    activeTeamId,
  };
}
