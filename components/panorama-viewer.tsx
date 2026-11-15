"use client";

import { useEffect, useRef, useState } from "react";
import { Viewer } from "mapillary-js";
import "mapillary-js/dist/mapillary.css";
import { copy } from "@/lib/darija";

export type PanoramaViewerProps = {
  imageId: string;
  /** Mapillary client token. Public by design; empty means it was never configured. */
  token: string;
  /** Set by the parent when this round has already failed; hides the spinner. */
  failed?: boolean;
  onError?: () => void;
};

/** Give up on a panorama that has not painted by then (mobile data is slow). */
export const LOAD_TIMEOUT_MS = 25_000;

const isCancellation = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  /cancel/i.test(String((error as { name?: string }).name ?? ""));

/**
 * Real street-level navigation, powered by MapillaryJS.
 *
 * Mapillary's own chrome is stripped down to what a guessing game needs:
 * drag to look around, arrows to walk down the street. The cover (which shows a
 * map of where you are), the compass and the tags are all off, because any of
 * them would hand the player the answer.
 */
export default function PanoramaViewer({
  imageId,
  token,
  failed = false,
  onError,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const currentImageRef = useRef<string | null>(null);
  const loadedRef = useRef(false);
  const [loading, setLoading] = useState(true);

  // Which panorama Mapillary actually put on screen. Cheap to record on the DOM
  // and the only reliable check that a round change moved the right image.
  const markLoaded = (id: string | undefined) => {
    if (id && containerRef.current) containerRef.current.dataset.loadedId = id;
  };

  useEffect(() => {
    if (!token) {
      onError?.();
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let viewer: Viewer | null = null;

    try {
      viewer = new Viewer({
        accessToken: token,
        container,
        imageId,
        combinedPanning: true,
        component: {
          // The cover renders a mini map with the location on it: never show it.
          cover: false,
          // A compass would give away which way is north.
          bearing: false,
          attribution: true,
          direction: true,
          sequence: true,
          keyboard: true,
          pointer: true,
          zoom: true,
          tag: false,
          cache: true,
        },
      });
      viewerRef.current = viewer;
      currentImageRef.current = imageId;
    } catch {
      onError?.();
      return;
    }

    viewer.on("image", () => {
      if (disposed) return;
      loadedRef.current = true;
      setLoading(false);
      viewer
        ?.getImage()
        .then((image) => markLoaded(image.id), () => undefined);
    });

    // A panorama that hangs never fires an error, so watch the clock instead.
    // This only reports while the image is still not on screen.
    const timer = window.setTimeout(() => {
      if (!disposed && !loadedRef.current) onError?.();
    }, LOAD_TIMEOUT_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      viewerRef.current = null;
      currentImageRef.current = null;
      viewer?.remove();
    };
    // The viewer is created once per mount; round changes move it (see below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Rounds move the same WebGL context instead of tearing it down, so exploring
  // stays instant and the browser never has to spin up a second 3D context.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (currentImageRef.current === imageId) return;

    currentImageRef.current = imageId;
    loadedRef.current = false;
    setLoading(true);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled && !loadedRef.current) onError?.();
    }, LOAD_TIMEOUT_MS);

    viewer.moveTo(imageId).then(
      () => {
        if (cancelled) return;
        loadedRef.current = true;
        setLoading(false);
        markLoaded(imageId);
      },
      (error: unknown) => {
        // A move superseded by another move is not a broken panorama.
        if (cancelled || isCancellation(error)) return;
        onError?.();
      },
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageId]);

  return (
    <div className="relative h-full w-full bg-[#0f1513]" dir="ltr" data-panorama-id={imageId}>
      {/* MapillaryJS gives this element `position: relative`, which would cancel
          `inset-0` stretching. An explicit full height is what actually sizes it. */}
      <div ref={containerRef} className="h-full w-full" />

      {loading && !failed ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0f1513]">
          <div className="flex flex-col items-center gap-3">
            <span className="h-9 w-9 animate-spin rounded-full border-2 border-sand/20 border-t-terracotta" />
            <span className="text-xs text-sand/45">{copy.viewerLoading}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
