import * as React from 'react';

/**
 * SRD-1504 touch parity for inventory cells (Spec 14 §4).
 *
 * Mouse/keyboard parity already exists (click/Enter selects via the action
 * bar, double-click activates, right-click opens the context menu, the sort
 * is a native `<select>`). Touch screens never fire `dblclick` reliably and
 * have no right-click, so this hook adds the two missing touch gestures:
 *
 * - **Long-press** (default 500 ms, 12 px slop): opens the same context menu
 *   a right-click would open, anchored at the touch point.
 * - **Double-tap** (two `touchend`s within 350 ms): fires the same activation
 *   a double-click would fire (equip suggested slot, else Use).
 *
 * A single tap still flows through the native synthetic `click`, so
 * tap-to-select and the action bar keep working untouched. The synthetic
 * click that follows a long-press is suppressed (consumed once) so a
 * long-press never also selects/deselects the cell.
 */

export const INVENTORY_CELL_LONG_PRESS_MS = 500;
export const INVENTORY_CELL_DOUBLE_TAP_MS = 350;
export const INVENTORY_CELL_TOUCH_SLOP_PX = 12;

export interface InventoryCellTouchPoint {
  x: number;
  y: number;
}

function readTouchPoint(event: React.TouchEvent): InventoryCellTouchPoint | null {
  const changed = event.changedTouches;
  const touches = event.touches;
  const active =
    changed && changed.length > 0 ? changed[0] : touches && touches.length > 0 ? touches[0] : undefined;
  if (!active) return null;
  return { x: active.clientX, y: active.clientY };
}

export interface InventoryCellTouchOptions {
  /** False for display-only cells (e.g. loot grids): touch gestures disabled. */
  enabled: boolean;
  /** Double-tap: same handler the cell uses for `onDoubleClick`. */
  onDoubleTap: () => void;
  /** Long-press: same handler the cell uses for `onContextMenu`, at the touch point. */
  onLongPress: (point: InventoryCellTouchPoint) => void;
}

export interface InventoryCellTouchBindings {
  onTouchStart: (event: React.TouchEvent) => void;
  onTouchMove: (event: React.TouchEvent) => void;
  onTouchEnd: () => void;
  /**
   * Call at the top of the cell's `onClick`. Returns true when the click is
   * the synthetic follow-up to a long-press (the click is consumed).
   */
  consumeSuppressedClick: () => boolean;
}

export function useInventoryCellTouch(options: InventoryCellTouchOptions): InventoryCellTouchBindings {
  const { enabled } = options;
  const callbacksRef = React.useRef({ onDoubleTap: options.onDoubleTap, onLongPress: options.onLongPress });
  callbacksRef.current = { onDoubleTap: options.onDoubleTap, onLongPress: options.onLongPress };

  const timerRef = React.useRef<number | null>(null);
  const startRef = React.useRef<InventoryCellTouchPoint | null>(null);
  const longPressedRef = React.useRef(false);
  const suppressClickRef = React.useRef(false);
  const lastTapEndRef = React.useRef(0);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (!enabled) return;
    longPressedRef.current = false;
    suppressClickRef.current = false;
    clearTimer();
    const point = readTouchPoint(event);
    if (!point) return;
    startRef.current = point;
    const anchor = point;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      longPressedRef.current = true;
      suppressClickRef.current = true;
      callbacksRef.current.onLongPress(anchor);
    }, INVENTORY_CELL_LONG_PRESS_MS);
  };

  const onTouchMove = (event: React.TouchEvent) => {
    if (!enabled || timerRef.current === null) return;
    const point = readTouchPoint(event);
    const start = startRef.current;
    if (!point || !start) return;
    if (
      Math.abs(point.x - start.x) > INVENTORY_CELL_TOUCH_SLOP_PX ||
      Math.abs(point.y - start.y) > INVENTORY_CELL_TOUCH_SLOP_PX
    ) {
      clearTimer();
    }
  };

  const onTouchEnd = () => {
    if (!enabled) return;
    const wasLongPress = longPressedRef.current;
    clearTimer();
    startRef.current = null;
    if (wasLongPress) return;
    const now = Date.now();
    if (now - lastTapEndRef.current <= INVENTORY_CELL_DOUBLE_TAP_MS) {
      lastTapEndRef.current = 0;
      callbacksRef.current.onDoubleTap();
    } else {
      lastTapEndRef.current = now;
    }
  };

  const consumeSuppressedClick = (): boolean => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      longPressedRef.current = false;
      return true;
    }
    return false;
  };

  return { onTouchStart, onTouchMove, onTouchEnd, consumeSuppressedClick };
}
