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
import { ChartJaw, ToothSlot, quadrantOf } from "../model/dentition";

const SVG_NS = "http://www.w3.org/2000/svg";


type Pos = "top" | "bottom" | "left" | "right" | "center";

/** Screen position → anatomical surface. */
export function surfaceAt(tooth: FdiToothNumber, pos: Pos): ICDASSurface {
  if (pos === "center") return "occlusal";
  const quadrant = quadrantOf(tooth);
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
  /** Jaw rows top to bottom (dentition.chartJaws). */
  jaws: ChartJaw[];
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
  for (const j of opts.jaws) {
    // Numbers on the outside: above an upper row, below a lower one
    if (j.jaw === "upper") {
      wrap.appendChild(jawLabel(j.label));
      wrap.appendChild(numberRow(j.slots));
      wrap.appendChild(toothRow(j.slots, opts));
    } else {
      wrap.appendChild(toothRow(j.slots, opts));
      wrap.appendChild(numberRow(j.slots));
      wrap.appendChild(jawLabel(j.label));
    }
  }
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

function numberRow(teeth: ToothSlot[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "fc-row fc-numbers";
  for (const t of teeth) {
    const cell = document.createElement("div");
    cell.className = "fc-number";
    cell.textContent = t === null ? "" : String(t);
    row.appendChild(cell);
  }
  return row;
}

function toothRow(teeth: ToothSlot[], opts: SurfaceChartOptions): HTMLElement {
  const row = document.createElement("div");
  row.className = "fc-row";
  for (const tooth of teeth) {
    const cell = document.createElement("div");
    cell.className = "fc-cell";
    // An empty column (primary rows have no molars 6–8)
    if (tooth === null) {
      row.appendChild(cell);
      continue;
    }
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
