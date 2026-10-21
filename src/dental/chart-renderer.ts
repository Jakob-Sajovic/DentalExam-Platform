import { FdiToothNumber, PBSurface, ICDASSurface } from "../model/types";
import { quadrantOf } from "../model/dentition";

// Visual positions in the X-divided tooth SVG
export type VisualPosition = "top" | "bottom" | "left" | "right";

// Visual positions in the ICDAS cross-divided tooth SVG (5 sections)
export type ICDASVisualPosition = "top" | "bottom" | "left" | "right" | "center";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Create an SVG element for a plaque/bleeding tooth with X-divided pattern.
 * 4 triangular surfaces meeting at center:
 *   Top triangle:    0,0 → size,0 → half,half
 *   Bottom triangle: 0,size → size,size → half,half
 *   Left triangle:   0,0 → 0,size → half,half
 *   Right triangle:  size,0 → size,size → half,half
 */
export function createPBToothSvg(tooth: FdiToothNumber, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "tooth-svg");
  svg.dataset.tooth = String(tooth);

  const half = size / 2;

  // Surface polygons — order: top, right, bottom, left
  const surfaces: { position: VisualPosition; points: string }[] = [
    { position: "top", points: `0,0 ${size},0 ${half},${half}` },
    { position: "right", points: `${size},0 ${size},${size} ${half},${half}` },
    { position: "bottom", points: `0,${size} ${size},${size} ${half},${half}` },
    { position: "left", points: `0,0 0,${size} ${half},${half}` },
  ];

  for (const s of surfaces) {
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", s.points);
    poly.setAttribute("class", "tooth-surface");
    poly.dataset.position = s.position;
    poly.dataset.tooth = String(tooth);
    svg.appendChild(poly);
  }

  // Diagonal lines (X pattern)
  const line1 = document.createElementNS(SVG_NS, "line");
  line1.setAttribute("x1", "0");
  line1.setAttribute("y1", "0");
  line1.setAttribute("x2", String(size));
  line1.setAttribute("y2", String(size));
  line1.setAttribute("class", "tooth-divider");
  svg.appendChild(line1);

  const line2 = document.createElementNS(SVG_NS, "line");
  line2.setAttribute("x1", String(size));
  line2.setAttribute("y1", "0");
  line2.setAttribute("x2", "0");
  line2.setAttribute("y2", String(size));
  line2.setAttribute("class", "tooth-divider");
  svg.appendChild(line2);

  // Border rectangle
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0.5");
  rect.setAttribute("y", "0.5");
  rect.setAttribute("width", String(size - 1));
  rect.setAttribute("height", String(size - 1));
  rect.setAttribute("class", "tooth-border");
  svg.appendChild(rect);

  return svg;
}

/**
 * Map a visual position (top/bottom/left/right) to the anatomical PBSurface name.
 *
 * Chart layout (facing patient):
 *   Upper: 18→11 | 21→28  (Q1 left, Q2 right)
 *   Lower: 48→41 | 31→38  (Q4 left, Q3 right — LOWER_JAW_MIRRORED)
 *
 * Convention:
 *   top/bottom (vestibular/oral):
 *     Q1/Q2 (upper): top = buccal (vestibularno), bottom = lingual (oralno)
 *     Q3/Q4 (lower): top = lingual (oralno), bottom = buccal (vestibularno)
 *
 *   left/right (distal/mesial):
 *     Q1/Q4 (left half): left = distal, right = mesial
 *     Q2/Q3 (right half): left = mesial, right = distal
 */
export function getSurfaceForPosition(tooth: FdiToothNumber, position: VisualPosition): PBSurface {
  const quadrant = quadrantOf(tooth);

  switch (position) {
    case "top":
      return (quadrant <= 2) ? "buccal" : "lingual";
    case "bottom":
      return (quadrant <= 2) ? "lingual" : "buccal";
    case "left":
      return (quadrant === 1 || quadrant === 4) ? "distal" : "mesial";
    case "right":
      return (quadrant === 1 || quadrant === 4) ? "mesial" : "distal";
    default:
      return "buccal";
  }
}

/**
 * Create an SVG element for an ICDAS tooth with cross-divided pattern.
 * 5 sections: 4 trapezoidal edges + center rectangle.
 *
 * For size s, inner margin m = round(s * 0.25):
 *   top trapezoid:    0,0  s,0  s-m,m  m,m
 *   right trapezoid:  s-m,m  s,0  s,s  s-m,s-m
 *   bottom trapezoid: m,s-m  s-m,s-m  s,s  0,s
 *   left trapezoid:   0,0  m,m  m,s-m  0,s
 *   center rectangle: m,m  s-m,m  s-m,s-m  m,s-m
 */
export function createICDASToothSvg(tooth: FdiToothNumber, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "tooth-svg");
  svg.dataset.tooth = String(tooth);

  const s = size;
  const m = Math.round(s * 0.25);

  const surfaces: { position: ICDASVisualPosition; points: string }[] = [
    { position: "top", points: `0,0 ${s},0 ${s - m},${m} ${m},${m}` },
    { position: "right", points: `${s - m},${m} ${s},0 ${s},${s} ${s - m},${s - m}` },
    { position: "bottom", points: `${m},${s - m} ${s - m},${s - m} ${s},${s} 0,${s}` },
    { position: "left", points: `0,0 ${m},${m} ${m},${s - m} 0,${s}` },
    { position: "center", points: `${m},${m} ${s - m},${m} ${s - m},${s - m} ${m},${s - m}` },
  ];

  for (const surf of surfaces) {
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", surf.points);
    poly.setAttribute("class", "icdas-surface");
    poly.dataset.position = surf.position;
    poly.dataset.tooth = String(tooth);
    svg.appendChild(poly);
  }

  // Diagonal lines from outer corners to inner corners
  const lines = [
    { x1: 0, y1: 0, x2: m, y2: m },
    { x1: s, y1: 0, x2: s - m, y2: m },
    { x1: s, y1: s, x2: s - m, y2: s - m },
    { x1: 0, y1: s, x2: m, y2: s - m },
  ];

  for (const l of lines) {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(l.x1));
    line.setAttribute("y1", String(l.y1));
    line.setAttribute("x2", String(l.x2));
    line.setAttribute("y2", String(l.y2));
    line.setAttribute("class", "tooth-divider");
    svg.appendChild(line);
  }

  // Inner rectangle outline
  const innerRect = document.createElementNS(SVG_NS, "rect");
  innerRect.setAttribute("x", String(m));
  innerRect.setAttribute("y", String(m));
  innerRect.setAttribute("width", String(s - 2 * m));
  innerRect.setAttribute("height", String(s - 2 * m));
  innerRect.setAttribute("fill", "none");
  innerRect.setAttribute("class", "tooth-divider");
  svg.appendChild(innerRect);

  // Border rectangle
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0.5");
  rect.setAttribute("y", "0.5");
  rect.setAttribute("width", String(size - 1));
  rect.setAttribute("height", String(size - 1));
  rect.setAttribute("class", "tooth-border");
  svg.appendChild(rect);

  return svg;
}

/**
 * Map a visual position in the ICDAS cross pattern to the anatomical ICDASSurface name.
 * Same quadrant logic as getSurfaceForPosition, plus center → occlusal.
 */
export function getICDASSurfaceForPosition(tooth: FdiToothNumber, position: ICDASVisualPosition): ICDASSurface {
  if (position === "center") return "occlusal";

  const quadrant = quadrantOf(tooth);

  switch (position) {
    case "top":
      return (quadrant <= 2) ? "buccal" : "lingual";
    case "bottom":
      return (quadrant <= 2) ? "lingual" : "buccal";
    case "left":
      return (quadrant === 1 || quadrant === 4) ? "distal" : "mesial";
    case "right":
      return (quadrant === 1 || quadrant === 4) ? "mesial" : "distal";
    default:
      return "occlusal";
  }
}
