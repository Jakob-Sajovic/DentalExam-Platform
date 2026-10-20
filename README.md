# DentalExam Platform — Dentalni pregled s 3D skeni

Dental examination data entry, saving, loading and PDF report generation, extended with
**3D surface scans** (Artec head scans, TRIOS intraoral scans) and preset landmark
measurements. UI language is **Slovenian**.

The same application ships as **two front-ends** built from one source tree:

| | Excel add-in | Standalone app (PWA) |
|---|---|---|
| Runs in | Excel (desktop, web, tablet via Excel Online) | Any modern browser; installable to the home screen |
| Needs Excel | yes | no |
| Data lives in | the host workbook | the device (IndexedDB), exported to `.xlsx` |
| Works offline | no | yes, after first load |
| Install | sideload `manifest.xml` | open the URL, "Add to Home Screen" / install |

Both write **byte-compatible `.xlsx`**, so `DentalCompiler` / `dental_compiler.py` reads
output from either without changes.

**Live:** [https://jakob-sajovic.github.io/DentalExam-Platform/](https://jakob-sajovic.github.io/DentalExam-Platform/)

| URL | What |
|---|---|
| `…/` | chooser page — links to both front-ends and the manifest |
| `…/taskpane.html` | Excel add-in task pane |
| `…/pwa/` | standalone app |
| `…/manifest.xml` | add-in manifest for sideloading |

## Features

- **Patient data** — date, checkup number (1–10), name, surname, anonymized code, examiner
- **Plaque index (VPI)** — interactive dental chart with 4-surface toggle per tooth, explicit missing-tooth buttons (✕), auto-calculated percentage
- **Bleeding index (GBI)** — same chart layout, separate data, auto-calculated percentage; missing tooth state synced from VPI
- **ICDAS assessment** — 5-surface cross-pattern chart, two dropdowns per surface (restoration + caries codes), special case codes for missing/unerupted teeth; code 60 (Popolna prevleka) preserves plaque/bleeding/probing data; implant codes 90/91 keep the tooth counted as missing while VPI, GBI and surface codes stay recordable on the implant (probing, furcation and root caries are disabled); bulk-set applies independently per code type
- **Probing depths** — 6-site measurements per tooth with color-coded area charts, furcation grading
- **Radiographs (RTG)** — 10-film full-mouth periapical mount (2×5, viewer-left = patient-right), bulk import sorted by file name with capture-time fallback, per-slot rotate/replace/caption, free-text radiographic opinion; images downscaled to 1400 px / JPEG q0.82 and stored outside the data row
- **Root caries** — per-tooth root caries assessment
- **FDI questionnaire** — FDI Periodontal Disease Profile (8 questions); Q5–Q8 auto-calculated from existing clinical data (tooth loss, VPI%, GBI%, probing depths)
- **OHIP-49 questionnaire** — 49-item oral health quality of life survey, 7 domains, Likert 0–4, auto-scored
- **3D scans** (standalone app only) — Artec head scans (OBJ+MTL+texture, or STL) and TRIOS intraoral scans (STL/PLY) in a three.js viewer with free rotation (drag, plus turn/tilt/roll buttons in 1–90° steps); intraoral scans have separate *upper jaw*, *lower jaw* and *occlusion* panels; preset landmarks are placed by tapping and distances/angles are computed and saved as `s3_*` columns. Mesh files stay on the device (IndexedDB, keyed by SHA-256) and are never written into the `.xlsx`. Landmark lists are placeholders pending the clinical team.
- **Notes** — free-text diagnostic and qualitative observations
- **Cross-tab sync** — marking a tooth missing in VPI automatically updates bleeding, probing, and ICDAS (defaults to special code 97)
- **Reset with confirmation** — all reset buttons use two-click confirmation (no browser dialogs)
- **Persistence** — structured save/load to worksheet rows with JSON backup column (add-in), or IndexedDB + `.xlsx` export (standalone)
- **PDF reports** — print-friendly HTML report with dental charts, tables, radiographs, FDI summary, and signature fields

## Architecture

Only the landing and save tabs ever touched Excel. They now depend on a **`SessionStore`**
port (`src/storage/session-store.ts`); every other tab is host-agnostic and shared verbatim
between the two front-ends.

```
src/storage/session-store.ts   the port: save / loadFromHost / loadFromFile + UI labels
src/storage/excel-store.ts     add-in implementation (host workbook)
src/pwa/pwa-store.ts           standalone implementation (IndexedDB + .xlsx download)
```

Serialization is a **single pure module** driven by two hosts:

```
src/excel/session-codec.ts   PURE session <-> sheet-row serialization (1502 columns)
src/excel/excel-io.ts        drives the codec through the Office JS API
src/pwa/workbook.ts          drives the SAME codec through SheetJS
```

> **Change the codec, never one side only** — that is what keeps the two outputs
> byte-compatible and `DentalCompiler` working.

### Standalone app specifics

- **Autosave** to IndexedDB 1.5 s after any change, plus on `pagehide` and `visibilitychange`.
- An examination exists **only on the device** until exported; the landing list flags
  un-exported sessions with a red *"ni izvoženo"* badge and a warning count.
- **Service worker** (`src/pwa/static/sw.js`) caches the app shell for offline use.
  Examination data never passes through it. The cache name carries the build id, so a
  redeploy replaces the old cache and the app shows an update banner.
- `PWA_BUILD_ID` (a timestamp) is injected into both `sw.js` and the bundle
  (`__PWA_BUILD_ID__`), and is displayed in the status bar as `različica …`. Quote it in
  bug reports.
- The PWA entry deliberately **bundles its own core-js/regenerator** instead of sharing the
  root `polyfill.js`: a service worker at `pwa/sw.js` can only intercept requests under
  `pwa/`, so a root-level polyfill would break offline mode.

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- npm (included with Node.js)

## Setup

```bash
cd DentalExam
npm install
```

## Development

Start the local dev server with HTTPS on port 3000:

```bash
npm run dev-server
```

- **Add-in:** sideload in Excel — `npm start` (Windows), or upload `manifest.xml` via
  Insert > Office Add-ins > Upload My Add-in. On Mac see
  [Microsoft's sideloading guide](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac).
- **Standalone app:** open `https://localhost:3000/pwa/`. A service worker needs a secure
  context, so plain `http://` on a LAN IP will silently run without offline support.

## Build

```bash
npm run build
```

Output goes to `dist/`, containing both front-ends. The production build replaces
`localhost:3000` URLs in the manifest with the GitHub Pages production URL configured in
`webpack.config.js`.

> `clean: true` wipes `dist/` on every build — do not keep anything of your own in there.

## Deployment (GitHub Pages)

One deploy publishes the chooser page, the add-in and the standalone app together:

```bash
npm run deploy      # = npm run build && node node_modules/gh-pages/bin/gh-pages.js -d dist
```

Notes:

- Run from **PowerShell** on Windows (`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
  first). `npx gh-pages -d dist` does not work on this machine, which is why the script calls
  the binary directly.
- Enable GitHub Pages in repo settings (Settings > Pages > Source: `gh-pages` branch) if not
  already enabled.
- **Distributing the add-in:** users download `manifest.xml` from the GitHub Pages URL and
  sideload it:
  - **Desktop Excel:** Insert > Get Add-ins > Upload My Add-in > Browse to `manifest.xml`
  - **Excel Online:** Insert > Office Add-ins > Upload My Add-in
  - **Android tablet:** open the spreadsheet in Excel Online via Chrome (toggling Chrome's
    **"Desktop site"** on or off often decides whether the pane loads)
  - **Admin deployment:** upload the manifest in the
    [Microsoft 365 admin center](https://admin.microsoft.com/) under Integrated Apps
- **Distributing the standalone app:** send users the `…/pwa/` URL. Installed apps pick up a
  redeploy on their own and offer an *Osveži* banner.

### Slovenian end-user documentation

- [Navodila za uporabo.docx](Navodila%20za%20uporabo.docx) — full guide to the Excel add-in
  and the data compiler
- [Navodila za namestitev dodatka.docx](Navodila%20za%20namestitev%20dodatka.docx) — add-in
  installation only
- [Navodila za uporabo — samostojna aplikacija.docx](Navodila%20za%20uporabo%20%E2%80%94%20samostojna%20aplikacija.docx)
  — the standalone app: installation, first run, daily workflow, and how not to lose data

## Project Structure

```
DentalExam/
  src/
    index.html               — chooser page served at the site root
    taskpane/
      taskpane.html          — add-in shell (tab container + panels)
      taskpane.ts            — add-in entry point, tab registration, bootstrap
      taskpane.css           — all shared styling
    tabs/                    — host-agnostic, shared by both front-ends
      tab-manager.ts         — tab switching & lifecycle
      tab-landing.ts         — session management (new/load/close), takes a SessionStore
      tab-patient.ts         — patient demographics
      tab-plaque-bleeding.ts — VPI & GBI charts with missing-tooth buttons
      tab-icdas.ts           — ICDAS assessment with special codes & code 60
      tab-probing.ts         — probing depths & furcation
      tab-radiographs.ts     — 10-film periapical mount, import, rotate, captions
      tab-notes.ts           — free-text notes
      tab-ohip.ts            — OHIP-49 questionnaire
      tab-fdi.ts             — FDI Periodontal Disease Profile (auto-calc)
      tab-save-report.ts     — save & summary view, takes a SessionStore
    storage/
      session-store.ts       — the storage port both front-ends program against
      excel-store.ts         — Excel implementation of the port
    model/
      types.ts               — TypeScript interfaces (session, tooth data, FDI, radiographs)
      constants.ts           — ICDAS codes, OHIP domains, tooth arrays, tab & RTG slot defs
      session.ts             — singleton session state, cross-tab tooth sync
    dental/
      tooth-map.ts           — FDI tooth numbering helpers
      tooth-outlines.ts      — SVG tooth outline paths
      chart-renderer.ts      — interactive tooth chart rendering
    images/
      image-utils.ts         — client-side downscale/re-encode, byte formatting
    excel/
      session-codec.ts       — pure session <-> row serialization (shared by both hosts)
      excel-io.ts            — Office JS API driver for the codec, image sheet handling
    pwa/
      pwa.html / pwa.ts      — standalone shell and entry (no Office.js), autosave, SW wiring
      pwa.css                — standalone-only layout (status bar, update banner, session list)
      pwa-store.ts           — SessionStore implementation: IndexedDB + .xlsx export
      tab-pwa-landing.ts     — landing with the device's session list
      workbook.ts            — SheetJS driver for the codec, download helper
      idb.ts                 — minimal IndexedDB wrapper, no dependencies
      static/                — manifest.webmanifest, sw.js, icons/
    report/
      report-generator.ts    — report HTML (add-in: print window; PWA: in-app layer)
      report-layer.ts        — PWA: report as an in-app layer, PDF share (iOS) / download
      report-pdf.ts          — PWA: rendered report → vector A4 PDF (jsPDF, svg2pdf, autotable)
      fonts.ts               — DejaVu Sans subset embedded in the PDF (standard PDF fonts lack č)
    commands/                — ribbon command page & handlers (add-in only)
  assets/                    — icons and reference images
  manifest.xml               — Office Add-in XML manifest
  webpack.config.js          — build configuration for both targets
  package.json               — dependencies and scripts
```

## Technology

- TypeScript, vanilla HTML/CSS (no framework)
- Office JavaScript API (`Excel.run`, worksheets, ranges) — add-in target
- SheetJS (`xlsx`) + IndexedDB + a service worker — standalone target
- Webpack + Babel (the project builds via **babel**, not `tsc`)
- PDF: add-in via the browser print dialog; standalone app generates the PDF itself (jsPDF)

### PDF in the standalone app

An app installed to the iOS home screen hands `window.open` to Safari (no way back into the app)
and ignores `window.print()`. So the PWA shows the report as a full-screen layer inside the app
and **builds the PDF in the browser**: `report-pdf.ts` walks the report the layer has laid out
(the same HTML the add-in prints) — charts through svg2pdf (vector), tables through
jspdf-autotable with their cell colours, radiographs as JPEGs. On iOS/iPadOS the file goes to the
share sheet (`navigator.share` with files: Save to Files, Print, Mail); elsewhere it downloads,
and *Natisni* (printing the layer) stays available. iOS only opens the share sheet from inside the
tap, so the PDF is built when the report opens and the button enables when it is ready.

`pwa/report-pdf.js` is a named on-demand chunk inside the service worker's scope and on its
pre-cache list, so the PDF works offline. The add-in is unchanged.

## License

MIT
