// 3D viewport: three.js scene, Z-up, orbit controls, picking, named views and the axis gizmo.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Box, Focus, Grid3x3, House, LoaderCircle, Orbit, Scan, Square, Hand, Layers } from "lucide-react";
import { getState, requestView, setState, useStore, findFeature } from "../state/store";
import type { BodyMesh } from "../engine/client";

const VIEWS: Record<string, [number, number, number]> = {
  home: [1, -1.25, 0.9],
  iso: [1, -1, 1],
  top: [0, -0.0001, 1],
  bottom: [0, 0.0001, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

type Scene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  camera: THREE.Camera;
  controls: OrbitControls;
  bodies: THREE.Group;
  grid: THREE.Group;
  meshes: Map<string, { mesh: THREE.Mesh; edges: THREE.LineSegments; data: BodyMesh }>;
  anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; dur: number } | null;
};

function makeGrid() {
  const g = new THREE.Group();
  const minor: number[] = [];
  const major: number[] = [];
  const S = 400;
  for (let v = -S; v <= S; v += 10) {
    const arr = v % 50 === 0 ? major : minor;
    if (v === 0) continue;
    arr.push(-S, v, 0, S, v, 0, v, -S, 0, v, S, 0);
  }
  const lines = (pts: number[], color: number, opacity: number) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  };
  g.add(lines(minor, 0x5a6068, 0.16));
  g.add(lines(major, 0x6c737c, 0.32));
  g.add(lines([-S, 0, 0, S, 0, 0], 0xc0504d, 0.75));
  g.add(lines([0, -S, 0, 0, S, 0], 0x5ba35b, 0.75));
  g.renderOrder = -1;
  return g;
}

function sceneBounds(s: Scene) {
  const box = new THREE.Box3();
  s.meshes.forEach(({ mesh }) => mesh.visible && box.expandByObject(mesh));
  if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 50));
  return box;
}

function frame(s: Scene, dir: [number, number, number] | null, animate = true) {
  const box = sceneBounds(s);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10);
  const d = dir ? new THREE.Vector3(...dir).normalize() : s.persp.position.clone().sub(s.controls.target).normalize();
  const dist = radius / Math.sin((s.persp.fov * Math.PI) / 360) * 1.08;
  const to = centre.clone().add(d.multiplyScalar(dist));
  s.ortho.zoom = 1;
  const aspect = s.renderer.domElement.clientWidth / Math.max(1, s.renderer.domElement.clientHeight);
  const h = radius * 1.25;
  Object.assign(s.ortho, { left: -h * aspect, right: h * aspect, top: h, bottom: -h });
  s.ortho.updateProjectionMatrix();
  if (!animate) {
    s.persp.position.copy(to);
    s.controls.target.copy(centre);
    return;
  }
  s.anim = { from: s.persp.position.clone(), to, tFrom: s.controls.target.clone(), tTo: centre, t0: performance.now(), dur: 320 };
}

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const gizmo = useRef<SVGSVGElement>(null);
  const sref = useRef<Scene | null>(null);
  const regen = useStore((s) => s.regen);
  const plan = useStore((s) => s.plan);
  const selection = useStore((s) => s.selection);
  const display = useStore((s) => s.display);
  const ortho = useStore((s) => s.ortho);
  const grid = useStore((s) => s.grid);
  const viewRequest = useStore((s) => s.viewRequest);
  const regenerating = useStore((s) => s.regenerating);
  const kernelReady = useStore((s) => s.kernelReady);
  const kernelError = useStore((s) => s.kernelError);

  // ---- set up once
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    // iOS can drop the WebGL context under memory pressure; say so instead of showing black.
    renderer.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      setState({ kernelError: "The 3D view lost its graphics context (the device may be low on memory). Reload the page to restore it; your design is unchanged." });
      import("./ErrorBoundary").then(({ reportClientError }) => reportClientError("webglcontextlost", new Error("WebGL context lost")));
    });
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-roledescription", "3D model view");
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    const persp = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
    persp.up.set(0, 0, 1);
    const orthoCam = new THREE.OrthographicCamera(-100, 100, 100, -100, -20000, 20000);
    orthoCam.up.set(0, 0, 1);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, -2, 3);
    persp.add(key);
    scene.add(persp, new THREE.HemisphereLight(0xdfe8f5, 0x30343a, 0.6));
    const controls = new OrbitControls(persp, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.18;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    const bodies = new THREE.Group();
    const gridGroup = makeGrid();
    scene.add(bodies, gridGroup);
    const s: Scene = { renderer, scene, persp, ortho: orthoCam, camera: persp, controls, bodies, grid: gridGroup, meshes: new Map(), anim: null };
    sref.current = s;
    persp.position.set(220, -260, 180);
    controls.update();

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      persp.aspect = w / Math.max(1, h);
      persp.updateProjectionMatrix();
      const hh = (orthoCam.top - orthoCam.bottom) / 2;
      orthoCam.left = -hh * persp.aspect;
      orthoCam.right = hh * persp.aspect;
      orthoCam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // picking: click without drag selects a body
    let down: { x: number; y: number } | null = null;
    const ray = new THREE.Raycaster();
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), s.camera);
      const hits = ray.intersectObjects([...s.meshes.values()].filter((m) => m.mesh.visible).map((m) => m.mesh));
      const id = hits[0]?.object.userData.bodyId as string | undefined;
      setState({ selection: id ? { kind: "body", id } : null });
      if (id) setState({ status: `Selected ${getState().plan.bodies.find((b) => b.id === id)?.name}` });
    };
    const onDbl = () => requestView("fit");
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("dblclick", onDbl);

    // render loop (also drives the gizmo)
    let raf = 0;
    const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (s.anim) {
        const k = Math.min(1, (performance.now() - s.anim.t0) / s.anim.dur);
        const e = 1 - Math.pow(1 - k, 3);
        persp.position.lerpVectors(s.anim.from, s.anim.to, e);
        controls.target.lerpVectors(s.anim.tFrom, s.anim.tTo, e);
        if (k >= 1) s.anim = null;
      }
      controls.update();
      if (s.camera === orthoCam) {
        orthoCam.position.copy(persp.position);
        orthoCam.quaternion.copy(persp.quaternion);
      }
      renderer.render(scene, s.camera);
      const g = gizmo.current;
      if (g) {
        const q = persp.quaternion.clone().invert();
        for (const [k, v] of Object.entries(axes)) {
          const p = v.clone().applyQuaternion(q);
          const x = 48 + p.x * 32;
          const y = 48 - p.y * 32;
          const line = g.querySelector<SVGLineElement>(`[data-ax=${k}]`);
          const circ = g.querySelector<SVGGElement>(`[data-dot=${k}]`);
          const neg = g.querySelector<SVGCircleElement>(`[data-neg=${k}]`);
          line?.setAttribute("x2", String(x));
          line?.setAttribute("y2", String(y));
          circ?.setAttribute("transform", `translate(${x} ${y})`);
          neg?.setAttribute("cx", String(48 - p.x * 32));
          neg?.setAttribute("cy", String(48 + p.y * 32));
          if (circ) circ.style.opacity = p.z < -0.2 ? "0.55" : "1";
        }
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // ---- body meshes from the latest regeneration
  useEffect(() => {
    const s = sref.current;
    if (!s || !regen) return;
    const first = s.meshes.size === 0;
    s.meshes.forEach(({ mesh, edges }) => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      edges.geometry.dispose();
      (edges.material as THREE.Material).dispose();
    });
    s.bodies.clear();
    s.meshes.clear();
    for (const b of regen.bodies) {
      if (b.empty) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(b.vertices, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(b.normals, 3));
      geo.setIndex(new THREE.BufferAttribute(b.triangles, 1));
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(b.color ?? (getComputedStyle(document.documentElement).getPropertyValue("--body-default").trim() || "white")), metalness: 0.25, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.bodyId = b.id;
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.BufferAttribute(b.lines, 3));
      const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x15171a }));
      s.bodies.add(mesh, edges);
      s.meshes.set(b.id, { mesh, edges, data: b });
    }
    if (first) frame(s, VIEWS.home, false);
  }, [regen]);

  // ---- text alternative for the canvas
  useEffect(() => {
    sref.current?.renderer.domElement.setAttribute("aria-label", describeScene(plan, regen));
  }, [plan, regen]);

  // ---- visibility, display mode and selection highlight
  useEffect(() => {
    const s = sref.current;
    if (!s) return;
    let selBody: string | null = null;
    if (selection?.kind === "body") selBody = selection.id;
    if (selection?.kind === "feature") selBody = findFeature(plan, selection.id)?.body.id ?? null;
    s.meshes.forEach(({ mesh, edges }, id) => {
      const body = plan.bodies.find((b) => b.id === id);
      const visible = body?.visible !== false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mesh.visible = visible && display !== "wireframe";
      edges.visible = visible && display !== "shaded";
      mat.emissive.set(id === selBody ? 0x3a2410 : 0x000000);
      (edges.material as THREE.LineBasicMaterial).color.set(id === selBody ? 0xf0a03c : display === "wireframe" ? 0xb8c0ca : 0x15171a);
    });
    s.grid.visible = grid;
  }, [regen, plan, selection, display, grid]);

  useEffect(() => {
    const s = sref.current;
    if (!s) return;
    s.camera = ortho ? s.ortho : s.persp;
    s.controls.object = s.persp;
    if (ortho) frame(s, null, false);
  }, [ortho]);

  useEffect(() => {
    const s = sref.current;
    if (!s || !viewRequest) return;
    frame(s, viewRequest.name === "fit" ? null : VIEWS[viewRequest.name] ?? VIEWS.home);
  }, [viewRequest]);

  const axis = (k: "x" | "y" | "z", color: string, view: string, negView: string) => (
    <g key={k}>
      <line data-ax={k} x1="48" y1="48" x2="48" y2="48" stroke={color} strokeWidth="2" />
      <circle data-neg={k} r="5" cx="48" cy="48" fill="none" stroke={color} strokeWidth="1.4" opacity="0.7" className="ax" onClick={() => requestView(negView)} />
      <g data-dot={k}>
        <circle r="8" fill={color} className="ax" onClick={() => requestView(view)} />
        <text textAnchor="middle" dy="3.2" fill="var(--gizmo-text)">{k.toUpperCase()}</text>
      </g>
    </g>
  );

  return (
    <div className="viewport" ref={host}>
      <svg className="gizmo" ref={gizmo} viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r="44" fill="rgba(30,33,37,0.55)" stroke="var(--border)" />
        {axis("x", "var(--axis-x)", "right", "left")}
        {axis("y", "var(--axis-y)", "back", "front")}
        {axis("z", "var(--axis-z)", "top", "bottom")}
        <circle cx="48" cy="48" r="3" fill="var(--text-muted)" className="ax" onClick={() => requestView("home")} />
      </svg>
      {(regenerating || !kernelReady) && !kernelError ? (
        <div className="vp-busy"><LoaderCircle size={14} className="spin" /> {kernelReady ? "Regenerating…" : "Loading Open CASCADE kernel…"}</div>
      ) : null}
      {kernelError ? <div className="vp-overlay"><div className="msg err">Geometry kernel failed to load: {kernelError}</div></div> : null}
      <div className="vp-badge">{ortho ? "Orthographic" : "Perspective"} · mm · Z up</div>
      <ViewToolbar />
    </div>
  );
}

/** Text alternative for the 3D canvas (WCAG 1.1.1): what is shown, with measured sizes. */
function describeScene(plan: ReturnType<typeof getState>["plan"], regen: ReturnType<typeof getState>["regen"]) {
  const bodies = plan.bodies.filter((b) => b.visible).map((b) => {
    const m = regen?.bodies.find((x) => x.id === b.id);
    if (!m || m.empty) return `${b.name}: no geometry`;
    const [x, y, z] = m.bounds.size.map((v) => +v.toFixed(1));
    return `${b.name}: ${x} by ${y} by ${z} mm${m.failed ? ", has errors" : ""}`;
  });
  return `${plan.name}. ${bodies.length ? bodies.join("; ") : "No visible bodies"}. Use the view toolbar or the Named Views list to change the view.`;
}

function ViewToolbar() {
  const display = useStore((s) => s.display);
  const ortho = useStore((s) => s.ortho);
  const grid = useStore((s) => s.grid);
  const next = { "shaded-edges": "shaded", shaded: "wireframe", wireframe: "shaded-edges" } as const;
  const DisplayIcon = display === "wireframe" ? Scan : display === "shaded" ? Square : Box;
  return (
    <div className="view-toolbar" role="toolbar" aria-label="View">
      <button className="tb-btn" title="Home view" onClick={() => requestView("home")}><House size={15} /></button>
      <button className="tb-btn" title="Fit (double-click the canvas)" onClick={() => requestView("fit")}><Focus size={15} /></button>
      <button className="tb-btn" title="Orbit: left drag · Pan: right or middle drag · Zoom: wheel" onClick={() => setState({ status: "Orbit: left drag · Pan: right/middle drag · Zoom: wheel" })}><Orbit size={15} /></button>
      <button className="tb-btn" title="Pan: right or middle drag" onClick={() => setState({ status: "Pan with the right or middle mouse button" })}><Hand size={15} /></button>
      <button className="tb-btn on" title={`Display: ${display} (click to cycle)`} onClick={() => setState({ display: next[display] })}><DisplayIcon size={15} /></button>
      <button className={`tb-btn ${ortho ? "on" : ""}`} title="Orthographic / perspective" onClick={() => setState({ ortho: !ortho })}><Layers size={15} /></button>
      <button className={`tb-btn ${grid ? "on" : ""}`} title="Grid" onClick={() => setState({ grid: !grid })}><Grid3x3 size={15} /></button>
      <button className="tb-btn" title="Top view" onClick={() => requestView("top")}><Square size={13} /></button>
      <button className="tb-btn" title="Isometric view" onClick={() => requestView("iso")}><Box size={15} /></button>
    </div>
  );
}
