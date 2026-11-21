import React, { useState } from 'react';
import { FALLBACK_ICONS, getItemIcon } from './itemIcons.js';

export interface ItemIconProps {
  /** Canonical equipment / magic-item id (e.g. `"longsword"`, `"potion-of-healing"`). */
  itemId: string;
  /** Pixel size applied to the font glyph / img (default: 20). */
  size?: number;
  /** Additional CSS classes (rarity recolor hooks land here in SRD-1302). */
  className?: string;
  /** Accessible label override. Defaults to the item id. */
  alt?: string;
  /** Native tooltip text. */
  title?: string;
  /**
   * Render the vendored game-icons.net SVG instead of the RPG Awesome font
   * glyph. Defaults to `false` (RA is the primary system; SVG is the
   * gap-filler). When the SVG fails to load the component degrades to the
   * RA fallback glyph — never a broken `<img>`.
   */
  preferSvg?: boolean;
  /** Test id prefix. Defaults to `item-icon`. */
  testId?: string;
}

/**
 * SRD-1301 licensed item icon. Primary render is the bundled RPG Awesome
 * font glyph (`<i class="ra ra-xxx">`, offline, recolorable via CSS);
 * `preferSvg` opts into the vendored game-icons.net SVG. Unknown ids and
 * SVG load failures both degrade to the category fallback glyph.
 */
export function ItemIcon({
  itemId,
  size = 20,
  className = '',
  alt,
  title,
  preferSvg = false,
  testId = 'item-icon',
}: ItemIconProps) {
  const [svgFailed, setSvgFailed] = useState(false);
  const ref = getItemIcon(itemId);
  const label = alt ?? itemId;

  if (preferSvg && ref.svg && !svgFailed) {
    return (
      <img
        src={`/assets/game-icons/${ref.svg}`}
        alt={label}
        title={title}
        width={size}
        height={size}
        data-testid={`${testId}-${itemId}`}
        className={`inline-block select-none shrink-0 object-contain ${className}`}
        loading="lazy"
        onError={() => setSvgFailed(true)}
      />
    );
  }

  const suffix = ref.ra ?? FALLBACK_ICONS[ref.fallback].ra;
  return (
    <i
      aria-hidden={alt === undefined ? true : undefined}
      aria-label={alt === undefined ? undefined : label}
      title={title ?? (alt === undefined ? label : title)}
      data-testid={`${testId}-${itemId}`}
      data-icon={suffix}
      className={`ra ra-${suffix} inline-block select-none shrink-0 text-center ${className}`}
      style={{ fontSize: size, lineHeight: 1 }}
    />
  );
}
