import React from 'react';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultCompendium } from '@srd5/data';
import {
  WAR_NATION_ARCHETYPES,
  buildMissionApproaches,
  getWarThreatTier,
} from '@srd5/engine';
import type { RealmSessionState } from '../components/realm/realmEngine.js';
import {
  createRealmSession,
  getPartyList,
  reduceRealm,
} from '../components/realm/realmEngine.js';
import { RealmNationSelectModal } from '../components/realm/RealmNationSelectModal.js';
import { RealmWarRoomModal } from '../components/realm/RealmWarRoomModal.js';
import {
  RealmMissionApproachModal,
  approachSuccessOdds,
} from '../components/realm/RealmMissionApproachModal.js';
import { RealmPatrolModal, buildPatrolPreviews } from '../components/realm/RealmPatrolModal.js';
import { RealmWarOutcomeModal } from '../components/realm/RealmWarOutcomeModal.js';
import { RealmHud } from '../components/realm/RealmHud.js';
import { RealmView } from '../components/realm/RealmView.js';
import type { DungeonStorageAdapter } from '../persistence/index.js';

/**
 * SRD-1106: Realm War UI — nation select, War Room, Approach Dialogue,
 * patrol dialogue, HUD power/threat indicators, Victory/Defeat endings.
 * Real engine sessions, seeded and deterministic; no Math.random.
 */

const SEED = 1106;

function bootWar(width = 48, height = 48): RealmSessionState {
  const fresh = createRealmSession({ seed: SEED, width, height });
  return reduceRealm(fresh, { type: 'SELECT_PLAYER_NATION' }).session;
}

function rivalId(session: RealmSessionState): string {
  return session.war!.nationOrder.find((id) => id !== session.war!.playerNationId)!;
}

function findEnemyBridge(session: RealmSessionState) {
  const rival = rivalId(session);
  const poi = Object.values(session.map.pois).find(
    (p) =>
      p.kind === 'bridge' &&
      p.strategicStatus === 'intact' &&
      (p.ownerNationId ?? p.factionId) === rival,
  );
  if (!poi) throw new Error('No intact rival bridge');
  return poi;
}

function makeMemoryAdapter(): DungeonStorageAdapter {
  const store: Record<string, unknown> = {};
  return {
    async getItem(k) {
      return store[k];
    },
    async setItem(k, v) {
      store[k] = structuredClone(v);
    },
    async removeItem(k) {
      delete store[k];
    },
  };
}

describe('SRD-1106: Realm War UI (Spec 10)', () => {
  const mathRandomSpy = vi.spyOn(Math, 'random');

  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
  });
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    mathRandomSpy.mockRestore();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Re-stub canvas + Math.random spy for the next test.
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    vi.spyOn(Math, 'random');
  });

  describe('RealmNationSelectModal', () => {
    it('lists all 8 archetypes with ruler, flavor, and patron perk', () => {
      const onSelect = vi.fn();
      render(<RealmNationSelectModal isOpen onSelectNation={onSelect} />);
      expect(screen.getByTestId('realm-nation-select-modal')).toBeDefined();
      expect(screen.getByTestId('realm-nation-select-list').children.length).toBe(8);
      for (const archetype of WAR_NATION_ARCHETYPES) {
        expect(screen.getByTestId(`realm-nation-option-${archetype.id}`)).toBeDefined();
        expect(screen.getByTestId(`realm-nation-perk-${archetype.id}`).textContent).toContain(
          archetype.perk.slice(0, 12),
        );
      }
      const goods = WAR_NATION_ARCHETYPES.filter((a) => a.alignment === 'good');
      const evils = WAR_NATION_ARCHETYPES.filter((a) => a.alignment === 'evil');
      expect(goods.length).toBe(3);
      expect(evils.length).toBe(2);
      fireEvent.click(screen.getByTestId('realm-nation-option-dawn-crown'));
      expect(onSelect).toHaveBeenCalledWith('dawn-crown');
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('renders nothing when closed', () => {
      const { container } = render(
        <RealmNationSelectModal isOpen={false} onSelectNation={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('RealmHud war strip', () => {
    it('prompts for a banner before the war begins', () => {
      const session = createRealmSession({ seed: SEED });
      const onOpenNationSelect = vi.fn();
      render(
        <RealmHud
          session={session}
          currentPoi={null}
          logEntries={[]}
          expeditionPreview={null}
          expeditionPreviewError={null}
          canForceMarch={false}
          dayBudget={6}
          onSetPace={vi.fn()}
          onForage={vi.fn()}
          onForceMarch={vi.fn()}
          onOpenCamp={vi.fn()}
          onOpenJournal={vi.fn()}
          onOpenFactions={vi.fn()}
          onOpenShop={vi.fn()}
          onOpenQuestBoard={vi.fn()}
          onOpenHub={vi.fn()}
          onEnterPoi={vi.fn()}
          onEndlessDelve={vi.fn()}
          onOpenPause={vi.fn()}
          onOpenNationSelect={onOpenNationSelect}
        />,
      );
      expect(screen.getByTestId('realm-hud-war-strip')).toBeDefined();
      fireEvent.click(screen.getByTestId('realm-hud-choose-banner-btn'));
      expect(onOpenNationSelect).toHaveBeenCalled();
    });

    it('shows per-nation power totals, threat badge, and war room toggle', () => {
      const session = bootWar();
      const threatened: RealmSessionState = {
        ...session,
        diplomacy: { ...session.diplomacy, threats: { [rivalId(session)]: 60 } },
      };
      const onOpenWarRoom = vi.fn();
      render(
        <RealmHud
          session={threatened}
          currentPoi={null}
          logEntries={[]}
          expeditionPreview={null}
          expeditionPreviewError={null}
          canForceMarch={false}
          dayBudget={6}
          onSetPace={vi.fn()}
          onForage={vi.fn()}
          onForceMarch={vi.fn()}
          onOpenCamp={vi.fn()}
          onOpenJournal={vi.fn()}
          onOpenFactions={vi.fn()}
          onOpenShop={vi.fn()}
          onOpenQuestBoard={vi.fn()}
          onOpenHub={vi.fn()}
          onEnterPoi={vi.fn()}
          onEndlessDelve={vi.fn()}
          onOpenPause={vi.fn()}
          onOpenWarRoom={onOpenWarRoom}
        />,
      );
      for (const nationId of threatened.war!.nationOrder) {
        const badge = screen.getByTestId(`realm-hud-war-nation-${nationId}`);
        expect(badge.textContent).toContain(
          String(
            threatened.war!.nations[nationId]!.power.military +
              threatened.war!.nations[nationId]!.power.economy +
              threatened.war!.nations[nationId]!.power.arcana +
              threatened.war!.nations[nationId]!.power.morale,
          ),
        );
      }
      const threat = screen.getByTestId('realm-hud-threat-badge');
      expect(threat.textContent).toContain('60');
      expect(threat.textContent).toContain(getWarThreatTier(60));
      expect(threat.getAttribute('title')).toContain('-6/day');
      fireEvent.click(screen.getByTestId('realm-hud-war-room-btn'));
      expect(onOpenWarRoom).toHaveBeenCalled();
    });
  });

  describe('RealmWarRoomModal', () => {
    it('renders ledger totals, chronicle, missions, and diplomacy tabs', () => {
      const session = bootWar();
      const onAccept = vi.fn();
      const onTruce = vi.fn();
      const onHire = vi.fn();
      const onPatrol = vi.fn();
      render(
        <RealmWarRoomModal
          isOpen
          war={session.war}
          diplomacy={session.diplomacy}
          map={session.map}
          currentDay={session.travel.currentDay}
          gold={session.travel.gold}
          onClose={vi.fn()}
          onAcceptMission={onAccept}
          onNegotiateTruce={onTruce}
          onHireAsset={onHire}
          onFacePatrol={onPatrol}
        />,
      );
      expect(screen.getByTestId('realm-war-room-modal')).toBeDefined();
      // Ledger (default tab).
      expect(screen.getByTestId('realm-war-room-ledger')).toBeDefined();
      for (const nationId of session.war!.nationOrder) {
        expect(screen.getByTestId(`realm-war-ledger-nation-${nationId}`)).toBeDefined();
      }
      // Missions tab lists all 9 catalog kinds.
      fireEvent.click(screen.getByTestId('realm-war-room-tab-missions'));
      expect(screen.getByTestId('realm-war-room-missions')).toBeDefined();
      for (const kind of [
        'assassinate_general',
        'destroy_bridge',
        'poison_water_supply',
        'sabotage_enemy_mine',
        'rescue_spy',
        'protect_poi',
        'cleanse_cursed_mine',
        'capture_neutral_mine',
        'recover_war_artifact',
      ]) {
        expect(screen.getByTestId(`realm-war-mission-kind-${kind}`)).toBeDefined();
      }
      // Diplomacy tab: threat tiers, truce/hire/patrol actions, sub-factions.
      fireEvent.click(screen.getByTestId('realm-war-room-tab-diplomacy'));
      expect(screen.getByTestId('realm-war-room-diplomacy')).toBeDefined();
      const rival = rivalId(session);
      expect(screen.getByTestId(`realm-war-diplomacy-nation-${rival}`)).toBeDefined();
      expect(screen.getByTestId(`realm-war-diplomacy-threat-${rival}`).textContent).toContain(
        'unnoticed',
      );
      fireEvent.click(screen.getByTestId(`realm-war-patrol-btn-${rival}`));
      expect(onPatrol).toHaveBeenCalledWith(rival);
      fireEvent.click(screen.getByTestId('realm-war-hire-mercenaries-btn'));
      expect(onHire).toHaveBeenCalledWith('mercenaries');
      expect(screen.getByTestId('realm-war-subfaction-local_orc_tribe')).toBeDefined();
      expect(screen.getByTestId('realm-war-subfaction-local_druid_circle')).toBeDefined();
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });

  describe('RealmMissionApproachModal', () => {
    it('shows approach odds and deterministic d20 roll feedback', () => {
      const session = bootWar();
      const bridge = findEnemyBridge(session);
      const accepted = reduceRealm(session, {
        type: 'ACCEPT_WAR_MISSION',
        missionKind: 'destroy_bridge',
        poiId: bridge.id,
      });
      const mission = accepted.session.activeWarMission!;
      const bonuses: Record<string, { bonus: number; actorName: string }> = {};
      for (const approach of mission.approaches) {
        bonuses[approach.id] = { bonus: 5, actorName: getPartyList(session)[0]!.name };
      }
      const onChoose = vi.fn();
      const { rerender } = render(
        <RealmMissionApproachModal
          isOpen
          missionKind={mission.mission.kind}
          poiName={mission.poiName}
          approaches={mission.approaches}
          bonuses={bonuses}
          resolved={null}
          onChooseApproach={onChoose}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('realm-mission-approach-modal')).toBeDefined();
      for (const approach of mission.approaches) {
        const btn = screen.getByTestId(`realm-mission-approach-option-${approach.id}`);
        expect(btn).toBeDefined();
        if (approach.checkKind !== 'assault') {
          const odds = screen.getByTestId(`realm-mission-approach-odds-${approach.id}`);
          expect(odds.textContent).toContain('%');
          expect(approachSuccessOdds(5, approach.dc)).toBeGreaterThan(0);
          expect(approachSuccessOdds(5, approach.dc)).toBeLessThanOrEqual(1);
        }
      }
      // Bridges never offer spell/teleport approaches.
      expect(mission.approaches.every((a) => a.requiresSpellIds.length === 0)).toBe(true);
      expect(mission.approaches.at(-1)!.id).toBe('frontal-assault');
      fireEvent.click(
        screen.getByTestId('realm-mission-approach-option-frontal-assault'),
      );
      expect(onChoose).toHaveBeenCalledWith('frontal-assault');

      // Resolved display: d20 roll line + bloodless/battle guidance.
      const resolved = reduceRealm(accepted.session, {
        type: 'RESOLVE_MISSION_APPROACH',
        approachId: 'frontal-assault',
      }).session.activeWarMission!.resolved!;
      rerender(
        <RealmMissionApproachModal
          isOpen
          missionKind={mission.mission.kind}
          poiName={mission.poiName}
          approaches={mission.approaches}
          bonuses={bonuses}
          resolved={resolved}
          onChooseApproach={onChoose}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('realm-mission-approach-result')).toBeDefined();
      expect(screen.getByTestId('realm-mission-approach-headline').textContent!.length).toBeGreaterThan(0);
    });
  });

  describe('RealmPatrolModal', () => {
    it('shows four approaches with odds and post-resolution feedback', () => {
      const session = bootWar();
      const rival = rivalId(session);
      const heroes = getPartyList(session);
      const previews = buildPatrolPreviews({
        bluffBonus: 5,
        bluffActor: heroes[0]!.name,
        evadeBonus: 3,
        evadeActor: heroes[1]?.name ?? heroes[0]!.name,
        gold: session.travel.gold,
      });
      const { rerender } = render(
        <RealmPatrolModal
          isOpen
          nationId={rival}
          nationName={session.war!.nations[rival]!.name}
          threat={10}
          threatTier={getWarThreatTier(10)}
          gold={session.travel.gold}
          previews={previews}
          result={null}
          onChooseApproach={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('realm-patrol-modal')).toBeDefined();
      for (const approach of ['bluff', 'evade', 'bribe', 'fight'] as const) {
        expect(screen.getByTestId(`realm-patrol-option-${approach}`)).toBeDefined();
      }
      expect(screen.getByTestId('realm-patrol-odds-bluff').textContent).toContain('%');
      expect(screen.getByTestId('realm-patrol-odds-evade').textContent).toContain('%');
      expect(screen.getByTestId('realm-patrol-threat-line').textContent).toContain('10');

      rerender(
        <RealmPatrolModal
          isOpen
          nationId={rival}
          nationName={session.war!.nations[rival]!.name}
          threat={15}
          threatTier={getWarThreatTier(15)}
          gold={session.travel.gold}
          previews={previews}
          result={{ headline: 'The captain pockets 50gp and waves the party through (+5 Threat).', rollLine: null }}
          onChooseApproach={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('realm-patrol-result')).toBeDefined();
      expect(screen.getByTestId('realm-patrol-headline').textContent).toContain('+5 Threat');
    });
  });

  describe('RealmWarOutcomeModal', () => {
    function warWithOutcome(outcome: 'victory' | 'defeat'): RealmSessionState {
      const session = bootWar();
      const next = structuredClone(session);
      next.war!.outcome = outcome;
      next.war!.outcomeReason =
        outcome === 'victory' ? 'Your nation has reached 100 War Power.' : 'Your nation has fallen.';
      return next;
    }

    it('celebrates victory with reason and title CTA', () => {
      const session = warWithOutcome('victory');
      const onTitle = vi.fn();
      const onContinue = vi.fn();
      render(
        <RealmWarOutcomeModal
          isOpen
          war={session.war}
          onReturnToTitle={onTitle}
          onKeepExploring={onContinue}
        />,
      );
      expect(screen.getByTestId('realm-war-outcome-modal')).toBeDefined();
      expect(screen.getByTestId('realm-war-outcome-title').textContent).toContain('Victory');
      expect(screen.getByTestId('realm-war-outcome-reason').textContent).toContain('100 War Power');
      fireEvent.click(screen.getByTestId('realm-war-outcome-title-btn'));
      expect(onTitle).toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('realm-war-outcome-continue-btn'));
      expect(onContinue).toHaveBeenCalled();
    });

    it('mourns defeat and stays hidden while ongoing', () => {
      const defeated = warWithOutcome('defeat');
      render(
        <RealmWarOutcomeModal isOpen war={defeated.war} onReturnToTitle={vi.fn()} />,
      );
      expect(screen.getByTestId('realm-war-outcome-title').textContent).toContain('Defeat');
      cleanup();
      const ongoing = bootWar();
      const { container } = render(
        <RealmWarOutcomeModal isOpen war={ongoing.war} onReturnToTitle={vi.fn()} />,
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('RealmView war wiring', () => {
    it('launches new campaigns with the banner pick, opens the war room, and resolves a frontal assault into battle', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(
        <RealmView
          seed={SEED}
          compendium={defaultCompendium}
          storageAdapter={makeMemoryAdapter()}
          onExitToRoster={vi.fn()}
          onOpenCharacterSheet={vi.fn()}
        />,
      );
      // New campaigns launch with the nation select.
      expect(screen.getByTestId('realm-nation-select-modal')).toBeDefined();
      fireEvent.click(screen.getByTestId('realm-nation-option-dawn-crown'));
      expect(screen.queryByTestId('realm-nation-select-modal')).toBeNull();
      expect(screen.getByTestId('realm-hud-war-strip')).toBeDefined();
      expect(screen.getByTestId('realm-hud-war-room-btn')).toBeDefined();

      // War Room opens from the HUD toggle with ledger + diplomacy flows.
      fireEvent.click(screen.getByTestId('realm-hud-war-room-btn'));
      expect(screen.getByTestId('realm-war-room-modal')).toBeDefined();
      fireEvent.click(screen.getByTestId('realm-war-room-tab-diplomacy'));
      expect(screen.getByTestId('realm-war-room-diplomacy')).toBeDefined();
      fireEvent.click(screen.getByTestId('realm-war-room-close-btn'));

      // Accepting a mission opens the Approach Dialogue; frontal assault
      // mounts the tactical battle overlay.
      const bridges = screen.queryByTestId('realm-war-room-modal');
      expect(bridges).toBeNull();
      // Drive the mission flow headlessly (map POI targeting lives in the
      // War Room accept buttons, covered above) and verify battle mounting
      // through the engine path used by the modal.
      const fresh = bootWar();
      const bridge = findEnemyBridge(fresh);
      const approaches = buildMissionApproaches('destroy_bridge', bridge.kind, { seed: 1 });
      expect(approaches.at(-1)!.id).toBe('frontal-assault');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('surfaces the Victory ending when the war is won', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Seed a session whose war is already won: victory modal overlays map.
      const won = (() => {
        const s = bootWar();
        const next = structuredClone(s);
        next.war!.outcome = 'victory';
        next.war!.outcomeReason = `${next.war!.nations[next.war!.playerNationId]!.name} has reached 100 War Power.`;
        return next;
      })();
      expect(won.war!.outcome).toBe('victory');
      render(
        <RealmWarOutcomeModal
          isOpen
          war={won.war}
          onReturnToTitle={vi.fn()}
          onKeepExploring={vi.fn()}
        />,
      );
      expect(screen.getByTestId('realm-war-outcome-modal')).toBeDefined();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
