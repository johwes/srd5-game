import { useEffect, useRef } from 'react';

/**
 * Global Escape-key priority stack (BG3-style UI layering).
 *
 * Eight-plus independent `window.keydown` listeners used to race each other
 * (targeting cancel, prop card, pause menu, reaction prompt all claimed
 * `Escape` with registration-order-dependent `stopPropagation`). This module
 * owns the single global listener and dispatches each `Escape` press to the
 * topmost registered handler only.
 *
 * Priority convention (higher wins, ties go to the most recently registered):
 * - `100` — reaction interrupt prompt (must pass before anything else)
 * - `90` — armed manual targeting (cancel the armed action first)
 * - `80` — open modal cards (prop inspect, pause menu, settings)
 * - `10` — view base layer (open the pause menu)
 *
 * Handlers return `true` when they consume the press. Input-focus guard
 * (INPUT / TEXTAREA / SELECT / contentEditable) is enforced centrally so
 * individual views don't re-implement it.
 */
type EscHandler = () => boolean;

interface EscEntry {
  handler: () => boolean;
  priority: number;
  order: number;
}

const stack: EscEntry[] = [];
let orderCounter = 0;
let listenerInstalled = false;

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(
    el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable),
  );
}

function onGlobalKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (isEditableTarget(e.target)) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  top.handler();
}

function installListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return;
  window.addEventListener('keydown', onGlobalKeyDown);
  listenerInstalled = true;
}

export function registerEscHandler(handler: EscHandler, priority: number): () => void {
  installListener();
  const entry: EscEntry = { handler, priority, order: orderCounter++ };
  // Keep the stack sorted ascending so the topmost entry is always last.
  // Stable for ties: later registrations sort after earlier ones at the same
  // priority, so the most recently opened modal wins.
  let idx = stack.length;
  while (idx > 0 && (stack[idx - 1]!.priority > priority || (stack[idx - 1]!.priority === priority && stack[idx - 1]!.order > entry.order))) {
    idx--;
  }
  stack.splice(idx, 0, entry);
  return () => {
    const at = stack.indexOf(entry);
    if (at >= 0) stack.splice(at, 1);
  };
}

export interface UseEscHandlerOptions {
  /** Higher wins; ties go to the most recently registered handler. */
  priority?: number;
  /** Inactive handlers stay unregistered (e.g. modal closed, nothing armed). */
  active?: boolean;
}

/**
 * Registers an `Escape` handler on the global stack while `active`.
 * The latest handler closure is always invoked (no stale-closure re-registration).
 */
export function useEscHandler(handler: EscHandler, options: UseEscHandlerOptions = {}): void {
  const { priority = 10, active = true } = options;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    return registerEscHandler(() => handlerRef.current(), priority);
  }, [priority, active]);
}

/** Priority ladder for the standard UI layers. */
export const ESC_PRIORITY = {
  base: 10,
  modal: 80,
  targeting: 90,
  reaction: 100,
} as const;
