/* global document, SVGSVGElement, SVGPolygonElement */

/**
 * Five-surface tooth chart for brush-style entry (tap a surface to paint it),
 * ported from the UKC cleft study's DentalStatus app.
 *
 * Layout (viewer-left is the patient's right):
 *   upper row: 18→11 | 21→28
 *   lower row: 48→41 | 31→38
 * Vestibular faces away from the middle of the chart (top for the upper jaw,
 * bottom for the lower); mesial always points to the middle of the row.
 */

import { FdiToothNumber, ICDASSurface } from "../model/types";

const SVG_NS = "http://www.w3.org/2000/svg";

const UPPER_ROW: FdiToothNumber[] = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_ROW: FdiToothNumber[] = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

type Pos = "top" | "bottom" | "left" | "right" | "center";

/** Screen position → anatomical surface. */
export function surfaceAt(tooth: FdiToothNumber, pos: Pos): ICDASSurface {
  if (pos === "center") return "occlusal";
  const quadrant = Math.floor(tooth / 10);
  switch (pos) {
    case "top":
      return quadrant <= 2 ? "buccal" : "lingual";
    case "bottom":
      return quadrant <= 2 ? "lingual" : "buccal";
    case "left":
      // Quadrants 1 and 4 sit on the viewer's left half of each row
      return quadrant === 1 || quadrant === 4 ? "distal" : "mesial";
    case "right":
      return quadrant === 1 || quadrant === 4 ? "mesial" : "distal";
  }
}

export interface SurfaceChartOptions {
  /** Drawn faded and not tappable. */
  isDisabled(tooth: FdiToothNumber): boolean;
  /** Inline fill for a surface, or "" to leave it blank. */
  fillFor(tooth: FdiToothNumber, surface: ICDASSurface): string;
  /** Text drawn in the middle of a surface. */
  textFor(tooth: FdiToothNumber, surface: ICDASSurface): string;
  onSurface(tooth: FdiToothNumber, surface: ICDASSurface): void;
}

/** Both jaws. Re-rendering is a full rebuild: cheap at 32 teeth, and never out of sync. */
export function buildSurfaceChart(opts: SurfaceChartOptions): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "fc-chart";
  wrap.appendChild(jawLabel("zgornja čeljust"));
  wrap.appendChild(numberRow(UPPER_ROW));
  wrap.appendChild(toothRow(UPPER_ROW, opts));
  wrap.appendChild(toothRow(LOWER_ROW, opts));
  wrap.appendChild(numberRow(LOWER_ROW));
  wrap.appendChild(jawLabel("spodnja čeljust"));
  const sides = document.createElement("div");
  sides.className = "fc-sides";
  sides.innerHTML = `<span>pacientova DESNA</span><span>pacientova LEVA</span>`;
  wrap.appendChild(sides);
  return wrap;
}

function jawLabel(text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "fc-jaw-label";
  el.textContent = text;
  return el;
}

function numberRow(teeth: FdiToothNumber[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "fc-row fc-numbers";
  for (const t of teeth) {
    const cell = document.createElement("div");
    cell.className = "fc-number";
    cell.textContent = String(t);
    row.appendChild(cell);
  }
  return row;
}

function toothRow(teeth: FdiToothNumber[], opts: SurfaceChartOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "fc-row";
  for (const tooth of teeth) {
    const cell = document.createElement("div");
    cell.className = "fc-cell";
    const disabled = opts.isDisabled(tooth);
    if (disabled) cell.classList.add("disabled");
    const svg = buildSvg(tooth, 40);
    svg.querySelectorAll<SVGPolygonElement>("polygon").forEach((poly) => {
      const surface = surfaceAt(tooth, poly.dataset.pos as Pos);
      poly.dataset.surface = surface;
      const fill = opts.fillFor(tooth, surface);
      if (fill) poly.style.fill = fill;
      if (disabled) return;
      poly.addEventListener("click", (ev) => {
        ev.stopPropagation();
        opts.onSurface(tooth, surface);
      });
    });
    for (const pos of ["top", "right", "bottom", "left", "center"] as Pos[]) {
      const text = opts.textFor(tooth, surfaceAt(tooth, pos));
      if (!text) continue;
      const label = document.createElementNS(SVG_NS, "text");
      const p = textAnchor(pos, 40);
      label.setAttribute("x", String(p.x));
      label.setAttribute("y", String(p.y));
      label.setAttribute("class", "fc-surface-text");
      label.textContent = text;
      svg.appendChild(label);
    }
    cell.appendChild(svg);
    row.appendChild(cell);
  }
  return row;
}

/** Cross-divided square: four trapezoids around a central occlusal box. */
function buildSvg(tooth: FdiToothNumber, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "fc-svg");
  const s = size;
  const m = Math.round(size * 0.28);
  const shapes: { pos: Pos; points: string }[] = [
    { pos: "top", points: `0,0 ${s},0 ${s - m},${m} ${m},${m}` },
    { pos: "right", points: `${s - m},${m} ${s},0 ${s},${s} ${s - m},${s - m}` },
    { pos: "bottom", points: `${m},${s - m} ${s - m},${s - m} ${s},${s} 0,${s}` },
    { pos: "left", points: `0,0 ${m},${m} ${m},${s - m} 0,${s}` },
    { pos: "center", points: `${m},${m} ${s - m},${m} ${s - m},${s - m} ${m},${s - m}` },
  ];
  for (const shape of shapes) {
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", shape.points);
    poly.setAttribute("class", "fc-surface");
    poly.dataset.pos = shape.pos;
    poly.dataset.tooth = String(tooth);
    svg.appendChild(poly);
  }
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0.5");
  rect.setAttribute("y", "0.5");
  rect.setAttribute("width", String(size - 1));
  rect.setAttribute("height", String(size - 1));
  rect.setAttribute("class", "fc-border");
  svg.appendChild(rect);
  return svg;
}

/** Where the text sits inside each surface. */
function textAnchor(pos: Pos, size: number): { x: number; y: number } {
  const h = size / 2;
  const off = size * 0.14;
  switch (pos) {
    case "top":
      return { x: h, y: off + 4 };
    case "bottom":
      return { x: h, y: size - off + 3 };
    case "left":
      return { x: off, y: h + 3 };
    case "right":
      return { x: size - off, y: h + 3 };
    case "center":
      return { x: h, y: h + 3 };
  }
}
