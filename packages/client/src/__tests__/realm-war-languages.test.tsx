import React from 'react';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getWarThreatTier } from '@srd5/engine';
import type { RealmSessionState } from '../components/realm/realmEngine.js';
import {
  createRealmSession,
  reduceRealm,
} from '../components/realm/realmEngine.js';
import { RealmWarRoomModal } from '../components/realm/RealmWarRoomModal.js';
import { RealmPatrolModal, buildPatrolPreviews } from '../components/realm/RealmPatrolModal.js';

/**
 * SRD-1214: War languages phase 1 — War Room UI (tongue badges, interpreter
 * hire row) and patrol language notes. Real engine sessions, deterministic.
 */

const SEED = 1214;

function bootWar(width = 48, height = 48): RealmSessionState {
  const fresh = createRealmSession({ seed: SEED, width, height });
  return reduceRealm(fresh, { type: 'SELECT_PLAYER_NATION' }).session;
}

function rivalId(session: RealmSessionState): string {
  return session.war!.nationOrder.find((id) => id !== session.war!.playerNationId)!;
}

describe('SRD-1214: War languages UI (Spec 11 §2.4)', () => {
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
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    vi.spyOn(Math, 'random');
  });

  it('badges every rival with its command tongue and offers the interpreter row', () => {
    const session = bootWar();
    const onHire = vi.fn();
    render(
      <RealmWarRoomModal
        isOpen
        war={session.war}
        diplomacy={session.diplomacy}
        map={session.map}
        currentDay={session.travel.currentDay}
        gold={session.travel.gold}
        initialTab="diplomacy"
        onClose={vi.fn()}
        onHireAsset={onHire}
      />,
    );
    expect(screen.getByTestId('realm-war-room-diplomacy')).toBeDefined();
    for (const nationId of session.war!.nationOrder.filter((id) => id !== session.war!.playerNationId)) {
      expect(screen.getByTestId(`realm-war-tongue-${nationId}`)).toBeDefined();
      expect(screen.getByTestId(`realm-war-tongue-${nationId}`).textContent).toContain('🗣️');
    }
    expect(screen.getByTestId('realm-war-hire-interpreter-btn')).toBeDefined();
    expect(screen.getByTestId('realm-war-hire-interpreter-btn').textContent).toContain('100 gp');
    fireEvent.click(screen.getByTestId('realm-war-hire-interpreter-btn'));
    expect(onHire).toHaveBeenCalledWith('interpreter');
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('shows the retained state once the interpreter is hired (engine round-trip)', () => {
    const session = bootWar();
    const hired = reduceRealm(session, {
      type: 'HIRE_COVERT_ASSET',
      asset: 'interpreter',
    });
    expect(hired.session.diplomacy.interpreterHired).toBe(true);
    expect(hired.events.some((e) => e.type === 'WAR_ASSET_HIRED')).toBe(true);
    render(
      <RealmWarRoomModal
        isOpen
        war={hired.session.war}
        diplomacy={hired.session.diplomacy}
        map={hired.session.map}
        currentDay={hired.session.travel.currentDay}
        gold={hired.session.travel.gold}
        initialTab="diplomacy"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('realm-war-hire-interpreter-btn').textContent).toContain('retained');
    expect(screen.getByTestId('realm-war-interpreter-note').textContent).toContain('+10 gp');
  });

  it('renders the patrol language note in the odds rows', () => {
    const session = bootWar();
    const rival = rivalId(session);
    const previews = buildPatrolPreviews({
      bluffBonus: 5,
      bluffActor: 'Hero',
      evadeBonus: 3,
      evadeActor: 'Hero',
      gold: session.travel.gold,
    });
    render(
      <RealmPatrolModal
        isOpen
        nationId={rival}
        nationName={session.war!.nations[rival]!.name}
        threat={10}
        threatTier={getWarThreatTier(10)}
        gold={session.travel.gold}
        previews={previews}
        result={null}
        languageNote="🗣️ In tongue (+2) — clean pass; gestures −2 (top tier locked)."
        onChooseApproach={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('realm-patrol-language-note').textContent).toContain('+2');
  });
});
