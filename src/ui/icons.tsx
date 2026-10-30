import {
  ArrowUpFromLine, Box, Boxes, CircleDot, Cylinder, Hexagon, PackageOpen, PenLine, Scissors, SquareRoundCorner, type LucideIcon,
} from "lucide-react";
import type { Feature } from "../state/store";

/** Ribbon/timeline glyph for each feature operation. */
export const OP_ICON: Record<Feature["op"] | "sketch" | "body", LucideIcon> = {
  extrude: ArrowUpFromLine,
  hole: CircleDot,
  fillet: SquareRoundCorner,
  chamfer: Hexagon,
  shell: PackageOpen,
  sketch: PenLine,
  body: Box,
};

export function featureIcon(f: Feature): LucideIcon {
  if (f.op === "extrude" && f.mode === "cut") return Scissors;
  if (f.op === "extrude" && f.mode === "new") return Box;
  if (f.op === "extrude" && f.profile?.type === "circle") return Cylinder;
  return OP_ICON[f.op] ?? Boxes;
}

export function AppMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path d="M16 3l11 6v14l-11 6-11-6V9z" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M5 9l11 6 11-6M16 15v14" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  );
}
