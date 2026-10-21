import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { svg2pdf } from "svg2pdf.js";
import { DEJAVU_SANS, DEJAVU_SANS_BOLD } from "./fonts";

/**
 * Writes the rendered report to a vector A4 PDF.
 *
 * Why this exists: window.print() does nothing in an app installed to the iOS
 * home screen, so the PWA builds the file itself and hands it to the share
 * sheet. It reads the report the in-app layer has already laid out — the same
 * HTML the add-in prints — and maps each known block to PDF drawing: charts
 * through svg2pdf (vector), tables through jspdf-autotable (keeping their cell
 * colours), radiographs as embedded JPEGs. Sizes come from the on-screen
 * layout, scaled to the page width, so proportions match the preview.
 *
 * Loaded on demand; it pulls in jsPDF, svg2pdf and an embedded font.
 */

// Portrait A4. Radiograph sections switch to landscape pages, so the page
// geometry is read through the writer's getters, not these constants.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 12;
const FOOT = 15; // room for the page number
const CONTENT_W = PAGE_W - 2 * MARGIN;
const PT = 0.3528; // mm per point
const FONT = "dejavu";

type RGB = [number, number, number];

const BLUE: RGB = [0, 120, 212];
const INK: RGB = [26, 26, 26];
const MUTED: RGB = [136, 136, 136];

/** Parses a computed CSS colour, blending any transparency onto white. */
function cssColor(value: string): RGB | null {
  const m = /rgba?\(([^)]+)\)/.exec(value);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (a === 0) return null;
  const blend = (c: number) => Math.round(c * a + 255 * (1 - a));
  return [blend(r), blend(g), blend(b)];
}

export async function renderReportPdf(report: HTMLElement, title: string): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.addFileToVFS("DejaVuSans.ttf", DEJAVU_SANS);
  doc.addFont("DejaVuSans.ttf", FONT, "normal");
  doc.addFileToVFS("DejaVuSans-Bold.ttf", DEJAVU_SANS_BOLD);
  doc.addFont("DejaVuSans-Bold.ttf", FONT, "bold");
  doc.setProperties({ title, subject: "Zobozdravstveni pregled", creator: "Dentalni pregled" });

  const w = new DomPdfWriter(doc, report);
  await w.write();
  w.pageNumbers();
  return doc.output("blob");
}

type Orientation = "portrait" | "landscape";

class DomPdfWriter {
  private y = MARGIN;
  private orientation: Orientation = "portrait";
  /** Millimetres per CSS pixel of the laid-out report. */
  private k: number;

  constructor(private doc: jsPDF, private report: HTMLElement) {
    const cs = getComputedStyle(report);
    const inner = report.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    this.k = CONTENT_W / (inner > 0 ? inner : 868);
  }

  // ── page geometry ───────────────────────────────────────────────

  private get pw(): number {
    return this.orientation === "portrait" ? PAGE_W : PAGE_H;
  }

  private get ph(): number {
    return this.orientation === "portrait" ? PAGE_H : PAGE_W;
  }

  private get bottom(): number {
    return this.ph - FOOT;
  }

  private get cw(): number {
    return this.pw - 2 * MARGIN;
  }

  // ── primitives ──────────────────────────────────────────────────

  private font(sizePt: number, bold = false, color: RGB = INK): void {
    this.doc.setFont(FONT, bold ? "bold" : "normal");
    this.doc.setFontSize(sizePt);
    this.doc.setTextColor(...color);
  }

  /** CSS px of an element's font → PDF points, never below a readable floor. */
  private pt(el: Element, floor = 7): number {
    return Math.max(floor, (parseFloat(getComputedStyle(el).fontSize) * this.k) / PT);
  }

  private mm(px: number): number {
    return px * this.k;
  }

  private ensure(h: number): void {
    if (this.y + h > this.bottom) this.newPage();
  }

  private newPage(orientation: Orientation = this.orientation): void {
    this.doc.addPage("a4", orientation);
    this.orientation = orientation;
    this.y = MARGIN;
  }

  private atPageTop(): boolean {
    return this.y <= MARGIN + 0.01;
  }

  // ── walk ────────────────────────────────────────────────────────

  async write(): Promise<void> {
    for (const child of Array.from(this.report.children)) {
      // Radiograph sections get landscape pages; everything else is portrait
      const wanted: Orientation = child.matches("section.rtg-landscape") ? "landscape" : "portrait";
      if (wanted !== this.orientation) this.newPage(wanted);

      if (child.matches("header.report-header")) this.header(child as HTMLElement);
      else if (child.matches(".signature-section")) this.signatures(child as HTMLElement);
      else if (child.matches("footer.report-footer")) this.footer(child as HTMLElement);
      else if (child.matches("section")) {
        if (child.classList.contains("page-break") && !this.atPageTop()) this.newPage();
        await this.blocks(child as HTMLElement);
        this.y += 4;
      }
    }
  }

  private async blocks(container: HTMLElement): Promise<void> {
    const children = Array.from(container.children) as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      const el = children[i];
      const next = children[i + 1];
      if (el.tagName === "H2") this.heading(el, 2, next);
      else if (el.tagName === "H3") this.heading(el, 3, next);
      else if (el.tagName === "P") this.paragraph(el);
      else if (el.tagName === "TABLE") this.table(el as HTMLTableElement);
      else if (el.matches(".chart-figure, .probing-report-chart")) await this.svgBlock(el);
      else if (el.matches(".chart-legend")) this.legend(el);
      else if (el.matches(".notes-content")) this.notes(el);
      else if (el.matches(".rtg-r-mount")) await this.radiographs(el);
      else if (el.matches(".s3-r-grid")) await this.snapshots(el);
      else if (el.matches(".rtg-r-meta")) this.paragraph(el);
      else if (el.tagName === "UL") this.list(el);
      else if (el.matches(".additional-notes-box")) this.blankBox();
      else if (el.children.length === 0 && (el.textContent || "").trim()) this.paragraph(el);
      else await this.blocks(el);
    }
  }

  // ── blocks ──────────────────────────────────────────────────────

  private header(el: HTMLElement): void {
    const h1 = el.querySelector("h1");
    this.font(18, true, BLUE);
    this.doc.text(h1?.textContent?.trim() || "", MARGIN, this.y + 6);
    this.y += 11;

    let x = MARGIN;
    for (const span of Array.from(el.querySelectorAll(".report-meta > span"))) {
      const strong = span.querySelector("strong")?.textContent || "";
      const rest = (span.textContent || "").slice(strong.length).trimStart();
      this.font(9, true);
      const sw = this.doc.getTextWidth(strong + " ");
      this.font(9);
      const rw = this.doc.getTextWidth(rest);
      if (x > MARGIN && x + sw + rw > this.pw - MARGIN) {
        x = MARGIN;
        this.y += 5;
      }
      this.font(9, true);
      this.doc.text(strong, x, this.y);
      this.font(9);
      this.doc.text(rest, x + sw, this.y);
      x += sw + rw + 6;
    }
    this.y += 4;
    this.doc.setDrawColor(...BLUE);
    this.doc.setLineWidth(0.6);
    this.doc.line(MARGIN, this.y, this.pw - MARGIN, this.y);
    this.y += 6;
  }

  /** A heading never ends a page on its own: it needs room for what follows. */
  private heading(el: HTMLElement, level: 2 | 3, next?: HTMLElement): void {
    const followH = next ? Math.min(60, this.mm(next.getBoundingClientRect().height)) : 10;
    const text = (el.textContent || "").trim();
    if (level === 2) {
      this.ensure(11 + followH);
      this.font(12.5, true, BLUE);
      this.doc.text(text, MARGIN, this.y + 4.5);
      this.y += 6.5;
      this.doc.setDrawColor(...BLUE);
      this.doc.setLineWidth(0.3);
      this.doc.line(MARGIN, this.y, this.pw - MARGIN, this.y);
      this.y += 4;
    } else {
      this.ensure(8 + followH);
      this.font(10.5, true, rgbOf(el) || INK);
      this.y += 1.5;
      this.doc.text(text, MARGIN, this.y + 3.5);
      this.y += 6;
    }
  }

  private paragraph(el: HTMLElement): void {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const size = this.pt(el);
    const color = rgbOf(el) || INK;
    const lineH = size * 1.3 * PT;
    const lead = el.firstElementChild?.tagName === "STRONG" ? (el.firstElementChild.textContent || "").trim() : "";

    this.font(size, false, color);
    if (lead && text.startsWith(lead)) {
      // Bold lead, rest of the sentence normal, on one line when it fits
      this.font(size, true, color);
      const lw = this.doc.getTextWidth(lead);
      this.font(size, false, color);
      const rest = text.slice(lead.length);
      if (lw + this.doc.getTextWidth(rest) <= this.cw) {
        this.ensure(lineH + 2);
        this.font(size, true, color);
        this.doc.text(lead, MARGIN, this.y + lineH * 0.8);
        this.font(size, false, color);
        this.doc.text(rest, MARGIN + lw, this.y + lineH * 0.8);
        this.y += lineH + 2;
        return;
      }
    }
    const lines = this.doc.splitTextToSize(text, this.cw) as string[];
    for (const ln of lines) {
      this.ensure(lineH);
      this.doc.text(ln, MARGIN, this.y + lineH * 0.8);
      this.y += lineH;
    }
    this.y += 2;
  }

  private list(el: HTMLElement): void {
    for (const li of Array.from(el.querySelectorAll("li"))) {
      const size = this.pt(li);
      const lineH = size * 1.3 * PT;
      this.font(size);
      const lines = this.doc.splitTextToSize((li.textContent || "").replace(/\s+/g, " ").trim(), this.cw - 5) as string[];
      lines.forEach((ln, i) => {
        this.ensure(lineH);
        if (i === 0) this.doc.text("•", MARGIN + 1, this.y + lineH * 0.8);
        this.doc.text(ln, MARGIN + 5, this.y + lineH * 0.8);
        this.y += lineH;
      });
    }
    this.y += 2;
  }

  private async svgBlock(el: HTMLElement): Promise<void> {
    // Tooth charts are drawn small on screen; on paper they get most of the width.
    const grow = el.matches(".chart-figure") ? 1.6 : 1;
    for (const svg of Array.from(el.querySelectorAll(":scope > svg")) as SVGSVGElement[]) {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const wMm = Math.min(this.cw, this.mm(rect.width) * grow);
      const hMm = (rect.height / rect.width) * wMm;
      this.ensure(hMm + 1);

      // svg2pdf picks fonts by family name: point every text at the embedded font.
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.querySelectorAll("text").forEach((t) => {
        t.setAttribute("font-family", FONT);
        const weight = t.getAttribute("font-weight");
        if (weight === "bold" || Number(weight) >= 600) t.setAttribute("font-weight", "bold");
      });
      clone.setAttribute("width", String(rect.width));
      clone.setAttribute("height", String(rect.height));
      clone.style.position = "absolute";
      clone.style.left = "-10000px";
      document.body.appendChild(clone);
      try {
        await svg2pdf(clone, this.doc, { x: MARGIN + (this.cw - wMm) / 2, y: this.y, width: wMm, height: hMm });
      } finally {
        clone.remove();
      }
      this.y += hMm + 1;
    }
    this.y += 1;
  }

  private legend(el: HTMLElement): void {
    const items = Array.from(el.querySelectorAll(".legend-item")).map((item) => {
      const sw = item.querySelector(".legend-swatch") as HTMLElement | null;
      const cs = sw ? getComputedStyle(sw) : null;
      return {
        fill: (cs && cssColor(cs.backgroundColor)) || ([255, 255, 255] as RGB),
        border: (cs && cssColor(cs.borderTopColor)) || ([153, 153, 153] as RGB),
        label: (item.textContent || "").trim(),
      };
    });
    const size = 7.5;
    this.font(size);
    const gap = 4;
    const widths = items.map((it) => 3.8 + this.doc.getTextWidth(it.label));
    // Break into centred lines that fit the width
    const lines: number[][] = [[]];
    let lw = 0;
    widths.forEach((wd, i) => {
      if (lw + wd > this.cw && lines[lines.length - 1].length) {
        lines.push([]);
        lw = 0;
      }
      lines[lines.length - 1].push(i);
      lw += wd + gap;
    });
    this.ensure(lines.length * 4.5 + 1);
    for (const line of lines) {
      const total = line.reduce((a, i) => a + widths[i], 0) + gap * (line.length - 1);
      let x = MARGIN + (this.cw - total) / 2;
      for (const i of line) {
        this.doc.setFillColor(...items[i].fill);
        this.doc.setDrawColor(...items[i].border);
        this.doc.setLineWidth(0.2);
        this.doc.rect(x, this.y + 0.6, 2.6, 2.6, "FD");
        this.font(size);
        this.doc.text(items[i].label, x + 3.8, this.y + 2.9);
        x += widths[i] + gap;
      }
      this.y += 4.5;
    }
    this.y += 1;
  }

  private table(el: HTMLTableElement): void {
    const rowCount = el.rows.length;
    autoTable(this.doc, {
      html: el,
      useCss: true,
      startY: this.y,
      margin: { left: MARGIN, right: MARGIN, bottom: FOOT },
      // Small tables stay whole; long ones (OHIP, FDI) may continue on the next page.
      pageBreak: rowCount <= 12 ? "avoid" : "auto",
      rowPageBreak: "avoid",
      theme: "grid",
      styles: {
        font: FONT,
        fontSize: 6.5,
        cellPadding: 0.9,
        lineColor: [208, 208, 208],
        lineWidth: 0.15,
        textColor: INK,
        valign: "middle",
      },
      didParseCell: (data) => {
        const cellEl = data.cell.raw as HTMLTableCellElement | undefined;
        data.cell.styles.font = FONT;
        data.cell.styles.lineColor = [208, 208, 208];
        data.cell.styles.lineWidth = 0.15;
        if (!(cellEl instanceof HTMLElement)) return;
        const cs = getComputedStyle(cellEl);
        const bg = cssColor(cs.backgroundColor);
        data.cell.styles.fillColor = bg || (data.section === "head" ? [240, 240, 240] : [255, 255, 255]);
        data.cell.styles.textColor = cssColor(cs.color) || INK;
        data.cell.styles.fontStyle = Number(cs.fontWeight) >= 600 || cs.fontWeight === "bold" ? "bold" : "normal";
        data.cell.styles.halign = cs.textAlign === "left" || cs.textAlign === "start" ? "left" : "center";
        data.cell.styles.fontSize = Math.max(6, Math.min(8, this.pt(cellEl, 6)));
        data.cell.styles.cellPadding = 0.9;
      },
    });
    this.y = (this.doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3;
  }

  /** Grey box of free text. Moves whole to a new page if that lets it fit; flows otherwise. */
  private notes(el: HTMLElement): void {
    const text = (el.textContent || "").trim() || "—";
    const size = 8.5;
    const lineH = size * 1.35 * PT;
    this.font(size);
    const lines = text
      .split("\n")
      .flatMap((para) => (para.trim() ? (this.doc.splitTextToSize(para, this.cw - 6) as string[]) : [""]));
    const full = lines.length * lineH + 5;
    if (full <= this.bottom - MARGIN) this.ensure(full);

    let i = 0;
    while (i < lines.length) {
      const room = Math.max(1, Math.floor((this.bottom - this.y - 5) / lineH));
      const chunk = lines.slice(i, i + room);
      const h = chunk.length * lineH + 5;
      this.doc.setFillColor(250, 250, 250);
      this.doc.setDrawColor(224, 224, 224);
      this.doc.setLineWidth(0.2);
      this.doc.roundedRect(MARGIN, this.y, this.cw, h, 1, 1, "FD");
      this.font(size);
      chunk.forEach((ln, j) => this.doc.text(ln, MARGIN + 3, this.y + 2.5 + lineH * (j + 0.8)));
      i += chunk.length;
      this.y += h;
      if (i < lines.length) this.newPage();
    }
    this.y += 3;
  }

  private async radiographs(mount: HTMLElement): Promise<void> {
    const gap = 2;

    for (const child of Array.from(mount.children) as HTMLElement[]) {
      if (child.matches(".rtg-r-jaw")) {
        this.ensure(5);
        this.font(7.5, true, [102, 102, 102]);
        this.doc.text((child.textContent || "").trim().toUpperCase(), this.pw / 2, this.y + 3, { align: "center" });
        this.y += 5;
      } else if (child.matches(".rtg-r-row")) {
        const cells = Array.from(child.querySelectorAll(".rtg-r-cell")) as HTMLElement[];
        const cols = Number(child.dataset.cols) || cells.length || 1;
        const cellW = (this.cw - gap * (cols - 1)) / cols;
        const frameH = Math.min(cellW * 0.9, 60);
        const labelLines = cells.map((c) => (c.matches(".rtg-r-skip") ? [] : this.cellText(c, cellW)));
        const textH = Math.max(0, ...labelLines.map((l) => l.length)) * 3.2 + 1;
        this.ensure(frameH + textH + gap);
        for (let i = 0; i < cells.length; i++) {
          // A skipped position stays blank so the films line up with the other jaw
          if (cells[i].matches(".rtg-r-skip")) continue;
          const x = MARGIN + i * (cellW + gap);
          const img = cells[i].querySelector("img") as HTMLImageElement | null;
          await this.film(img, x, this.y, cellW, frameH);
          this.font(6.5);
          labelLines[i].forEach((ln, j) => this.doc.text(ln, x + cellW / 2, this.y + frameH + 3 + j * 3.2, { align: "center" }));
        }
        this.y += frameH + textH + gap;
      } else if (child.matches(".rtg-r-composite-frame")) {
        const img = child.querySelector("img") as HTMLImageElement | null;
        // Leave room below for the lower-jaw label, the side hints and the
        // start of the opinion, so a short opinion shares the page
        const below = 45;
        let maxH = this.bottom - this.y - below;
        if (maxH < 60) {
          this.newPage();
          maxH = this.bottom - this.y - below;
        }
        let w = this.cw;
        let h = Math.min(maxH, w * 0.5);
        if (img && img.src.startsWith("data:image")) {
          await img.decode().catch(() => undefined);
          const iw = img.naturalWidth || 2;
          const ih = img.naturalHeight || 1;
          const sc = Math.min(this.cw / iw, maxH / ih);
          w = iw * sc;
          h = ih * sc;
        }
        await this.film(img, MARGIN + (this.cw - w) / 2, this.y, w, h);
        this.y += h + 1;
      } else if (child.matches(".rtg-r-sides")) {
        const spans = Array.from(child.querySelectorAll("span"));
        this.font(7, false, [119, 119, 119]);
        if (spans[0]) this.doc.text((spans[0].textContent || "").trim(), MARGIN, this.y + 3);
        if (spans[1]) this.doc.text((spans[1].textContent || "").trim(), this.pw - MARGIN, this.y + 3, { align: "right" });
        this.y += 6;
      }
    }
    this.y += 2;
  }

  /** 3D snapshots: a row of 4:3 pictures on a light frame, each with its caption below. */
  private async snapshots(grid: HTMLElement): Promise<void> {
    const gap = 3;
    const cells = Array.from(grid.querySelectorAll(".s3-r-cell")) as HTMLElement[];
    const cols = Number(grid.dataset.cols) || 2;
    const cellW = (this.cw - gap * (cols - 1)) / cols;
    const frameH = cellW * 0.75;
    for (let start = 0; start < cells.length; start += cols) {
      this.ensure(frameH + 6);
      for (let i = start; i < Math.min(cells.length, start + cols); i++) {
        const x = MARGIN + (i - start) * (cellW + gap);
        const img = cells[i].querySelector("img") as HTMLImageElement | null;
        this.doc.setFillColor(243, 244, 246);
        this.doc.setDrawColor(204, 204, 204);
        this.doc.setLineWidth(0.2);
        this.doc.rect(x, this.y, cellW, frameH, "FD");
        if (img && img.src.startsWith("data:image")) {
          try {
            await img.decode().catch(() => undefined);
            this.doc.addImage(img.src, "JPEG", x, this.y, cellW, frameH);
          } catch {
            /* an undecodable picture leaves the empty frame */
          }
        }
        this.font(7);
        const label = (cells[i].querySelector(".s3-r-label")?.textContent || "").trim();
        this.doc.text(label, x + cellW / 2, this.y + frameH + 3.5, { align: "center" });
      }
      this.y += frameH + 6;
    }
    this.y += 2;
  }

  /** A black frame with the film fitted inside it, or a "ni posnetka" note. */
  private async film(img: HTMLImageElement | null, x: number, y: number, w: number, h: number): Promise<void> {
    this.doc.setFillColor(0, 0, 0);
    this.doc.setDrawColor(153, 153, 153);
    this.doc.setLineWidth(0.2);
    this.doc.rect(x, y, w, h, "FD");
    if (img && img.src.startsWith("data:image")) {
      try {
        await img.decode().catch(() => undefined);
        const iw = img.naturalWidth || 4;
        const ih = img.naturalHeight || 3;
        const s = Math.min(w / iw, h / ih);
        const dw = iw * s;
        const dh = ih * s;
        const fmt = img.src.startsWith("data:image/png") ? "PNG" : "JPEG";
        this.doc.addImage(img.src, fmt, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } catch {
        /* an undecodable film leaves the black frame */
      }
    } else {
      this.font(7, false, MUTED);
      this.doc.text("ni posnetka", x + w / 2, y + h / 2 + 1, { align: "center" });
    }
  }

  private cellText(cell: HTMLElement, width: number): string[] {
    this.font(6.5);
    const label = (cell.querySelector(".rtg-r-label")?.textContent || "").replace(/\s+/g, " ").trim();
    return this.doc.splitTextToSize(label, width) as string[];
  }

  private blankBox(): void {
    // Leave room below for the report footer so it does not spill onto a page of its own
    const h = this.bottom - this.y - 18;
    if (h < 40) {
      this.newPage();
      return this.blankBox();
    }
    this.doc.setDrawColor(153, 153, 153);
    this.doc.setLineWidth(0.3);
    this.doc.roundedRect(MARGIN, this.y, this.cw, h, 1.5, 1.5, "S");
    this.y += h + 2;
  }

  private signatures(el: HTMLElement): void {
    const labels = Array.from(el.querySelectorAll(".signature-label")).map((l) => (l.textContent || "").trim());
    this.ensure(26);
    this.y += 14;
    const gap = 8;
    const colW = (this.cw - gap * (labels.length - 1)) / labels.length;
    labels.forEach((label, i) => {
      const x = MARGIN + i * (colW + gap);
      this.doc.setDrawColor(51, 51, 51);
      this.doc.setLineWidth(0.3);
      this.doc.line(x, this.y, x + colW, this.y);
      this.font(8, false, [85, 85, 85]);
      this.doc.text(label, x + colW / 2, this.y + 4, { align: "center" });
    });
    this.y += 10;
  }

  private footer(el: HTMLElement): void {
    this.ensure(8);
    this.doc.setDrawColor(208, 208, 208);
    this.doc.setLineWidth(0.2);
    this.doc.line(MARGIN, this.y, this.pw - MARGIN, this.y);
    this.font(8, false, MUTED);
    this.doc.text((el.textContent || "").trim(), this.pw - MARGIN, this.y + 4, { align: "right" });
    this.y += 8;
  }

  pageNumbers(): void {
    const n = this.doc.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      this.doc.setPage(p);
      // Pages differ in orientation, so each one is measured on its own
      const w = this.doc.internal.pageSize.getWidth();
      const h = this.doc.internal.pageSize.getHeight();
      this.font(7.5, false, MUTED);
      this.doc.text(`${p} / ${n}`, w / 2, h - 7, { align: "center" });
    }
  }
}

function rgbOf(el: Element): RGB | null {
  return cssColor(getComputedStyle(el).color);
}
