"use client";

import { useState } from "react";
import { challengePath } from "@/lib/challenge";
import { copy } from "@/lib/darija";
import { DEFAULT_MODE, type GameMode } from "@/lib/modes";

type Status = "idle" | "copied" | "failed";

/**
 * Shares a challenge link.
 *
 * Uses the native share sheet on phones (where WhatsApp is one tap away) and
 * the clipboard everywhere else. When neither is available — old browser, or a
 * page served over plain HTTP — the link is shown so it can still be copied by
 * hand rather than silently failing.
 */
export default function ChallengeShare({
  seed,
  mode = DEFAULT_MODE,
}: {
  seed: string;
  /** Photo challenges carry their mode in the link, so the deal matches. */
  mode?: GameMode;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [link, setLink] = useState<string | null>(null);

  const share = async () => {
    const url = `${window.location.origin}${challengePath(seed, mode)}`;
    setLink(url);
    try {
      if (navigator.share) {
        await navigator.share({
          title: copy.appName,
          text: copy.challengeShareText,
          url,
        });
        setStatus("copied");
        return;
      }
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch (error) {
      // Closing the native share sheet is a choice, not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus("failed");
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={share}
        className="w-full rounded-xl bg-terracotta px-4 py-2.5 text-sm font-bold text-ink transition hover:brightness-110 sm:w-auto"
      >
        {status === "copied" ? copy.challengeCopied : copy.challengeShare}
      </button>

      {status === "failed" && link ? (
        <div className="mt-2 text-xs text-sand/50">
          {copy.challengeShareFailed}
          <code
            dir="ltr"
            className="mt-1 block select-all break-all rounded-lg bg-ink/70 px-2 py-1.5 text-[11px] text-mint"
          >
            {link}
          </code>
        </div>
      ) : null}
    </div>
  );
}
