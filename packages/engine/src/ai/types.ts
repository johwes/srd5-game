import type { AiArchetype } from '@srd5/data';
import type { GridPoint, TacticalGrid } from '../grid/model.js';
import type { CombatState, Combatant } from '../combat/types.js';
import type { DispositionMatrix } from '../combat/allegiance.js';
import type { GameCommand } from '../state/types.js';

export interface PlanAiTurnOptions {
  state: CombatState;
  activeCombatantId: string;
  grid: TacticalGrid;
  dispositionMatrix?: DispositionMatrix;
  archetypeOverride?: AiArchetype;
}

export interface AiPlan {
  actorId: string;
  archetype: AiArchetype;
  commands: GameCommand[];
  reasoning: string;
}
