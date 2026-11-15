"use client";

import dynamic from "next/dynamic";
import { copy } from "@/lib/darija";
import type { PanoramaViewerProps } from "./panorama-viewer";

/**
 * MapillaryJS creates a WebGL context at import time, so it is client-only.
 * The placeholder keeps the panel height stable while the bundle arrives.
 */
const PanoramaViewer = dynamic(() => import("./panorama-viewer"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#0f1513] text-sm text-sand/40">
      {copy.viewerLoading}
    </div>
  ),
});

export default function PanoramaPanel(props: PanoramaViewerProps) {
  return <PanoramaViewer {...props} />;
}
