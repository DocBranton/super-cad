// Promise-based client for the geometry worker.
import GeometryWorker from "./worker.js?worker";

export type FeatureState = { state: "ok" | "error" | "skipped" | "suppressed" | "rolled-back"; ms?: number; message?: string; note?: string };

export type BodyMesh = {
  id: string;
  name: string;
  empty?: boolean;
  failed?: boolean;
  error?: string;
  color?: string;
  material?: string;
  visible?: boolean;
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  lines: Float32Array;
  volume: number;
  area: number;
  bounds: { min: number[]; max: number[]; centre: number[]; size: number[] };
  massGrams: number | null;
  faces: number;
  edgesCount: number;
};

export type RegenResult = {
  bodies: BodyMesh[];
  features: Record<string, FeatureState>;
  parameters: Record<string, number>;
  parameterErrors: Record<string, string>;
  ms: number;
};

export type Check = { id: string; label: string; status: "pass" | "fail" | "warn"; detail: string };
export type ValidationReport = { status: "validated" | "failed"; checks: Check[]; planHash: string; at: string; kernel: string };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (worker) return worker;
  worker = new GeometryWorker();
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "geometry worker crashed"));
    pending.clear();
    worker = null;
  };
  return worker;
}

function call<T>(type: string, args: object = {}): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    get().postMessage({ id, type, ...args });
  });
}

export const geometry = {
  init: () => call<{ ms: number; materials: string[]; fontErrors: Record<string, string> }>("init"),
  regenerate: (plan: unknown, rollback?: number) => call<RegenResult>("regenerate", { plan, rollback }),
  validate: () => call<ValidationReport>("validate"),
  importStep: (buffer: ArrayBuffer, name: string) => call<BodyMesh & { solidCount: number }>("importStep", { buffer, name }),
  cutImportedHole: (x: number, y: number, diameter: number) => call<BodyMesh & { solidCount: number; removedVolume: number }>("cutImportedHole", { x, y, diameter }),
  resetImported: () => call<BodyMesh & { solidCount: number }>("resetImported"),
  exportImportedStep: () => call<{ buffer: ArrayBuffer; bytes: number }>("exportImportedStep"),
  export: (format: "step" | "stl", bodyIds?: string[]) => call<{ buffer: ArrayBuffer; bytes: number }>("export", { format, bodyIds }),
};
