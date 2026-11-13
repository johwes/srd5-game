import {
  FORMULA_VARIABLES,
  type DieManipulationRule,
  type FormulaVariable,
} from '@srd5/data';
import {
  type DiceAstNode,
  type DiceTermModifier,
  type FormulaAstNode,
  formatDiceModifiers,
  parseFormula,
  tryParseFormula,
} from './ast.js';
import { normalizeSeed, rollDie } from './prng.js';

export type FormulaVariableName =
  | 'strMod'
  | 'dexMod'
  | 'conMod'
  | 'intMod'
  | 'wisMod'
  | 'chaMod'
  | 'prof'
  | 'charLevel'
  | 'classLevel'
  | 'slotLevel'
  | 'spellMod'
  | 'spellSaveDC';

export type FormulaContext = Partial<
  Record<FormulaVariable, number> & Record<FormulaVariableName, number>
>;

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

export interface RollModeSources {
  /** Explicit roll mode if known. */
  mode?: RollMode | undefined;
  /** Number of active Advantage sources on this roll. */
  advantageCount?: number | undefined;
  /** Number of active Disadvantage sources on this roll. */
  disadvantageCount?: number | undefined;
  /** Named Advantage sources (e.g. ['pack_tactics', 'guiding_bolt']). */
  advantageSources?: readonly string[] | undefined;
  /** Named Disadvantage sources (e.g. ['prone', 'poisoned']). */
  disadvantageSources?: readonly string[] | undefined;
}

export interface SingleDieRoll {
  faces: number;
  /** Final value of this die slot (after any reroll or min/max modifier). */
  value: number;
  /** First value rolled for this die slot before any rerolls. */
  initialRoll: number;
  /** Complete chronological sequence of values rolled for this die slot. */
  history: number[];
  /** Whether this die slot was kept (true) or dropped by kh/kl/dh/dl (false). */
  kept: boolean;
  /** Whether this die slot triggered a reroll. */
  rerolled: boolean;
  /** Reason for reroll if `rerolled` is true. */
  rerollReason?: 'halfling_lucky' | 'great_weapon_fighting' | 'modifier_reroll' | undefined;
}

export interface DiceGroupRollRecord {
  /** Canonical notation of this resolved dice group (e.g. "2d20kh1", "4d6kh3", "4d6"). */
  notation: string;
  /** Number of dice slots rolled in this group. */
  count: number;
  /** Number of faces per die in this group. */
  faces: number;
  /** Detailed per-die slot records. */
  dice: SingleDieRoll[];
  /** All individual die rolls made in this group (includes initial roll and replacement when rerolled). */
  rolls: number[];
  /** Values of the kept dice in this group. */
  kept: number[];
  /** Values of the dropped dice in this group (from kh/kl/dh/dl). */
  dropped: number[];
  /** Sum of `kept` dice in this group. */
  subtotal: number;
}

export interface DiceRollRecord {
  /** Original input formula string. */
  formula: string;
  /** Resolved notation after variable substitution, roll mode, and critical doubling. */
  resolvedNotation: string;
  /** Effective roll mode ('normal' | 'advantage' | 'disadvantage'). */
  mode: RollMode;
  /** Breakdown of each dice group rolled in the expression. */
  diceGroups: DiceGroupRollRecord[];
  /** Flat list of all die rolls made across all groups (includes initial rolls when rerolled). */
  rolls: number[];
  /** Flat list of all kept die values across all groups. */
  kept: number[];
  /** Initial die rolls that were replaced by a reroll (Halfling Lucky, Great Weapon Fighting, etc.). */
  rerolledInitialRolls: number[];
  /** Net flat numeric modifier (total minus signed sum of kept dice). */
  modifier: number;
  /** Final evaluated total of the formula. */
  total: number;
  /** Active natural d20 value if this roll had a primary d20 group. */
  naturalRoll?: number | undefined;
  /** Recorded if Halfling Lucky triggered on a natural 1 on the active d20. */
  halflingLuckyReroll?:
    | {
        initialRoll: number;
        replacementRoll: number;
      }
    | undefined;
  /** True if the active d20 roll met or exceeded the critical hit threshold (default 20). */
  naturalCrit?: boolean | undefined;
  /** True if the active d20 roll resulted in a natural 1. */
  naturalFumble?: boolean | undefined;
}

export interface DieManipulationInput {
  rule: DieManipulationRule;
  params?: Readonly<Record<string, number>> | undefined;
}

export interface EvaluateFormulaOptions extends RollModeSources {
  /** Seeded PRNG uint32 state (defaults to 0 if omitted). */
  rngState?: number | undefined;
  /** Variable substitution map (@strMod, @prof, @slotLevel, etc.). */
  context?: FormulaContext | undefined;
  /** If true, throws when a referenced @variable is not present in `context`. */
  strictVariables?: boolean | undefined;
  /** Halfling Lucky: rerolls a natural 1 on the active d20 once. */
  halflingLucky?: boolean | undefined;
  /** Great Weapon Fighting: rerolls 1s and 2s on damage dice once. */
  greatWeaponFighting?: boolean | undefined;
  /** Critical Hit: doubles all damage dice counts while adding flat modifiers once. */
  critical?: boolean | undefined;
  /** Alias for `critical`. */
  isCritical?: boolean | undefined;
  /** Additional primary weapon dice added on a critical hit (Brutal Critical / Savage Attacks). */
  extraCritDice?: number | undefined;
  /** Minimum natural d20 roll for a Critical Hit (default 20; 19 Improved Critical; 18 Superior Critical). */
  critRange?: number | undefined;
  /** Optional array of declarative `die_manipulation` modifiers from character traits/features. */
  dieManipulations?: readonly DieManipulationInput[] | undefined;
}

export interface EvaluateFormulaResult {
  record: DiceRollRecord;
  total: number;
  nextState: number;
}

const VALID_VARIABLE_SET: ReadonlySet<string> = new Set(FORMULA_VARIABLES);

/**
 * Resolves a `@variable` from a `FormulaContext`, supporting both `'@strMod'` and `'strMod'` keys.
 */
export function resolveFormulaVariable(
  name: FormulaVariable,
  context?: FormulaContext,
  strict = false,
): number {
  if (!VALID_VARIABLE_SET.has(name)) {
    throw new Error(`Unknown formula variable "${name}"`);
  }
  if (context) {
    const withAt = context[name];
    if (typeof withAt === 'number' && Number.isFinite(withAt)) {
      return withAt;
    }
    const bareName = name.slice(1) as FormulaVariableName;
    const withoutAt = context[bareName];
    if (typeof withoutAt === 'number' && Number.isFinite(withoutAt)) {
      return withoutAt;
    }
  }
  if (strict) {
    throw new Error(`Missing required formula variable "${name}" in evaluation context`);
  }
  return 0;
}

/**
 * Enforces the SRD 5.1 Advantage/Disadvantage Cancellation Rule:
 * - If an actor has >= 1 source of Advantage AND >= 1 source of Disadvantage
 *   (regardless of how many of each, e.g., 3 Advantage vs 1 Disadvantage),
 *   they cancel out completely to `'normal'`.
 */
export function resolveRollMode(input?: RollModeSources | RollMode): RollMode {
  if (!input) return 'normal';
  if (typeof input === 'string') return input;

  const advCount =
    (input.advantageCount ?? 0) +
    (input.advantageSources?.length ?? 0) +
    (input.mode === 'advantage' ? 1 : 0);
  const disadvCount =
    (input.disadvantageCount ?? 0) +
    (input.disadvantageSources?.length ?? 0) +
    (input.mode === 'disadvantage' ? 1 : 0);

  if (advCount > 0 && disadvCount > 0) {
    return 'normal';
  }
  if (advCount > 0) {
    return 'advantage';
  }
  if (disadvCount > 0) {
    return 'disadvantage';
  }
  return 'normal';
}

function hasCancelledSources(input?: RollModeSources): boolean {
  if (!input) return false;
  const advCount =
    (input.advantageCount ?? 0) +
    (input.advantageSources?.length ?? 0) +
    (input.mode === 'advantage' ? 1 : 0);
  const disadvCount =
    (input.disadvantageCount ?? 0) +
    (input.disadvantageSources?.length ?? 0) +
    (input.mode === 'disadvantage' ? 1 : 0);
  return advCount > 0 && disadvCount > 0;
}

function extractDieManipulationFlags(options?: EvaluateFormulaOptions): {
  halflingLucky: boolean;
  greatWeaponFighting: boolean;
  extraCritDice: number;
  critRange: number;
} {
  let halflingLucky = Boolean(options?.halflingLucky);
  let greatWeaponFighting = Boolean(options?.greatWeaponFighting);
  let extraCritDice = options?.extraCritDice ?? 0;
  let critRange = options?.critRange ?? 20;

  for (const manip of options?.dieManipulations ?? []) {
    switch (manip.rule) {
      case 'halfling_lucky':
        halflingLucky = true;
        break;
      case 'great_weapon_fighting':
        greatWeaponFighting = true;
        break;
      case 'brutal_critical':
        extraCritDice += manip.params?.['extraDice'] ?? 1;
        break;
      case 'savage_attacks':
        extraCritDice += manip.params?.['extraDice'] ?? 1;
        break;
      case 'expanded_crit_range': {
        const minRoll = manip.params?.['minCritRoll'];
        if (typeof minRoll === 'number' && minRoll < critRange) {
          critRange = minRoll;
        }
        break;
      }
    }
  }

  return {
    halflingLucky,
    greatWeaponFighting,
    extraCritDice: Math.max(0, Math.floor(extraCritDice)),
    critRange: Math.min(20, Math.max(1, Math.floor(critRange))),
  };
}

function applyKeepDropModifiers(dice: SingleDieRoll[], modifiers: readonly DiceTermModifier[]): void {
  for (const mod of modifiers) {
    if (
      mod.type !== 'keep_highest' &&
      mod.type !== 'keep_lowest' &&
      mod.type !== 'drop_highest' &&
      mod.type !== 'drop_lowest'
    ) {
      continue;
    }

    const activeIndices = dice
      .map((d, idx) => ({ d, idx }))
      .filter((entry) => entry.d.kept);

    const totalActive = activeIndices.length;
    let keepCount = totalActive;
    let sortDescending = true;

    switch (mod.type) {
      case 'keep_highest':
        keepCount = Math.min(totalActive, Math.max(0, mod.value));
        sortDescending = true;
        break;
      case 'keep_lowest':
        keepCount = Math.min(totalActive, Math.max(0, mod.value));
        sortDescending = false;
        break;
      case 'drop_highest':
        keepCount = Math.max(0, totalActive - Math.max(0, mod.value));
        sortDescending = false; // keep the lowest `keepCount`
        break;
      case 'drop_lowest':
        keepCount = Math.max(0, totalActive - Math.max(0, mod.value));
        sortDescending = true; // keep the highest `keepCount`
        break;
    }

    const sorted = [...activeIndices].sort((a, b) => {
      if (a.d.value !== b.d.value) {
        return sortDescending ? b.d.value - a.d.value : a.d.value - b.d.value;
      }
      return a.idx - b.idx;
    });

    const keptIndexSet = new Set(sorted.slice(0, keepCount).map((entry) => entry.idx));
    for (const entry of activeIndices) {
      entry.d.kept = keptIndexSet.has(entry.idx);
    }
  }
}

/**
 * Evaluates a 5e dice or arithmetic formula against a seeded PRNG state and variable context,
 * returning the numeric total, the next PRNG state, and a complete `DiceRollRecord`.
 */
export function evaluateFormula(
  formula: string | FormulaAstNode,
  options?: EvaluateFormulaOptions,
): EvaluateFormulaResult {
  const ast = typeof formula === 'string' ? parseFormula(formula) : formula;
  const formulaStr = typeof formula === 'string' ? formula.trim() : formatAstOriginal(ast);

  let currentState = normalizeSeed(options?.rngState ?? 0);
  let effectiveMode = resolveRollMode(options);
  const cancelledBySources = hasCancelledSources(options);
  const isCritical = Boolean(options?.critical || options?.isCritical);
  const strictVars = Boolean(options?.strictVariables);
  const { halflingLucky, greatWeaponFighting, extraCritDice, critRange } =
    extractDieManipulationFlags(options);

  const diceGroups: DiceGroupRollRecord[] = [];
  const rerolledInitialRolls: number[] = [];
  let halflingLuckyReroll: DiceRollRecord['halflingLuckyReroll'];
  let signedDiceSubtotal = 0;
  let firstDiceVisited = false;

  interface NodeEvalResult {
    value: number;
    notation: string;
  }

  function evalNode(node: FormulaAstNode, signMultiplier: 1 | -1): NodeEvalResult {
    switch (node.type) {
      case 'number':
        return {
          value: node.value,
          notation: String(node.value),
        };

      case 'variable': {
        const val = resolveFormulaVariable(node.name, options?.context, strictVars);
        return {
          value: val,
          notation: String(val),
        };
      }

      case 'unary': {
        const nextSign: 1 | -1 =
          node.operator === '-' ? (signMultiplier === 1 ? -1 : 1) : signMultiplier;
        const inner = evalNode(node.operand, nextSign);
        const val = node.operator === '-' ? -inner.value : inner.value;
        const notation =
          node.operand.type === 'binary'
            ? `${node.operator}(${inner.notation})`
            : `${node.operator}${inner.notation}`;
        return { value: val, notation };
      }

      case 'binary': {
        if (node.operator === '+') {
          const left = evalNode(node.left, signMultiplier);
          const right = evalNode(node.right, signMultiplier);
          return {
            value: left.value + right.value,
            notation: `${left.notation} + ${right.notation}`,
          };
        }
        if (node.operator === '-') {
          const left = evalNode(node.left, signMultiplier);
          const flippedSign: 1 | -1 = signMultiplier === 1 ? -1 : 1;
          const right = evalNode(node.right, flippedSign);
          const rightNot =
            node.right.type === 'binary' &&
            (node.right.operator === '+' || node.right.operator === '-')
              ? `(${right.notation})`
              : right.notation;
          return {
            value: left.value - right.value,
            notation: `${left.notation} - ${rightNot}`,
          };
        }
        if (node.operator === '*') {
          const left = evalNode(node.left, signMultiplier);
          const right = evalNode(node.right, 1);
          const leftNot =
            node.left.type === 'binary' &&
            (node.left.operator === '+' || node.left.operator === '-')
              ? `(${left.notation})`
              : left.notation;
          const rightNot =
            node.right.type === 'binary' &&
            (node.right.operator === '+' || node.right.operator === '-')
              ? `(${right.notation})`
              : right.notation;
          return {
            value: left.value * right.value,
            notation: `${leftNot} * ${rightNot}`,
          };
        }
        // '/'
        const left = evalNode(node.left, signMultiplier);
        const right = evalNode(node.right, 1);
        if (right.value === 0) {
          throw new Error(`Division by zero while evaluating formula "${formulaStr}"`);
        }
        const leftNot =
          node.left.type === 'binary' &&
          (node.left.operator === '+' || node.left.operator === '-')
            ? `(${left.notation})`
            : left.notation;
        const rightNot =
          node.right.type === 'binary' ? `(${right.notation})` : right.notation;
        return {
          value: left.value / right.value,
          notation: `${leftNot} / ${rightNot}`,
        };
      }

      case 'function': {
        const evaluatedArgs = node.args.map((arg) => evalNode(arg, 1));
        const argVals = evaluatedArgs.map((a) => a.value);
        let result: number;
        switch (node.name) {
          case 'max':
            result = Math.max(...argVals);
            break;
          case 'min':
            result = Math.min(...argVals);
            break;
          case 'floor':
            result = Math.floor(argVals[0]!);
            break;
          case 'ceil':
            result = Math.ceil(argVals[0]!);
            break;
        }
        return {
          value: result,
          notation: `${node.name}(${evaluatedArgs.map((a) => a.notation).join(', ')})`,
        };
      }

      case 'dice':
        return evalDiceNode(node, signMultiplier);
    }
  }

  function evalDiceNode(node: DiceAstNode, signMultiplier: 1 | -1): NodeEvalResult {
    const isFirstDiceGroup = !firstDiceVisited;
    firstDiceVisited = true;

    let baseCount: number;
    if (typeof node.count === 'number') {
      baseCount = node.count;
    } else {
      const countRes = evalNode(node.count, 1);
      baseCount = Math.max(0, Math.floor(countRes.value));
    }

    let effectiveCount = baseCount;
    let effectiveModifiers: DiceTermModifier[] = [...node.modifiers];

    const hasKeepDrop = effectiveModifiers.some(
      (m) =>
        m.type === 'keep_highest' ||
        m.type === 'keep_lowest' ||
        m.type === 'drop_highest' ||
        m.type === 'drop_lowest',
    );

    if (node.faces === 20) {
      if (effectiveCount === 1 && !hasKeepDrop) {
        if (effectiveMode === 'advantage') {
          effectiveCount = 2;
          effectiveModifiers.push({ type: 'keep_highest', value: 1 });
        } else if (effectiveMode === 'disadvantage') {
          effectiveCount = 2;
          effectiveModifiers.push({ type: 'keep_lowest', value: 1 });
        }
      } else if (effectiveCount === 2 && hasKeepDrop) {
        if (cancelledBySources) {
          // SRD Cancellation Rule overrides explicit 2d20kh1 / 2d20kl1 when both sources exist
          effectiveCount = 1;
          effectiveModifiers = effectiveModifiers.filter(
            (m) =>
              m.type !== 'keep_highest' &&
              m.type !== 'keep_lowest' &&
              m.type !== 'drop_highest' &&
              m.type !== 'drop_lowest',
          );
          effectiveMode = 'normal';
        } else if (effectiveMode === 'normal') {
          // Infer roll mode from explicit 2d20kh1 / 2d20kl1 notation
          const kh1 = effectiveModifiers.some(
            (m) =>
              (m.type === 'keep_highest' && m.value === 1) ||
              (m.type === 'drop_lowest' && m.value === 1),
          );
          const kl1 = effectiveModifiers.some(
            (m) =>
              (m.type === 'keep_lowest' && m.value === 1) ||
              (m.type === 'drop_highest' && m.value === 1),
          );
          if (kh1) effectiveMode = 'advantage';
          else if (kl1) effectiveMode = 'disadvantage';
        }
      }
    }

    // Critical Hit dice doubling (applies to damage dice; does not double d20 attack rolls with kh/kl)
    const isD20CheckWithKeepDrop =
      node.faces === 20 &&
      effectiveModifiers.some((m) => m.type === 'keep_highest' || m.type === 'keep_lowest');
    if (isCritical && !isD20CheckWithKeepDrop) {
      effectiveCount = effectiveCount * 2 + (isFirstDiceGroup ? extraCritDice : 0);
    }

    const dice: SingleDieRoll[] = [];

    for (let i = 0; i < effectiveCount; i++) {
      const firstRoll = rollDie(currentState, node.faces);
      currentState = firstRoll.nextState;

      let currentVal = firstRoll.roll;
      const history: number[] = [currentVal];
      let rerolled = false;
      let rerollReason: SingleDieRoll['rerollReason'];

      // Great Weapon Fighting: reroll 1 or 2 once on damage dice
      if (greatWeaponFighting && node.faces !== 20 && (currentVal === 1 || currentVal === 2)) {
        const gwfRoll = rollDie(currentState, node.faces);
        currentState = gwfRoll.nextState;
        rerolledInitialRolls.push(currentVal);
        currentVal = gwfRoll.roll;
        history.push(currentVal);
        rerolled = true;
        rerollReason = 'great_weapon_fighting';
      }

      // Check explicit AST reroll modifiers (`ro<N>`, `r<N>`)
      for (const mod of effectiveModifiers) {
        if (mod.type === 'reroll_once' && !rerolled && currentVal <= mod.value) {
          const roRes = rollDie(currentState, node.faces);
          currentState = roRes.nextState;
          rerolledInitialRolls.push(currentVal);
          currentVal = roRes.roll;
          history.push(currentVal);
          rerolled = true;
          rerollReason = 'modifier_reroll';
        } else if (mod.type === 'reroll' && mod.value < node.faces) {
          let guard = 0;
          while (currentVal <= mod.value && guard < 100) {
            const rRes = rollDie(currentState, node.faces);
            currentState = rRes.nextState;
            rerolledInitialRolls.push(currentVal);
            currentVal = rRes.roll;
            history.push(currentVal);
            rerolled = true;
            rerollReason = 'modifier_reroll';
            guard++;
          }
        }
      }

      // Check explicit AST min/max modifiers
      for (const mod of effectiveModifiers) {
        if (mod.type === 'min' && currentVal < mod.value) {
          currentVal = mod.value;
        } else if (mod.type === 'max' && currentVal > mod.value) {
          currentVal = mod.value;
        }
      }

      dice.push({
        faces: node.faces,
        value: currentVal,
        initialRoll: firstRoll.roll,
        history,
        kept: true,
        rerolled,
        rerollReason,
      });
    }

    // Apply kh / kl / dh / dl modifiers
    applyKeepDropModifiers(dice, effectiveModifiers);

    // Halfling Lucky: when rolling a natural 1 on the active (kept) d20, reroll once and use replacement
    if (halflingLucky && node.faces === 20) {
      const activeD20 = dice.find((d) => d.kept);
      if (activeD20 && activeD20.value === 1 && !activeD20.rerolled) {
        const luckyRoll = rollDie(currentState, 20);
        currentState = luckyRoll.nextState;
        const replacementRoll = luckyRoll.roll;
        rerolledInitialRolls.push(1);
        activeD20.history.push(replacementRoll);
        activeD20.value = replacementRoll;
        activeD20.rerolled = true;
        activeD20.rerollReason = 'halfling_lucky';
        halflingLuckyReroll = {
          initialRoll: 1,
          replacementRoll,
        };
      }
    }

    const groupNotation = `${effectiveCount}d${node.faces}${formatDiceModifiers(effectiveModifiers)}`;
    const rolls = dice.flatMap((d) => d.history);
    const kept = dice.filter((d) => d.kept).map((d) => d.value);
    const dropped = dice.filter((d) => !d.kept).map((d) => d.value);
    const subtotal = kept.reduce((sum, val) => sum + val, 0);

    diceGroups.push({
      notation: groupNotation,
      count: effectiveCount,
      faces: node.faces,
      dice,
      rolls,
      kept,
      dropped,
      subtotal,
    });

    signedDiceSubtotal += signMultiplier * subtotal;

    return {
      value: subtotal,
      notation: groupNotation,
    };
  }

  const rootResult = evalNode(ast, 1);
  const total = rootResult.value;
  const allRolls = diceGroups.flatMap((g) => g.rolls);
  const allKept = diceGroups.flatMap((g) => g.kept);
  const modifier = total - signedDiceSubtotal;

  let naturalRoll: number | undefined;
  let naturalCrit: boolean | undefined;
  let naturalFumble: boolean | undefined;

  const primaryGroup = diceGroups[0];
  if (primaryGroup && primaryGroup.faces === 20 && primaryGroup.kept.length === 1) {
    naturalRoll = primaryGroup.kept[0]!;
    naturalCrit = naturalRoll >= critRange;
    naturalFumble = naturalRoll === 1;
  }

  const record: DiceRollRecord = {
    formula: formulaStr,
    resolvedNotation: rootResult.notation,
    mode: effectiveMode,
    diceGroups,
    rolls: allRolls,
    kept: allKept,
    rerolledInitialRolls,
    modifier,
    total,
    ...(naturalRoll !== undefined ? { naturalRoll } : {}),
    ...(halflingLuckyReroll !== undefined ? { halflingLuckyReroll } : {}),
    ...(naturalCrit !== undefined ? { naturalCrit } : {}),
    ...(naturalFumble !== undefined ? { naturalFumble } : {}),
  };

  return {
    record,
    total,
    nextState: currentState,
  };
}

function formatAstOriginal(node: FormulaAstNode): string {
  switch (node.type) {
    case 'number':
      return String(node.value);
    case 'variable':
      return node.name;
    case 'dice':
      return node.notation;
    case 'unary':
      return `${node.operator}${formatAstOriginal(node.operand)}`;
    case 'binary':
      return `${formatAstOriginal(node.left)} ${node.operator} ${formatAstOriginal(node.right)}`;
    case 'function':
      return `${node.name}(${node.args.map(formatAstOriginal).join(', ')})`;
  }
}

/**
 * State-first convenience wrapper around `evaluateFormula` matching `rollDie(state, faces)`.
 */
export function rollDiceExpression(
  state: number,
  formula: string | FormulaAstNode,
  options?: Omit<EvaluateFormulaOptions, 'rngState'>,
): EvaluateFormulaResult {
  return evaluateFormula(formula, { ...options, rngState: state });
}

/**
 * Evaluates a deterministic arithmetic/function formula (e.g. AC formulas, spell save DC, resource max)
 * that contains no random dice terms. Throws if the formula contains any dice terms.
 */
export function evaluateStaticFormula(
  formula: string | FormulaAstNode,
  context?: FormulaContext,
  strictVariables = false,
): number {
  const ast = typeof formula === 'string' ? parseFormula(formula) : formula;
  assertNoDiceNodes(ast, typeof formula === 'string' ? formula : formatAstOriginal(ast));
  const { total } = evaluateFormula(ast, {
    rngState: 0,
    context,
    strictVariables,
  });
  return total;
}

function assertNoDiceNodes(node: FormulaAstNode, formulaStr: string): void {
  switch (node.type) {
    case 'number':
    case 'variable':
      return;
    case 'dice':
      throw new Error(
        `Static formula "${formulaStr}" cannot contain dice term "${node.notation}"`,
      );
    case 'unary':
      assertNoDiceNodes(node.operand, formulaStr);
      return;
    case 'binary':
      assertNoDiceNodes(node.left, formulaStr);
      assertNoDiceNodes(node.right, formulaStr);
      return;
    case 'function':
      for (const arg of node.args) {
        assertNoDiceNodes(arg, formulaStr);
      }
      return;
  }
}

export interface D20RollOptions extends Omit<EvaluateFormulaOptions, 'rngState' | 'critical' | 'isCritical'> {
  /** Flat integer bonus to add to the d20 roll (e.g. +5). */
  modifier?: number | undefined;
  /** Additional bonus formula string (e.g. "@strMod + @prof" or "1d4" for Bless). */
  bonusFormula?: string | undefined;
}

export interface D20RollResult {
  record: DiceRollRecord;
  total: number;
  naturalRoll: number;
  isCrit: boolean;
  isFumble: boolean;
  nextState: number;
}

/**
 * Rolls a 5e d20 test (Attack Roll, Saving Throw, or Ability Check) with support for
 * Advantage, Disadvantage, Advantage+Disadvantage cancellation, Halfling Lucky,
 * expanded critical hit ranges (19-20, 18-20), and bonus formulas.
 */
export function rollD20(state: number, options?: D20RollOptions): D20RollResult {
  const parts: string[] = ['1d20'];
  if (options?.bonusFormula && options.bonusFormula.trim().length > 0) {
    const trimmed = options.bonusFormula.trim();
    if (trimmed.startsWith('+') || trimmed.startsWith('-')) {
      parts.push(trimmed);
    } else {
      parts.push(`+ ${trimmed}`);
    }
  }
  if (typeof options?.modifier === 'number' && options.modifier !== 0) {
    parts.push(options.modifier > 0 ? `+ ${options.modifier}` : `- ${Math.abs(options.modifier)}`);
  }

  const formula = parts.join(' ');
  const res = evaluateFormula(formula, {
    ...options,
    rngState: state,
  });

  const naturalRoll = res.record.naturalRoll ?? res.record.kept[0] ?? 1;
  const isCrit = Boolean(res.record.naturalCrit);
  const isFumble = Boolean(res.record.naturalFumble);

  return {
    record: res.record,
    total: res.total,
    naturalRoll,
    isCrit,
    isFumble,
    nextState: res.nextState,
  };
}

export type DamageRollOptions = Omit<EvaluateFormulaOptions, 'rngState'>;

/**
 * Rolls a 5e damage formula with support for Critical Hit dice doubling,
 * Brutal Critical / Savage Attacks extra weapon dice, Great Weapon Fighting rerolls,
 * and variable substitution.
 */
export function rollDamage(
  state: number,
  formula: string | FormulaAstNode,
  options?: DamageRollOptions,
): EvaluateFormulaResult {
  return evaluateFormula(formula, {
    ...options,
    rngState: state,
  });
}

export interface AbilityRollSetResult {
  scores: [number, number, number, number, number, number];
  records: [
    DiceRollRecord,
    DiceRollRecord,
    DiceRollRecord,
    DiceRollRecord,
    DiceRollRecord,
    DiceRollRecord,
  ];
  nextState: number;
}

/**
 * Generates a full set of 6 SRD ability scores using `4d6kh3` (roll 4d6, keep highest 3)
 * deterministically from the given `state` seed.
 */
export function rollAbilityScores4d6kh3(state: number): AbilityRollSetResult {
  let currentState = normalizeSeed(state);
  const scores: number[] = [];
  const records: DiceRollRecord[] = [];

  for (let i = 0; i < 6; i++) {
    const res = evaluateFormula('4d6kh3', { rngState: currentState });
    scores.push(res.total);
    records.push(res.record);
    currentState = res.nextState;
  }

  return {
    scores: scores as [number, number, number, number, number, number],
    records: records as [
      DiceRollRecord,
      DiceRollRecord,
      DiceRollRecord,
      DiceRollRecord,
      DiceRollRecord,
      DiceRollRecord,
    ],
    nextState: currentState,
  };
}

/**
 * Validates a formula string using `@srd5/engine`'s full expression AST parser.
 */
export function validateEngineFormula(
  formula: string,
): { valid: true; ast: FormulaAstNode } | { valid: false; error: string } {
  return tryParseFormula(formula);
}
