/**
 * Tenant theming. Each school stores a brand colour as hex; the design system
 * is driven by HSL triplets in CSS custom properties, so the portal converts
 * once per render and overrides --primary and --ring for that subtree.
 */

export interface HslTriplet {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): HslTriplet | null {
  const normalised = hex.trim().replace('#', '');
  const expanded =
    normalised.length === 3
      ? normalised
          .split('')
          .map((c) => c + c)
          .join('')
      : normalised;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;

  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / delta + 2) * 60;
        break;
      default:
        h = ((r - g) / delta + 4) * 60;
    }
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** Inline CSS that rebinds the design tokens for one tenant's subtree. */
export function tenantThemeCss(primaryHex: string | null | undefined, scopeClass: string): string {
  const hsl = hexToHsl(primaryHex ?? '') ?? { h: 221, s: 83, l: 45 };
  const foregroundLightness = hsl.l > 62 ? 12 : 98;

  return `.${scopeClass}{--primary:${hsl.h} ${hsl.s}% ${hsl.l}%;--ring:${hsl.h} ${hsl.s}% ${hsl.l}%;--primary-foreground:${hsl.h} 20% ${foregroundLightness}%;}`;
}
