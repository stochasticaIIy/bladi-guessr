"use client";

import Image from "next/image";
import { useState } from "react";
import { copy } from "@/lib/darija";
import type { PublicRoundCredit } from "@/lib/game";

export type PhotoPanelProps = {
  photo: string;
  /** Author + licence, shown while the photo is on screen (CC requires it). */
  credit: PublicRoundCredit | null;
  /** Set by the parent when this round has already failed; hides the spinner. */
  failed?: boolean;
  onError?: () => void;
};

/**
 * Still-photo round.
 *
 * The photo fills the panel with `object-contain`: cropping a landscape shot on
 * a phone would hide exactly the clues the player is meant to use.
 */
export default function PhotoPanel({ photo, credit, failed = false, onError }: PhotoPanelProps) {
  // Comparing against the current src avoids an effect: a new round simply is
  // not "loaded" yet, so the spinner returns without a cascading render.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [errored, setErrored] = useState<string | null>(null);
  const ready = loaded === photo;
  const broken = errored === photo;

  return (
    <div
      className="relative flex h-full w-full items-center justify-center bg-[#0b0f0e]"
      data-photo-id={photo}
    >
      <Image
        src={photo}
        alt=""
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 58vw"
        className="object-contain"
        draggable={false}
        onLoad={() => setLoaded(photo)}
        onError={() => {
          setErrored(photo);
          onError?.();
        }}
      />

      {!ready && !failed && !broken ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0b0f0e]">
          <div className="flex flex-col items-center gap-3">
            <span className="h-9 w-9 animate-spin rounded-full border-2 border-sand/20 border-t-terracotta" />
            <span className="text-xs text-sand/45">{copy.photoLoading}</span>
          </div>
        </div>
      ) : null}

      {ready && credit ? (
        <p className="pointer-events-none absolute bottom-1 start-2 z-20 max-w-[70%] truncate rounded bg-ink/60 px-1.5 py-0.5 text-[10px] text-sand/45">
          {copy.imageCredit}: {credit.label} · {credit.licence}
        </p>
      ) : null}
    </div>
  );
}
