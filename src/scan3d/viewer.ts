/* global document, HTMLElement, PointerEvent, ResizeObserver, URL, Blob, requestAnimationFrame, CanvasRenderingContext2D */

/**
 * three.js viewer for 3D surface scans. Loaded on demand (its own chunk), so
 * three.js is only downloaded when the 3D tab is opened.
 *
 * Meshes are added exactly as stored in the file — no centring or scaling —
 * so a picked point is in the file's own coordinates and stays valid for that
 * file. The camera moves to the model instead.
 */

import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Vec3, fileExtension } from "../model/scans3d";

export interface ViewerFile {
  name: string;
  blob: Blob;
}

export interface ViewerPartInput {
  id: string;
  mesh: ViewerFile;
  /** .mtl and texture images for an OBJ mesh. */
  extras: ViewerFile[];
}

export interface ViewerMarker {
  id: string;
  abbr: string;
  position: Vec3;
  active: boolean;
}

/** A measurement drawn between its landmarks: one segment, or two for an angle. */
export interface ViewerLine {
  segments: [Vec3, Vec3][];
  /** Any CSS colour. */
  color: string;
}

/** A tooth number placed on an intraoral scan. */
export interface ViewerToothLabel {
  id: string;
  text: string;
  position: Vec3;
  active: boolean;
}

export type ViewAxis = "x" | "y" | "z";

/**
 * Turn the model about a screen axis: "turn" about the vertical (positive =
 * front moves right), "tilt" about the horizontal (positive = front moves
 * down), "roll" about the line of sight (positive = clockwise).
 */
export type RotateAxis = "turn" | "tilt" | "roll";

/** Where the camera is, so each panel can keep its own view. */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  up: Vec3;
}

/** One picture for the report: a camera, the parts shown and what is drawn on them. */
export interface SnapshotSpec {
  id: string;
  camera: CameraState;
  parts: string[];
  markers: ViewerMarker[];
  lines: ViewerLine[];
  teeth: ViewerToothLabel[];
}

/**
 * The camera after turning the model by `degrees` about a screen axis (see
 * RotateAxis): the camera moves the opposite way around the target.
 */
export function rotateCameraState(state: CameraState, axis: RotateAxis, degrees: number): CameraState {
  const target = new THREE.Vector3(...state.target);
  const offset = new THREE.Vector3(...state.position).sub(target);
  const sight = offset.clone().negate().normalize();
  const up0 = new THREE.Vector3(...state.up);
  const up = up0.addScaledVector(sight, -up0.dot(sight)).normalize();
  const right = new THREE.Vector3().crossVectors(sight, up).normalize();
  const about = axis === "turn" ? up : axis === "tilt" ? right : sight;
  const q = new THREE.Quaternion().setFromAxisAngle(about, -THREE.MathUtils.degToRad(degrees));
  offset.applyQuaternion(q);
  up.applyQuaternion(q);
  const p = target.clone().add(offset);
  return { position: [p.x, p.y, p.z], target: state.target, up: [up.x, up.y, up.z] };
}

const SURFACE_COLOR = 0xd9d2c5;
const MARKER_COLOR = 0x1565c0;
const MARKER_ACTIVE_COLOR = 0xe65100;
const TOOTH_COLOR = 0x00796b;
// Screen pixels, whatever the zoom
const LINE_WIDTH_PX = 3;
// A press that moves less than this, and lifts this quickly, is a tap (place a
// landmark); anything else is a rotate/zoom gesture for the controls.
const TAP_MAX_MOVE_PX = 6;
const TAP_MAX_MS = 600;

export class ScanViewer {
  /** Called with the surface point under a tap, in file coordinates. */
  onPick: ((point: Vec3, partId: string) => void) | null = null;

  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  // Trackball, not orbit: free rotation in every direction (no locked "up",
  // no stop at the poles), which the jaw panels' camera presets also need.
  private controls: TrackballControls;
  private interacting = false;
  private animating = false;
  private settleFrames = 0;
  private parts = new Map<string, THREE.Object3D>();
  private markerGroup = new THREE.Group();
  private lineGroup = new THREE.Group();
  private toothGroup = new THREE.Group();
  private lineMaterials: LineMaterial[] = [];
  private markerRadius = 1;
  private objectUrls: string[] = [];
  private renderQueued = false;
  private resizeObserver: ResizeObserver | null = null;
  private lastAxis: { axis: ViewAxis; sign: number } | null = null;

  private press: { id: number; x: number; y: number; t: number } | null = null;
  private pointersDown = 0;
  private gestureWasMulti = false;

  constructor(container: HTMLElement) {
    this.container = container;

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      throw new Error("Ta naprava ali brskalnik ne podpira prikaza 3D (WebGL).");
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0xf3f4f6);
    this.renderer.domElement.className = "s3-canvas";
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = "s3-labels";
    container.appendChild(this.labelRenderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    // Headlight: the lit side is always the side being looked at
    const headlight = new THREE.DirectionalLight(0xffffff, 2.0);
    headlight.position.set(0, 0, 1);
    this.camera.add(headlight);
    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    this.scene.add(this.markerGroup);
    this.scene.add(this.lineGroup);
    this.scene.add(this.toothGroup);

    this.controls = new TrackballControls(this.camera, this.renderer.domElement);
    this.controls.rotateSpeed = 2.5;
    this.controls.zoomSpeed = 1.2;
    this.controls.panSpeed = 0.8;
    this.controls.staticMoving = true; // no drifting after the finger lifts
    // Its A/S/D keyboard modifiers would fire while typing the note
    this.controls.keys = ["", "", ""];
    // The trackball only moves inside update(), so run frames while a gesture
    // lasts (and briefly after, for wheel zoom), and none otherwise.
    this.controls.addEventListener("start", () => {
      this.interacting = true;
      this.animate();
    });
    this.controls.addEventListener("end", () => {
      this.interacting = false;
      this.animate();
    });

    const el = this.renderer.domElement;
    // The trackball caches the canvas position; the panel may have scrolled since
    el.addEventListener("pointerdown", () => this.controls.handleResize(), { capture: true });
    el.addEventListener("wheel", () => this.animate(), { passive: true });
    el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    el.addEventListener("pointerup", (e) => this.onPointerUp(e));
    el.addEventListener("pointercancel", () => this.onPointerCancel());

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    }
    this.resize();
  }

  // ── Loading ────────────────────────────────────────────────────

  /** Replace whatever is shown with these meshes, then frame them. */
  async loadParts(inputs: ViewerPartInput[]): Promise<void> {
    this.clearParts();
    for (const input of inputs) {
      const obj = await this.loadPart(input);
      obj.name = input.id;
      this.parts.set(input.id, obj);
      this.scene.add(obj);
    }
    this.updateMarkerScale();
    this.resetView();
  }

  private async loadPart(input: ViewerPartInput): Promise<THREE.Object3D> {
    const ext = fileExtension(input.mesh.name);
    if (ext === "stl") {
      const geometry = new STLLoader().parse(await input.mesh.blob.arrayBuffer());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hasColors = !!(geometry as any).hasColors;
      return new THREE.Mesh(geometry, surfaceMaterial(hasColors));
    }
    if (ext === "ply") {
      const geometry = new PLYLoader().parse(await input.mesh.blob.arrayBuffer());
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      return new THREE.Mesh(geometry, surfaceMaterial(!!geometry.getAttribute("color")));
    }
    if (ext === "obj") return this.loadObj(input);
    throw new Error(`Vrsta datoteke ni podprta: ${input.mesh.name}`);
  }

  private async loadObj(input: ViewerPartInput): Promise<THREE.Object3D> {
    // The .mtl names its textures by file name; serve them from the picked files.
    const urlByName = new Map<string, string>();
    for (const f of input.extras) {
      const url = URL.createObjectURL(f.blob);
      this.objectUrls.push(url);
      urlByName.set(baseName(f.name).toLowerCase(), url);
    }
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => urlByName.get(baseName(url).toLowerCase()) || url);
    // Textures arrive after the mesh is shown
    manager.onLoad = () => this.requestRender();

    const loader = new OBJLoader(manager);
    const mtl = input.extras.find((f) => fileExtension(f.name) === "mtl");
    if (mtl) {
      const materials = new MTLLoader(manager).parse(await mtl.blob.text(), "");
      materials.preload();
      loader.setMaterials(materials);
    }
    const group = loader.parse(await input.mesh.blob.text());

    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Artec OBJ exports carry no normals
      if (!mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const fixed = mats.map((m) => tameMaterial(m as THREE.Material));
      mesh.material = Array.isArray(mesh.material) ? fixed : fixed[0];
    });
    return group;
  }

  private clearParts(): void {
    for (const obj of Array.from(this.parts.values())) {
      this.scene.remove(obj);
      disposeObject(obj);
    }
    this.parts.clear();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  // ── Parts and markers ──────────────────────────────────────────

  /** Show exactly these parts. */
  setVisibleParts(ids: string[]): void {
    for (const [id, obj] of Array.from(this.parts.entries())) obj.visible = ids.includes(id);
    this.requestRender();
  }

  setPartVisible(id: string, visible: boolean): void {
    const obj = this.parts.get(id);
    if (obj) obj.visible = visible;
    this.requestRender();
  }

  setMarkers(markers: ViewerMarker[]): void {
    clearGroup(this.markerGroup);
    const geometry = new THREE.SphereGeometry(1, 16, 12);
    for (const m of markers) {
      const sphere = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: m.active ? MARKER_ACTIVE_COLOR : MARKER_COLOR })
      );
      sphere.position.set(m.position[0], m.position[1], m.position[2]);
      sphere.scale.setScalar(this.markerRadius * (m.active ? 1.4 : 1));

      const label = document.createElement("div");
      label.className = "s3-marker-label" + (m.active ? " active" : "");
      label.textContent = m.abbr;
      const labelObj = new CSS2DObject(label);
      // Offset in the sphere's own (scaled) space: just above the dot
      labelObj.position.set(0, 2.2, 0);
      sphere.add(labelObj);

      this.markerGroup.add(sphere);
    }
    this.requestRender();
  }

  /** Measurement lines, drawn over the surface so they are never hidden by it. */
  setLines(lines: ViewerLine[]): void {
    clearGroup(this.lineGroup);
    this.lineMaterials = [];
    for (const line of lines) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(line.segments.flatMap(([a, b]) => [...a, ...b]));
      const material = new LineMaterial({
        color: new THREE.Color(line.color).getHex(),
        linewidth: LINE_WIDTH_PX,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      material.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
      this.lineMaterials.push(material);
      const obj = new LineSegments2(geometry, material);
      obj.renderOrder = 10;
      this.lineGroup.add(obj);
    }
    this.requestRender();
  }

  /** Tooth number labels: a small dot on the tooth with its FDI number above it. */
  setToothLabels(labels: ViewerToothLabel[]): void {
    clearGroup(this.toothGroup);
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    for (const t of labels) {
      const dot = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: t.active ? MARKER_ACTIVE_COLOR : TOOTH_COLOR })
      );
      dot.position.set(t.position[0], t.position[1], t.position[2]);
      dot.scale.setScalar(this.markerRadius * 0.7);

      const label = document.createElement("div");
      label.className = "s3-tooth-label" + (t.active ? " active" : "");
      label.textContent = t.text;
      const labelObj = new CSS2DObject(label);
      labelObj.position.set(0, 2.5, 0);
      dot.add(labelObj);

      this.toothGroup.add(dot);
    }
    this.requestRender();
  }

  private updateMarkerScale(): void {
    const box = this.boundsOf(false);
    const diag = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
    this.markerRadius = diag * 0.004;
  }

  // ── Camera ─────────────────────────────────────────────────────

  /**
   * Frame the visible parts, looking from `direction` (file axes, from the
   * model towards the camera) with `up` pointing up on screen.
   */
  resetView(direction: Vec3 = [0, 0, 1], up: Vec3 = [0, 1, 0]): void {
    this.lastAxis = null;
    this.frame(new THREE.Vector3(...direction), new THREE.Vector3(...up));
  }

  getCameraState(): CameraState {
    const p = this.camera.position;
    const t = this.controls.target;
    const u = this.camera.up;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], up: [u.x, u.y, u.z] };
  }

  setCameraState(state: CameraState): void {
    this.lastAxis = null;
    this.camera.up.set(...state.up);
    this.camera.position.set(...state.position);
    this.controls.target.set(...state.target);
    this.fitClipping(this.camera.position.distanceTo(this.controls.target));
    this.controls.update();
    this.requestRender();
  }

  /** Rotate the model by `degrees` about a screen axis (see RotateAxis). */
  rotateModel(axis: RotateAxis, degrees: number): void {
    const next = rotateCameraState(this.getCameraState(), axis, degrees);
    this.camera.position.set(...next.position);
    this.camera.up.set(...next.up);
    this.camera.lookAt(this.controls.target);
    this.lastAxis = null;
    this.controls.update();
    this.requestRender();
  }

  /** rotateCameraState, for callers that must not import three.js themselves. */
  rotatedState(state: CameraState, axis: RotateAxis, degrees: number): CameraState {
    return rotateCameraState(state, axis, degrees);
  }

  /**
   * The camera that frames these parts from `direction` with `up` on top,
   * as the panel presets do — without moving the live camera.
   */
  framedState(direction: Vec3, up: Vec3, partIds: string[]): CameraState | null {
    const box = new THREE.Box3();
    for (const id of partIds) {
      const obj = this.parts.get(id);
      if (obj) box.expandByObject(obj);
    }
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.8;
    const p = center.clone().addScaledVector(new THREE.Vector3(...direction).normalize(), dist);
    return { position: [p.x, p.y, p.z], target: [center.x, center.y, center.z], up };
  }

  /**
   * Pictures for the report, rendered at a fixed size behind the scenes, with
   * each spec's points, lines and tooth labels drawn as in the viewer. The
   * labels (HTML in the viewer) are painted onto the picture, and only where
   * their point is not hidden behind the surface. The live view's camera and
   * parts are restored afterwards; the caller re-sets its own overlays.
   */
  captureSnapshots(specs: SnapshotSpec[], width = 800, height = 600): { id: string; dataUrl: string }[] {
    const saved = this.getCameraState();
    const visible = new Map(Array.from(this.parts.entries()).map(([id, o]) => [id, o.visible]));
    const pixelRatio = this.renderer.getPixelRatio();
    const out: { id: string; dataUrl: string }[] = [];
    try {
      this.renderer.setPixelRatio(1);
      // Leave the canvas's on-page size alone (updateStyle = false)
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      for (const spec of specs) {
        for (const [id, obj] of Array.from(this.parts.entries())) obj.visible = spec.parts.includes(id);
        this.setMarkers(spec.markers);
        this.setLines(spec.lines);
        this.setToothLabels(spec.teeth);
        for (const m of this.lineMaterials) m.resolution.set(width, height);
        this.camera.up.set(...spec.camera.up);
        this.camera.position.set(...spec.camera.position);
        const target = new THREE.Vector3(...spec.camera.target);
        this.camera.lookAt(target);
        this.fitClipping(this.camera.position.distanceTo(target));
        this.camera.updateMatrixWorld();
        this.renderer.render(this.scene, this.camera);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(this.renderer.domElement, 0, 0);
        const labels = [
          ...spec.markers.map((m) => ({ text: m.abbr, at: m.position, tooth: false })),
          ...spec.teeth.map((t) => ({ text: t.text, at: t.position, tooth: true })),
        ];
        if (labels.length) {
          const shown = this.pointsInSight(labels.map((l) => l.at), width, height);
          labels.forEach((l, i) => {
            if (shown[i]) drawLabel(ctx, this.toPixel(l.at, width, height), l.text, l.tooth);
          });
        }
        out.push({ id: spec.id, dataUrl: canvas.toDataURL("image/jpeg", 0.88) });
      }
    } finally {
      for (const [id, obj] of Array.from(this.parts.entries())) obj.visible = visible.get(id) ?? true;
      this.renderer.setPixelRatio(pixelRatio);
      this.resize();
      this.setCameraState(saved);
    }
    return out;
  }

  /** Canvas pixel (top-left origin) of a point, for the current camera. */
  private toPixel(p: Vec3, width: number, height: number): [number, number] {
    const v = new THREE.Vector3(...p).project(this.camera);
    return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
  }

  /**
   * Which points the camera sees: an off-screen pass draws the visible
   * surface in black and a small sphere per point in its own colour; a point
   * is in sight where its colour survives the depth test at its centre.
   */
  private pointsInSight(points: Vec3[], width: number, height: number): boolean[] {
    const target = new THREE.WebGLRenderTarget(width, height);
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    const idScene = new THREE.Scene();
    const sphere = new THREE.SphereGeometry(this.markerRadius * 1.2, 12, 8);
    const materials: THREE.Material[] = [];
    // Index i is encoded as RGB = 4·(i+1) in steps the readback cannot confuse
    points.forEach((p, i) => {
      const code = i + 1;
      const color = new THREE.Color().setRGB(
        ((code % 64) * 4) / 255,
        ((Math.floor(code / 64) % 64) * 4) / 255,
        0,
        THREE.LinearSRGBColorSpace
      );
      const mat = new THREE.MeshBasicMaterial({ color });
      materials.push(mat);
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.position.set(...p);
      idScene.add(mesh);
    });
    const overlays = [this.markerGroup, this.lineGroup, this.toothGroup];
    const clear = this.renderer.getClearColor(new THREE.Color());
    const clearAlpha = this.renderer.getClearAlpha();
    const pixels = new Uint8Array(width * height * 4);
    try {
      for (const g of overlays) g.visible = false;
      this.scene.overrideMaterial = black;
      this.renderer.setClearColor(0xffffff, 1);
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.render(idScene, this.camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } finally {
      this.renderer.autoClear = true;
      this.renderer.setRenderTarget(null);
      this.scene.overrideMaterial = null;
      this.renderer.setClearColor(clear, clearAlpha);
      for (const g of overlays) g.visible = true;
      target.dispose();
      black.dispose();
      sphere.dispose();
      for (const m of materials) m.dispose();
    }
    return points.map((p, i) => {
      const [px, py] = this.toPixel(p, width, height);
      // The target's rows run bottom-up
      const x = Math.round(px);
      const y = Math.round(height - py);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const o = (yy * width + xx) * 4;
          if (pixels[o + 2] > 8) continue; // background (white)
          const code = Math.round(pixels[o] / 4) + 64 * Math.round(pixels[o + 1] / 4);
          if (code === i + 1) return true;
        }
      }
      return false;
    });
  }

  /** Look along an axis of the file; pressing the same axis again flips to the other side. */
  viewAlong(axis: ViewAxis): void {
    const sign = this.lastAxis && this.lastAxis.axis === axis ? -this.lastAxis.sign : 1;
    this.lastAxis = { axis, sign };
    const dir = new THREE.Vector3(axis === "x" ? sign : 0, axis === "y" ? sign : 0, axis === "z" ? sign : 0);
    const up = axis === "y" ? new THREE.Vector3(0, 0, -sign) : new THREE.Vector3(0, 1, 0);
    this.frame(dir, up);
  }

  private frame(direction: THREE.Vector3, up: THREE.Vector3): void {
    const box = this.boundsOf();
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    // The bounding sphere overstates a head or an arch; 0.8 fills the view without clipping
    const dist = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.8;

    this.camera.up.copy(up);
    this.camera.position.copy(center).addScaledVector(direction.normalize(), dist);
    this.fitClipping(dist);
    this.controls.target.copy(center);
    this.controls.update();
    this.requestRender();
  }

  private fitClipping(dist: number): void {
    this.camera.near = Math.max(dist / 1000, 0.01);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
  }

  /** Extent of everything loaded, in file units — shown so the unit can be checked. */
  modelSize(): Vec3 | null {
    const box = this.boundsOf(false);
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    return [size.x, size.y, size.z];
  }

  /** Bounds of the visible parts (all parts if none is visible, or when asked). */
  private boundsOf(onlyVisible = true): THREE.Box3 {
    const all = Array.from(this.parts.values());
    const visible = all.filter((o) => o.visible);
    const box = new THREE.Box3();
    for (const obj of onlyVisible && visible.length ? visible : all) box.expandByObject(obj);
    return box;
  }

  // ── Picking ────────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    this.pointersDown++;
    if (this.pointersDown > 1) this.gestureWasMulti = true;
    if (this.pointersDown === 1) {
      this.gestureWasMulti = false;
      this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now() };
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointersDown = Math.max(0, this.pointersDown - 1);
    const press = this.press;
    if (this.pointersDown === 0) this.press = null;
    if (!press || press.id !== e.pointerId || this.gestureWasMulti) return;
    const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
    if (moved > TAP_MAX_MOVE_PX || Date.now() - press.t > TAP_MAX_MS) return;
    this.pickAt(e.clientX, e.clientY);
  }

  private onPointerCancel(): void {
    this.pointersDown = 0;
    this.press = null;
  }

  private pickAt(clientX: number, clientY: number): void {
    if (!this.onPick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const visible = Array.from(this.parts.values()).filter((o) => o.visible);
    const hit = raycaster.intersectObjects(visible, true)[0];
    if (!hit) return;

    let partId = "";
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      if (this.parts.has(o.name) && this.parts.get(o.name) === o) {
        partId = o.name;
        break;
      }
    }
    this.onPick([hit.point.x, hit.point.y, hit.point.z], partId);
  }

  // ── Rendering ──────────────────────────────────────────────────

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // hidden tab
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    for (const m of this.lineMaterials) m.resolution.set(w, h);
    this.controls.handleResize();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private animate(): void {
    this.settleFrames = 12;
    if (this.animating) return;
    this.animating = true;
    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
      if (this.interacting || --this.settleFrames > 0) requestAnimationFrame(tick);
      else this.animating = false;
    };
    requestAnimationFrame(tick);
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.scene, this.camera);
      this.labelRenderer.render(this.scene, this.camera);
    });
  }

  /** PNG of the current view, e.g. for the report. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.clearParts();
    this.setMarkers([]);
    this.setLines([]);
    this.setToothLabels([]);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}

/** A point label painted onto a report picture, styled like the viewer's. */
function drawLabel(ctx: CanvasRenderingContext2D, at: [number, number], text: string, tooth: boolean): void {
  ctx.font = "bold 13px 'Segoe UI', sans-serif";
  const w = ctx.measureText(text).width + 8;
  const h = 17;
  const x = at[0] - w / 2;
  const y = at[1] - h - 7;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fillStyle = tooth ? "rgba(255, 255, 255, 0.92)" : "rgba(21, 101, 192, 0.9)";
  ctx.fill();
  if (tooth) {
    ctx.strokeStyle = "#00796b";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = tooth ? "#00594f" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at[0], y + h / 2 + 0.5);
}

function surfaceMaterial(vertexColors: boolean): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : SURFACE_COLOR,
    vertexColors,
    roughness: 0.65,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

/** Artec's .mtl asks for a mirror-like finish (Ks 1, Ns 1000); render it matte. */
function tameMaterial(m: THREE.Material): THREE.Material {
  const phong = m as THREE.MeshPhongMaterial;
  if (phong.isMeshPhongMaterial) {
    phong.specular.setHex(0x111111);
    phong.shininess = 8;
    if (!phong.map) phong.color.setHex(SURFACE_COLOR);
  }
  m.side = THREE.DoubleSide;
  return m;
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    // Fat lines are meshes too (LineSegments2 extends Mesh)
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const map = (m as THREE.MeshPhongMaterial).map;
      if (map) map.dispose();
      m.dispose();
    }
  });
  // CSS2D labels are DOM nodes, removed with their objects
  root.traverse((child) => {
    if (child instanceof CSS2DObject) child.element.remove();
  });
}

function baseName(path: string): string {
  const clean = path.split("?")[0].split("#")[0];
  const name = clean.substring(Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\")) + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}
