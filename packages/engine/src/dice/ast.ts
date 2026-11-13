import {
  FORMULA_FUNCTIONS,
  FORMULA_VARIABLES,
  type FormulaFunction,
  type FormulaVariable,
} from '@srd5/data';

export type DiceTermModifierType =
  | 'keep_highest'
  | 'keep_lowest'
  | 'drop_highest'
  | 'drop_lowest'
  | 'reroll'
  | 'reroll_once'
  | 'min'
  | 'max';

export interface DiceTermModifier {
  type: DiceTermModifierType;
  value: number;
}

export interface NumberAstNode {
  type: 'number';
  value: number;
}

export interface VariableAstNode {
  type: 'variable';
  name: FormulaVariable;
}

export interface DiceAstNode {
  type: 'dice';
  count: number | FormulaAstNode;
  faces: number;
  modifiers: DiceTermModifier[];
  notation: string;
}

export interface UnaryAstNode {
  type: 'unary';
  operator: '+' | '-';
  operand: FormulaAstNode;
}

export interface BinaryAstNode {
  type: 'binary';
  operator: '+' | '-' | '*' | '/';
  left: FormulaAstNode;
  right: FormulaAstNode;
}

export interface FunctionAstNode {
  type: 'function';
  name: FormulaFunction;
  args: FormulaAstNode[];
}

export type FormulaAstNode =
  | NumberAstNode
  | VariableAstNode
  | DiceAstNode
  | UnaryAstNode
  | BinaryAstNode
  | FunctionAstNode;

export class FormulaParseError extends Error {
  public readonly formula: string;
  public readonly position: number | undefined;

  constructor(message: string, formula: string, position?: number) {
    super(message);
    this.name = 'FormulaParseError';
    this.formula = formula;
    this.position = position;
  }
}

const VALID_VARIABLE_SET: ReadonlySet<string> = new Set(FORMULA_VARIABLES);
const VALID_FUNCTION_SET: ReadonlySet<string> = new Set(FORMULA_FUNCTIONS);

type Token =
  | {
      kind: 'dice_literal';
      count: number;
      faces: number;
      modifiers: DiceTermModifier[];
      raw: string;
      pos: number;
    }
  | {
      kind: 'dice_tail';
      faces: number;
      modifiers: DiceTermModifier[];
      raw: string;
      pos: number;
    }
  | { kind: 'number'; value: number; raw: string; pos: number }
  | { kind: 'variable'; name: FormulaVariable; raw: string; pos: number }
  | { kind: 'identifier'; name: string; pos: number }
  | { kind: 'operator'; op: '+' | '-' | '*' | '/'; pos: number }
  | { kind: 'lparen'; pos: number }
  | { kind: 'rparen'; pos: number }
  | { kind: 'comma'; pos: number };

const MODIFIER_REGEX = /(kh|kl|dh|dl|ro|r|min|max)(\d+)/gi;

function parseDiceModifiers(
  modStr: string,
  formula: string,
  pos: number,
): DiceTermModifier[] {
  if (!modStr) return [];
  const modifiers: DiceTermModifier[] = [];
  MODIFIER_REGEX.lastIndex = 0;
  let cursor = 0;
  while (cursor < modStr.length) {
    MODIFIER_REGEX.lastIndex = cursor;
    const match = MODIFIER_REGEX.exec(modStr);
    if (!match || match.index !== cursor) {
      throw new FormulaParseError(
        `Invalid dice modifier "${modStr.slice(cursor)}" in "${formula}"`,
        formula,
        pos + cursor,
      );
    }
    cursor = MODIFIER_REGEX.lastIndex;
    const code = match[1]!.toLowerCase();
    const val = Number.parseInt(match[2]!, 10);
    if (!Number.isInteger(val) || val < 1) {
      throw new FormulaParseError(
        `Dice modifier "${code}" requires a positive integer in "${formula}"`,
        formula,
        pos,
      );
    }
    let type: DiceTermModifierType;
    switch (code) {
      case 'kh':
        type = 'keep_highest';
        break;
      case 'kl':
        type = 'keep_lowest';
        break;
      case 'dh':
        type = 'drop_highest';
        break;
      case 'dl':
        type = 'drop_lowest';
        break;
      case 'ro':
        type = 'reroll_once';
        break;
      case 'r':
        type = 'reroll';
        break;
      case 'min':
        type = 'min';
        break;
      case 'max':
        type = 'max';
        break;
      default:
        throw new FormulaParseError(
          `Unknown dice modifier "${code}" in "${formula}"`,
          formula,
          pos,
        );
    }
    modifiers.push({ type, value: val });
  }
  return modifiers;
}

export function formatDiceModifiers(modifiers: readonly DiceTermModifier[]): string {
  return modifiers
    .map((m) => {
      switch (m.type) {
        case 'keep_highest':
          return `kh${m.value}`;
        case 'keep_lowest':
          return `kl${m.value}`;
        case 'drop_highest':
          return `dh${m.value}`;
        case 'drop_lowest':
          return `dl${m.value}`;
        case 'reroll_once':
          return `ro${m.value}`;
        case 'reroll':
          return `r${m.value}`;
        case 'min':
          return `min${m.value}`;
        case 'max':
          return `max${m.value}`;
      }
    })
    .join('');
}

function tokenizeFormula(formula: string): Token[] {
  const trimmed = formula.trim();
  if (!trimmed) {
    throw new FormulaParseError('Formula cannot be empty', formula, 0);
  }

  const tokens: Token[] = [];
  const masterRegex =
    /\s+|(\d+)[dD](\d+)((?:(?:kh|kl|dh|dl|ro|r|min|max)\d+)*)|[dD](\d+)((?:(?:kh|kl|dh|dl|ro|r|min|max)\d+)*)|(\d+(?:\.\d+)?)|(@[a-zA-Z_][a-zA-Z0-9_]*)|([a-zA-Z_][a-zA-Z0-9_]*)|([+\-*/(),])/gy;

  let pos = 0;
  while (pos < trimmed.length) {
    masterRegex.lastIndex = pos;
    const match = masterRegex.exec(trimmed);
    if (!match) {
      throw new FormulaParseError(
        `Unexpected token at position ${pos} ("${trimmed.slice(pos, pos + 12)}") in "${formula}"`,
        formula,
        pos,
      );
    }
    const tokenPos = pos;
    pos = masterRegex.lastIndex;

    // 1. Dice literal: <count>d<faces><modifiers>
    if (match[1] !== undefined && match[2] !== undefined) {
      const count = Number.parseInt(match[1], 10);
      const faces = Number.parseInt(match[2], 10);
      const modStr = match[3] ?? '';
      if (count < 1) {
        throw new FormulaParseError(
          `Dice count must be >= 1 in "${match[0]}"`,
          formula,
          tokenPos,
        );
      }
      if (faces < 1) {
        throw new FormulaParseError(
          `Die faces must be >= 1 in "${match[0]}"`,
          formula,
          tokenPos,
        );
      }
      const modifiers = parseDiceModifiers(modStr, formula, tokenPos);
      tokens.push({
        kind: 'dice_literal',
        count,
        faces,
        modifiers,
        raw: `${count}d${faces}${formatDiceModifiers(modifiers)}`,
        pos: tokenPos,
      });
      continue;
    }

    // 2. Dice tail: d<faces><modifiers> (used for `d20` or `(@slotLevel + 5)d6`)
    if (match[4] !== undefined) {
      const faces = Number.parseInt(match[4], 10);
      const modStr = match[5] ?? '';
      if (faces < 1) {
        throw new FormulaParseError(
          `Die faces must be >= 1 in "${match[0]}"`,
          formula,
          tokenPos,
        );
      }
      const modifiers = parseDiceModifiers(modStr, formula, tokenPos);
      tokens.push({
        kind: 'dice_tail',
        faces,
        modifiers,
        raw: `d${faces}${formatDiceModifiers(modifiers)}`,
        pos: tokenPos,
      });
      continue;
    }

    // 3. Number literal
    if (match[6] !== undefined) {
      const value = Number.parseFloat(match[6]);
      if (!Number.isFinite(value)) {
        throw new FormulaParseError(`Invalid number "${match[6]}"`, formula, tokenPos);
      }
      tokens.push({
        kind: 'number',
        value,
        raw: match[6],
        pos: tokenPos,
      });
      continue;
    }

    // 4. @variable
    if (match[7] !== undefined) {
      const varName = match[7];
      if (!VALID_VARIABLE_SET.has(varName)) {
        throw new FormulaParseError(
          `Unknown formula variable "${varName}" in "${formula}"`,
          formula,
          tokenPos,
        );
      }
      tokens.push({
        kind: 'variable',
        name: varName as FormulaVariable,
        raw: varName,
        pos: tokenPos,
      });
      continue;
    }

    // 5. Identifier (function name)
    if (match[8] !== undefined) {
      tokens.push({
        kind: 'identifier',
        name: match[8],
        pos: tokenPos,
      });
      continue;
    }

    // 6. Punctuation / Operator
    if (match[9] !== undefined) {
      const ch = match[9];
      if (ch === '(') {
        tokens.push({ kind: 'lparen', pos: tokenPos });
      } else if (ch === ')') {
        tokens.push({ kind: 'rparen', pos: tokenPos });
      } else if (ch === ',') {
        tokens.push({ kind: 'comma', pos: tokenPos });
      } else if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
        tokens.push({ kind: 'operator', op: ch, pos: tokenPos });
      }
      continue;
    }
  }

  return tokens;
}

/**
 * Parses a 5e dice or arithmetic formula string into a typed Abstract Syntax Tree (`FormulaAstNode`).
 * Throws `FormulaParseError` if the formula syntax, variable names, or function signatures are invalid.
 */
export function parseFormula(formula: string): FormulaAstNode {
  const tokens = tokenizeFormula(formula);
  if (tokens.length === 0) {
    throw new FormulaParseError('Formula contains no tokens', formula, 0);
  }

  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const consume = (): Token => {
    const tok = tokens[index];
    if (!tok) {
      throw new FormulaParseError(`Unexpected end of formula "${formula}"`, formula);
    }
    index++;
    return tok;
  };

  function parseExpression(): FormulaAstNode {
    return parseAdditive();
  }

  function parseAdditive(): FormulaAstNode {
    let left = parseMultiplicative();
    while (true) {
      const next = peek();
      if (next && next.kind === 'operator' && (next.op === '+' || next.op === '-')) {
        consume();
        const right = parseMultiplicative();
        left = {
          type: 'binary',
          operator: next.op,
          left,
          right,
        };
      } else {
        break;
      }
    }
    return left;
  }

  function parseMultiplicative(): FormulaAstNode {
    let left = parseUnary();
    while (true) {
      const next = peek();
      if (next && next.kind === 'operator' && (next.op === '*' || next.op === '/')) {
        consume();
        const right = parseUnary();
        left = {
          type: 'binary',
          operator: next.op,
          left,
          right,
        };
      } else {
        break;
      }
    }
    return left;
  }

  function parseUnary(): FormulaAstNode {
    const next = peek();
    if (next && next.kind === 'operator' && (next.op === '+' || next.op === '-')) {
      consume();
      const operand = parseUnary();
      return {
        type: 'unary',
        operator: next.op,
        operand,
      };
    }
    return parsePrimary();
  }

  function parsePrimary(): FormulaAstNode {
    const tok = peek();
    if (!tok) {
      throw new FormulaParseError(
        `Unexpected end of formula while expecting expression in "${formula}"`,
        formula,
      );
    }

    if (tok.kind === 'dice_literal') {
      consume();
      return {
        type: 'dice',
        count: tok.count,
        faces: tok.faces,
        modifiers: tok.modifiers,
        notation: tok.raw,
      };
    }

    if (tok.kind === 'dice_tail') {
      consume();
      return {
        type: 'dice',
        count: 1,
        faces: tok.faces,
        modifiers: tok.modifiers,
        notation: `1${tok.raw}`,
      };
    }

    if (tok.kind === 'number') {
      consume();
      return {
        type: 'number',
        value: tok.value,
      };
    }

    if (tok.kind === 'variable') {
      consume();
      const varNode: VariableAstNode = {
        type: 'variable',
        name: tok.name,
      };
      const maybeTail = peek();
      if (maybeTail && maybeTail.kind === 'dice_tail') {
        consume();
        return {
          type: 'dice',
          count: varNode,
          faces: maybeTail.faces,
          modifiers: maybeTail.modifiers,
          notation: `(${tok.raw})${maybeTail.raw}`,
        };
      }
      return varNode;
    }

    if (tok.kind === 'identifier') {
      consume();
      if (!VALID_FUNCTION_SET.has(tok.name)) {
        throw new FormulaParseError(
          `Unknown function or identifier "${tok.name}" in "${formula}"`,
          formula,
          tok.pos,
        );
      }
      const fnName = tok.name as FormulaFunction;
      const open = peek();
      if (!open || open.kind !== 'lparen') {
        throw new FormulaParseError(
          `Function "${fnName}" must be followed by "(" in "${formula}"`,
          formula,
          tok.pos,
        );
      }
      consume(); // consume '('

      const closeImmediate = peek();
      if (closeImmediate && closeImmediate.kind === 'rparen') {
        throw new FormulaParseError(
          `Function "${fnName}" cannot be called with empty arguments in "${formula}"`,
          formula,
          closeImmediate.pos,
        );
      }

      const args: FormulaAstNode[] = [parseExpression()];
      while (true) {
        const sep = peek();
        if (sep && sep.kind === 'comma') {
          consume();
          args.push(parseExpression());
        } else {
          break;
        }
      }

      const close = peek();
      if (!close || close.kind !== 'rparen') {
        throw new FormulaParseError(
          `Expected closing ")" for function "${fnName}" in "${formula}"`,
          formula,
          tok.pos,
        );
      }
      consume(); // consume ')'

      if ((fnName === 'floor' || fnName === 'ceil') && args.length !== 1) {
        throw new FormulaParseError(
          `Function "${fnName}" expects exactly 1 argument, received ${args.length} in "${formula}"`,
          formula,
          tok.pos,
        );
      }
      if ((fnName === 'max' || fnName === 'min') && args.length < 2) {
        throw new FormulaParseError(
          `Function "${fnName}" expects at least 2 arguments, received ${args.length} in "${formula}"`,
          formula,
          tok.pos,
        );
      }

      const fnNode: FunctionAstNode = {
        type: 'function',
        name: fnName,
        args,
      };

      const maybeTail = peek();
      if (maybeTail && maybeTail.kind === 'dice_tail') {
        consume();
        return {
          type: 'dice',
          count: fnNode,
          faces: maybeTail.faces,
          modifiers: maybeTail.modifiers,
          notation: `(${formatFormulaAst(fnNode)})${maybeTail.raw}`,
        };
      }
      return fnNode;
    }

    if (tok.kind === 'lparen') {
      consume(); // consume '('
      const next = peek();
      if (next && next.kind === 'rparen') {
        throw new FormulaParseError(
          `Empty parentheses "()" are not allowed in "${formula}"`,
          formula,
          tok.pos,
        );
      }
      const inner = parseExpression();
      const close = peek();
      if (!close || close.kind !== 'rparen') {
        throw new FormulaParseError(
          `Unclosed parenthesis in "${formula}"`,
          formula,
          tok.pos,
        );
      }
      consume(); // consume ')'

      // Check for dynamic dice suffix e.g. `(@slotLevel + 5)d6`
      const maybeTail = peek();
      if (maybeTail && maybeTail.kind === 'dice_tail') {
        consume();
        return {
          type: 'dice',
          count: inner,
          faces: maybeTail.faces,
          modifiers: maybeTail.modifiers,
          notation: `(${formatFormulaAst(inner)})${maybeTail.raw}`,
        };
      }
      return inner;
    }

    throw new FormulaParseError(
      `Unexpected token at position ${tok.pos} in "${formula}"`,
      formula,
      tok.pos,
    );
  }

  const ast = parseExpression();
  if (index < tokens.length) {
    const extra = tokens[index]!;
    throw new FormulaParseError(
      `Unexpected trailing token at position ${extra.pos} in "${formula}"`,
      formula,
      extra.pos,
    );
  }

  return ast;
}

/**
 * Non-throwing validation helper that parses a formula into an AST.
 */
export function tryParseFormula(
  formula: string,
): { valid: true; ast: FormulaAstNode } | { valid: false; error: string } {
  try {
    const ast = parseFormula(formula);
    return { valid: true, ast };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Formats a `FormulaAstNode` back into a normalized string representation.
 */
export function formatFormulaAst(node: FormulaAstNode): string {
  switch (node.type) {
    case 'number':
      return String(node.value);
    case 'variable':
      return node.name;
    case 'dice': {
      const modStr = formatDiceModifiers(node.modifiers);
      if (typeof node.count === 'number') {
        return `${node.count}d${node.faces}${modStr}`;
      }
      return `(${formatFormulaAst(node.count)})d${node.faces}${modStr}`;
    }
    case 'unary': {
      const inner = formatFormulaAst(node.operand);
      if (node.operand.type === 'binary') {
        return `${node.operator}(${inner})`;
      }
      return `${node.operator}${inner}`;
    }
    case 'binary': {
      const leftStr =
        node.left.type === 'binary' &&
        (node.operator === '*' || node.operator === '/') &&
        (node.left.operator === '+' || node.left.operator === '-')
          ? `(${formatFormulaAst(node.left)})`
          : formatFormulaAst(node.left);
      const rightStr =
        node.right.type === 'binary' &&
        (node.operator === '*' ||
          node.operator === '/' ||
          (node.operator === '-' &&
            (node.right.operator === '+' || node.right.operator === '-')))
          ? `(${formatFormulaAst(node.right)})`
          : formatFormulaAst(node.right);
      return `${leftStr} ${node.operator} ${rightStr}`;
    }
    case 'function':
      return `${node.name}(${node.args.map(formatFormulaAst).join(', ')})`;
  }
}

/**
 * Transforms a `FormulaAstNode` for a Critical Hit by doubling the dice count of every
 * `DiceAstNode` in the tree while leaving flat numeric and variable modifiers unchanged.
 * Optionally adds `extraFirstGroupDice` (e.g. Barbarian Brutal Critical / Half-Orc Savage Attacks)
 * to the primary (first) dice term.
 */
export function doubleFormulaAstDice(
  node: FormulaAstNode,
  extraFirstGroupDice = 0,
): FormulaAstNode {
  let firstDiceSeen = false;

  function visit(current: FormulaAstNode): FormulaAstNode {
    switch (current.type) {
      case 'number':
      case 'variable':
        return current;
      case 'dice': {
        const isFirst = !firstDiceSeen;
        firstDiceSeen = true;
        const bonusDice = isFirst ? Math.max(0, Math.floor(extraFirstGroupDice)) : 0;
        const modStr = formatDiceModifiers(current.modifiers);

        if (typeof current.count === 'number') {
          const doubledCount = current.count * 2 + bonusDice;
          return {
            type: 'dice',
            count: doubledCount,
            faces: current.faces,
            modifiers: [...current.modifiers],
            notation: `${doubledCount}d${current.faces}${modStr}`,
          };
        }

        const doubledExpr: FormulaAstNode =
          bonusDice > 0
            ? {
                type: 'binary',
                operator: '+',
                left: {
                  type: 'binary',
                  operator: '*',
                  left: current.count,
                  right: { type: 'number', value: 2 },
                },
                right: { type: 'number', value: bonusDice },
              }
            : {
                type: 'binary',
                operator: '*',
                left: current.count,
                right: { type: 'number', value: 2 },
              };

        return {
          type: 'dice',
          count: doubledExpr,
          faces: current.faces,
          modifiers: [...current.modifiers],
          notation: `(${formatFormulaAst(doubledExpr)})d${current.faces}${modStr}`,
        };
      }
      case 'unary':
        return {
          type: 'unary',
          operator: current.operator,
          operand: visit(current.operand),
        };
      case 'binary':
        return {
          type: 'binary',
          operator: current.operator,
          left: visit(current.left),
          right: visit(current.right),
        };
      case 'function':
        return {
          type: 'function',
          name: current.name,
          args: current.args.map(visit),
        };
    }
  }

  return visit(node);
}
