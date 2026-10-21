// Simplified anatomical tooth outline SVGs for probing chart backgrounds.
// Distinct shapes per tooth type: incisors flat, canines pointed,
// premolars 2-cusped, molars multi-cusped, with correct root counts.

import { FdiToothNumber } from "../model/types";
import { toothShapeType } from "../model/dentition";

// Tooth center positions as % of chart width.
// 16 teeth per jaw: 8 left half + 8 right half with midline gap.
export const TOOTH_CENTER_PCT: number[] = [
  4.4, 10.5, 16.5, 22.5, 28.5, 34.6, 40.6, 46.6,
  52.7, 58.9, 65.1, 71.3, 77.5, 83.7, 89.9, 96.1,
];

// Spread for 3 probing sites around tooth center (in % points)
export const SITE_SPREAD = 2.0;

// ── Tooth shape definitions (reference coordinate space: 1000 × 100) ──

interface RootDef {
  dx: number; // x offset from center, fraction of neckHW
  w: number;  // root half-width
  h: number;  // root height
}

interface ToothDef {
  hw: number;       // crown half-width
  ch: number;       // crown height
  neckHW: number;   // half-width at gumline
  cusps?: number[]; // cusp x-positions as fraction of hw (-1..1)
  cuspH?: number;   // cusp bump height
  upperRoots: RootDef[];
  lowerRoots: RootDef[];
}

const DEFS: Record<number, ToothDef> = {
  1: { // Central incisor
    hw: 17, ch: 38, neckHW: 13,
    upperRoots: [{ dx: 0, w: 7, h: 34 }],
    lowerRoots: [{ dx: 0, w: 5, h: 28 }],
  },
  2: { // Lateral incisor
    hw: 14, ch: 34, neckHW: 11,
    upperRoots: [{ dx: 0, w: 6, h: 32 }],
    lowerRoots: [{ dx: 0, w: 5, h: 26 }],
  },
  3: { // Canine
    hw: 17, ch: 42, neckHW: 13,
    cusps: [0], cuspH: 8,
    upperRoots: [{ dx: 0, w: 7, h: 40 }],
    lowerRoots: [{ dx: 0, w: 6, h: 36 }],
  },
  4: { // First premolar — 2 roots upper, 1 root lower
    hw: 18, ch: 34, neckHW: 14,
    cusps: [-0.35, 0.35], cuspH: 4,
    upperRoots: [{ dx: -0.5, w: 4, h: 30 }, { dx: 0.5, w: 4, h: 28 }],
    lowerRoots: [{ dx: 0, w: 6, h: 28 }],
  },
  5: { // Second premolar
    hw: 19, ch: 34, neckHW: 15,
    cusps: [-0.3, 0.3], cuspH: 3,
    upperRoots: [{ dx: 0, w: 7, h: 30 }],
    lowerRoots: [{ dx: 0, w: 6, h: 28 }],
  },
  6: { // First molar — 3 roots upper, 2 roots lower
    hw: 25, ch: 36, neckHW: 21,
    cusps: [-0.5, -0.1, 0.25, 0.6], cuspH: 3,
    upperRoots: [
      { dx: -0.55, w: 4, h: 34 },
      { dx: 0.15, w: 4, h: 28 },
      { dx: 0.55, w: 4, h: 36 },
    ],
    lowerRoots: [{ dx: -0.4, w: 5, h: 30 }, { dx: 0.4, w: 5, h: 32 }],
  },
  7: { // Second molar — 3 roots upper, 2 roots lower
    hw: 23, ch: 34, neckHW: 19,
    cusps: [-0.4, 0, 0.4], cuspH: 3,
    upperRoots: [
      { dx: -0.5, w: 4, h: 28 },
      { dx: 0.1, w: 4, h: 26 },
      { dx: 0.5, w: 4, h: 30 },
    ],
    lowerRoots: [{ dx: -0.4, w: 5, h: 26 }, { dx: 0.4, w: 5, h: 28 }],
  },
  8: { // Third molar (wisdom) — roots often fused/short
    hw: 20, ch: 32, neckHW: 17,
    cusps: [-0.3, 0.3], cuspH: 2,
    upperRoots: [{ dx: 0, w: 9, h: 20 }],
    lowerRoots: [{ dx: 0, w: 8, h: 18 }],
  },
};

// ── SVG path helpers ──────────────────────────────────────────────

function f(v: number): string { return v.toFixed(1); }

function crownPathD(cx: number, gy: number, dir: number, def: ToothDef): string {
  const { hw, ch, neckHW, cusps, cuspH } = def;
  const r = 2.5;

  if (!cusps || cusps.length === 0) {
    // Flat incisal edge (incisors)
    const ey = gy + dir * ch;
    return `M ${f(cx - neckHW)} ${f(gy)} `
      + `L ${f(cx - hw)} ${f(ey - dir * r)} `
      + `Q ${f(cx - hw)} ${f(ey)} ${f(cx - hw + r)} ${f(ey)} `
      + `L ${f(cx + hw - r)} ${f(ey)} `
      + `Q ${f(cx + hw)} ${f(ey)} ${f(cx + hw)} ${f(ey - dir * r)} `
      + `L ${f(cx + neckHW)} ${f(gy)} Z`;
  }

  if (cusps.length === 1) {
    // Single pointed cusp (canine)
    const bump = cuspH || 6;
    const sideY = gy + dir * (ch - bump);
    const tipY = gy + dir * ch;
    return `M ${f(cx - neckHW)} ${f(gy)} `
      + `L ${f(cx - hw)} ${f(sideY)} `
      + `Q ${f(cx - hw * 0.4)} ${f(tipY)} ${f(cx + cusps[0] * hw)} ${f(tipY)} `
      + `Q ${f(cx + hw * 0.4)} ${f(tipY)} ${f(cx + hw)} ${f(sideY)} `
      + `L ${f(cx + neckHW)} ${f(gy)} Z`;
  }

  // Multiple cusps (premolars, molars)
  const bump = cuspH || 3;
  const baseY = gy + dir * (ch - bump);
  const tipY = gy + dir * ch;
  let d = `M ${f(cx - neckHW)} ${f(gy)} L ${f(cx - hw)} ${f(baseY)} `;
  for (let i = 0; i < cusps.length; i++) {
    const cuspX = cx + cusps[i] * hw;
    d += `L ${f(cuspX)} ${f(tipY)} `;
    if (i < cusps.length - 1) {
      const nextX = cx + cusps[i + 1] * hw;
      d += `L ${f((cuspX + nextX) / 2)} ${f(baseY)} `;
    }
  }
  d += `L ${f(cx + hw)} ${f(baseY)} L ${f(cx + neckHW)} ${f(gy)} Z`;
  return d;
}

function rootPathD(cx: number, gy: number, dir: number, root: RootDef, neckHW: number): string {
  const rcx = cx + root.dx * neckHW;
  const tipY = gy - dir * root.h;
  const bw = root.w;
  const nearTipY = gy - dir * root.h * 0.9;
  const ctrlY = gy - dir * root.h * 0.65;
  const tipR = bw * 0.35;
  return `M ${f(rcx - bw)} ${f(gy)} `
    + `C ${f(rcx - bw * 0.5)} ${f(ctrlY)} ${f(rcx - tipR)} ${f(nearTipY)} ${f(rcx - tipR)} ${f(tipY)} `
    + `Q ${f(rcx)} ${f(tipY - dir * tipR)} ${f(rcx + tipR)} ${f(tipY)} `
    + `C ${f(rcx + tipR)} ${f(nearTipY)} ${f(rcx + bw * 0.5)} ${f(ctrlY)} ${f(rcx + bw)} ${f(gy)} Z`;
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Generate SVG elements for tooth outlines, to be inserted inside an
 * existing `<svg>` tag before the probing data elements.
 *
 * All dimensions are defined in a 1000×100 reference coordinate space
 * and scaled to match the actual viewBox via a group transform.
 *
 * @param teeth  FDI tooth numbers in display order (left-to-right)
 * @param jaw    "upper" (roots at top, crown at bottom) or "lower" (crown at top, roots at bottom)
 * @param viewW  Actual SVG viewBox width
 * @param viewH  Actual SVG viewBox height
 */
export function buildToothOutlinesSvg(
  teeth: (FdiToothNumber | null)[],
  jaw: "upper" | "lower",
  viewW: number,
  viewH: number
): string {
  const sx = viewW / 1000;
  const sy = viewH / 100;
  const dir = jaw === "upper" ? 1 : -1;
  const gy = jaw === "upper" ? 36 : 64;

  let svg = `<g transform="scale(${f(sx)},${f(sy)})" opacity="0.7">`;

  for (let i = 0; i < teeth.length; i++) {
    const tooth = teeth[i];
    // An empty column (primary rows have no molars 6–8)
    if (tooth === null) continue;
    const type = toothShapeType(tooth);
    const def = DEFS[type];
    if (!def) continue;

    const cx = 1000 * (TOOTH_CENTER_PCT[i] / 100);
    const roots = jaw === "upper" ? def.upperRoots : def.lowerRoots;

    // Roots first (behind crown)
    for (const root of roots) {
      svg += `<path d="${rootPathD(cx, gy, dir, root, def.neckHW)}" fill="#ebe5d8" stroke="#a89880" stroke-width="0.8"/>`;
    }

    // Crown
    svg += `<path d="${crownPathD(cx, gy, dir, def)}" fill="#ebe5d8" stroke="#a89880" stroke-width="1.0"/>`;
  }

  // Subtle gumline indicator
  svg += `<line x1="0" y1="${f(gy)}" x2="1000" y2="${f(gy)}" stroke="#d4a89a" stroke-width="0.7" stroke-dasharray="4,3" opacity="0.6"/>`;

  svg += `</g>`;
  return svg;
}
