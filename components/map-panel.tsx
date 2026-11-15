"use client";

import dynamic from "next/dynamic";
import type { GameMapProps } from "./game-map";

/**
 * Leaflet touches `window` at import time, so the map is loaded on the client
 * only. The placeholder keeps the panel height stable while the bundle loads.
 */
const GameMap = dynamic(() => import("./game-map"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#0f1513] text-sm text-sand/40">
      …
    </div>
  ),
});

export default function MapPanel(props: GameMapProps) {
  return <GameMap {...props} />;
}
