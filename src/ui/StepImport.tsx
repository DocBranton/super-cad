import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { geometry, type BodyMesh } from "../engine/client";

function StepCanvas({ data }: { data: BodyMesh }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#19232f");
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xeef5ff, 0x324050, 2));
    const directional = new THREE.DirectionalLight(0xffffff, 2.2);
    directional.position.set(1, -2, 3);
    scene.add(directional);
    const group = new THREE.Group();
    scene.add(group);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(data.vertices, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.triangles, 1));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xa8bccf, metalness: .24, roughness: .6, side: THREE.DoubleSide }));
    group.add(mesh);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute("position", new THREE.BufferAttribute(data.lines, 3));
    const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x263441, transparent: true, opacity: .7 }));
    group.add(edges);
    const bounds = new THREE.Box3().setFromObject(mesh);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
    camera.position.copy(center).add(new THREE.Vector3(1.25, -1.4, 1).normalize().multiplyScalar(radius * 3.2));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.update();
    const resize = () => {
      const width = Math.max(1, el.clientWidth), height = Math.max(1, el.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let active = true, frame = 0;
    const render = () => { if (!active) return; frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); };
    render();
    return () => { active = false; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); geo.dispose(); edgeGeo.dispose(); (mesh.material as THREE.Material).dispose(); (edges.material as THREE.Material).dispose(); renderer.dispose(); renderer.domElement.remove(); };
  }, [data]);
  return <div ref={host} style={{ flex: 1, minHeight: 320, width: "100%" }} role="img" aria-label={`Imported STEP solid: ${data.name}`} />;
}

export function StepImport({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<(BodyMesh & { solidCount: number }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  async function open(file?: File) {
    if (!file) return;
    setError("");
    if (!/\.(step|stp)$/i.test(file.name)) return setError("Select a .step or .stp CAD file.");
    if (file.size > 32 * 1024 * 1024 || file.size < 50) return setError("STEP file must be between 50 bytes and 32 MB.");
    setLoading(true);
    try { const result = await geometry.importStep(await file.arrayBuffer(), file.name); setData(result); setName(file.name); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function exportStep() {
    if (!data) return;
    setLoading(true);
    try {
      const result = await geometry.exportImportedStep();
      const url = URL.createObjectURL(new Blob([result.buffer], { type: "application/step" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = name.replace(/\.(step|stp)$/i, "") + "-roundtrip.step";
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1200);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  return <div role="dialog" aria-modal="true" aria-label="STEP model import" style={{ position: "absolute", inset: 12, zIndex: 40, background: "#151d27", border: "1px solid #526275", borderRadius: 9, display: "flex", flexDirection: "column", color: "#edf3fa", overflow: "hidden", boxShadow: "0 12px 40px #0008" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 15, padding: "12px 17px", background: "#253344" }}>
      <strong>SUPER CAD / STEP IMPORT</strong>
      <span style={{ opacity: .65, fontSize: 12 }}>True Open CASCADE B-Rep inspection · local to browser</span>
      <div style={{ flex: 1 }}/>
      <button className="btn" onClick={onClose}>Close</button>
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 15, padding: "12px 17px" }}>
      <label className="btn" style={{ cursor: "pointer" }}>Open STEP… <input aria-label="Choose STEP file" type="file" accept=".step,.stp" style={{ display: "none" }} onChange={e => { void open(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }}/></label>
      <button className="btn" disabled={!data || loading} onClick={() => void exportStep()}>Export STEP round-trip</button>
      <span style={{ fontSize: 12, opacity: .7 }}>{loading ? "Processing B-Rep…" : name || "No file selected"}</span>
    </div>
    {error && <div role="alert" style={{ padding: 10, color: "#ffc3ad" }}>{error}</div>}
    {data ? <><StepCanvas data={data}/><div style={{ display: "flex", flexWrap: "wrap", gap: 22, padding: "13px 17px", fontSize: 13, background: "#253344" }}>
      <span><b>{data.solidCount}</b> solids</span><span><b>{data.faces}</b> faces</span><span><b>{data.edgesCount}</b> edges</span>
      <span>Volume <b>{data.volume.toFixed(2)} mm³</b></span><span>Dimensions <b>{data.bounds.size.map(n => n.toFixed(2)).join(" × ")} mm</b></span>
    </div></> : <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#c2cede", textAlign: "center", padding: 20 }}><div><h3>Import an existing neutral CAD solid</h3><p>Select a STEP file to inspect its exact B-Rep geometry and export a round-trip file.</p><p style={{ opacity: .7 }}>Feature reconstruction and editing imported faces are the next milestone; these controls do not modify the active parametric project.</p></div></div>}
  </div>;
}
