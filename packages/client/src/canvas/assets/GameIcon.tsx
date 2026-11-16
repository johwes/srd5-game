import React from 'react';
import type { ConditionId } from '@srd5/data';
import { assetRegistry } from './AssetRegistry.js';

export interface GameIconProps {
  /**
   * Name or identifier of the icon.
   * Can be a direct icon name (e.g., "sprint", "fireball"),
   * a condition ID, action ID, spell school, or item key.
   */
  name: string;
  /**
   * Category of the asset to resolve via AssetRegistry.
   * Defaults to 'auto' detection.
   */
  category?: 'auto' | 'action' | 'condition' | 'spell' | 'item' | 'raw';
  /**
   * Width and height in pixels (default: 20).
   */
  size?: number;
  /**
   * Additional CSS classes.
   */
  className?: string;
  /**
   * Accessible description / alt text.
   */
  alt?: string;
  /**
   * Tooltip text.
   */
  title?: string;
}

/**
 * Resolves the icon image URL based on category and name.
 */
export function getGameIconUrl(
  name: string,
  category: 'auto' | 'action' | 'condition' | 'spell' | 'item' | 'raw' = 'auto',
): { url: string; altText: string } {
  if (category === 'condition') {
    const res = assetRegistry.resolveConditionIcon(name as ConditionId);
    return { url: res.url, altText: res.altText };
  }
  if (category === 'action') {
    const res = assetRegistry.resolveActionIcon(name);
    return { url: res.url, altText: res.altText };
  }
  if (category === 'spell') {
    const res = assetRegistry.resolveSpellIcon({ school: name, name });
    return { url: res.url, altText: res.altText };
  }
  if (category === 'item') {
    const res = assetRegistry.resolveItemIcon(name);
    return { url: res.url, altText: res.altText };
  }

  // Auto detection
  if (category === 'auto') {
    // Check if known condition
    const condRes = assetRegistry.resolveConditionIcon(name as ConditionId);
    if (condRes.url !== '/assets/game-icons/cursed-star.svg' || name === 'cursed-star') {
      return { url: condRes.url, altText: condRes.altText };
    }

    // Check if known action
    const actRes = assetRegistry.resolveActionIcon(name);
    if (actRes.url !== '/assets/game-icons/crossed-swords.svg' || name === 'attack') {
      return { url: actRes.url, altText: actRes.altText };
    }
  }

  // Fallback / raw SVG name
  const cleanName = name.replace(/\.svg$/, '');
  return {
    url: `/assets/game-icons/${cleanName}.svg`,
    altText: name,
  };
}

/**
 * Renders a vector icon from the bundled game-icons.net CC-BY 3.0 set.
 */
export function GameIcon({
  name,
  category = 'auto',
  size = 20,
  className = '',
  alt,
  title,
}: GameIconProps) {
  const { url, altText } = getGameIconUrl(name, category);
  const resolvedAlt = alt ?? altText;

  return (
    <img
      src={url}
      alt={resolvedAlt}
      title={title}
      width={size}
      height={size}
      data-testid={`game-icon-${name}`}
      className={`inline-block select-none shrink-0 object-contain ${className}`}
      loading="lazy"
    />
  );
}
