/* global document, HTMLElement, PointerEvent, ResizeObserver, URL, Blob, requestAnimationFrame */

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

const SURFACE_COLOR = 0xd9d2c5;
const MARKER_COLOR = 0x1565c0;
const MARKER_ACTIVE_COLOR = 0xe65100;
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
    for (const child of [...this.markerGroup.children]) {
      this.markerGroup.remove(child);
      disposeObject(child);
    }
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
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const sight = offset.clone().negate().normalize();
    const up = this.camera.up.clone().addScaledVector(sight, -this.camera.up.dot(sight)).normalize();
    const right = new THREE.Vector3().crossVectors(sight, up).normalize();
    const about = axis === "turn" ? up : axis === "tilt" ? right : sight;
    // Turning the camera the opposite way turns the model the asked way
    const q = new THREE.Quaternion().setFromAxisAngle(about, -THREE.MathUtils.degToRad(degrees));
    offset.applyQuaternion(q);
    up.applyQuaternion(q);
    this.camera.position.copy(target).add(offset);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
    this.lastAxis = null;
    this.controls.update();
    this.requestRender();
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
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
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

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
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
