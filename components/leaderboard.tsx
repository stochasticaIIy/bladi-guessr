"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { copy, formatNumber, toArabicDigits } from "@/lib/darija";
import { MAX_NAME_LENGTH } from "@/lib/leaderboard";
import { DEFAULT_MODE, type GameMode } from "@/lib/modes";

export type LeaderboardEntry = {
  rank: number;
  name: string;
  score: number;
  max: number;
  rounds: number;
  at: number;
  you: boolean;
};

type View = {
  configured: boolean;
  available: boolean;
  entries: LeaderboardEntry[];
  you: LeaderboardEntry | null;
  total: number;
};

const NAME_KEY = "bladi_name";
const ROWS_ON_INTRO = 5;

type Status = "idle" | "submitting" | "saved" | "slow" | "failed";

async function fetchBoard(challenge: string | null, mode: GameMode): Promise<View> {
  const query = challenge
    ? `?c=${encodeURIComponent(challenge)}&m=${mode}`
    : "";
  const response = await fetch(`/api/leaderboard${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as View;
}

/**
 * Shared leaderboard.
 *
 * On the intro screen it is a short "who is on top" teaser; on the final screen
 * it also takes a name and submits the finished game. The browser sends the
 * name only — the server recomputes the score from the signed game cookie, so
 * nothing here can fake a result.
 *
 * With a `challenge` seed it shows that link's board instead of the global one,
 * because scores are only comparable between players who saw the same rounds.
 */
export default function LeaderboardPanel({
  submit = false,
  challenge = null,
  challengeMode = DEFAULT_MODE,
}: {
  submit?: boolean;
  challenge?: string | null;
  challengeMode?: GameMode;
}) {
  const [view, setView] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    let cancelled = false;
    fetchBoard(challenge, challengeMode)
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [challenge, challengeMode]);

  const send = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed || status === "submitting") return;

      setStatus("submitting");
      try {
        const response = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (response.status === 429) {
          setStatus("slow");
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        setView((await response.json()) as View);
        setStatus("saved");
        try {
          window.localStorage.setItem(NAME_KEY, trimmed);
        } catch {
          // Not being able to remember the name is not a reason to fail the save.
        }
      } catch {
        setStatus("failed");
      }
    },
    [name, status],
  );

  // Never set up (no JSONBin key): the game stays a solo game, with no empty box.
  if (!view && !failed) {
    return (
      <section className="rounded-2xl border border-edge/70 bg-surface/70 p-4">
        <p className="text-xs text-sand/40">{copy.leaderboardLoading}</p>
      </section>
    );
  }
  if (view && !view.configured) return null;

  const available = Boolean(view?.available);
  const entries = submit ? (view?.entries ?? []) : (view?.entries ?? []).slice(0, ROWS_ON_INTRO);
  const own = view?.you ?? null;
  const ownInList = entries.some((entry) => entry.you);
  const savedRank = status === "saved" && own ? own.rank : null;

  return (
    <section className="rounded-2xl border border-edge/70 bg-surface/70 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-sand/70">
          {challenge ? copy.challengeBoard : copy.leaderboard}
        </h2>
        {available && view ? (
          <span className="text-[11px] text-sand/35">
            {toArabicDigits(view.total)} {copy.leaderboardPlayers}
          </span>
        ) : null}
      </div>

      {!available ? (
        <p className="text-xs text-sand/45">{copy.leaderboardDown}</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-sand/45">
          {challenge ? copy.challengeEmpty : copy.leaderboardEmpty}
        </p>
      ) : (
        <ol className="space-y-1">
          {entries.map((entry) => (
            <LeaderboardRow key={`${entry.rank}-${entry.at}`} entry={entry} />
          ))}
          {own && !ownInList ? (
            <>
              <li aria-hidden className="py-0.5 text-center text-xs text-sand/25">
                ⋯
              </li>
              <LeaderboardRow entry={own} />
            </>
          ) : null}
        </ol>
      )}

      {submit ? (
        <form onSubmit={send} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="leaderboard-name">
            {copy.nameLabel}
          </label>
          <input
            id="leaderboard-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (status !== "idle") setStatus("idle");
            }}
            // Restoring the name is deliberately user-triggered: reading
            // localStorage during render would not match the server HTML,
            // and setting it in an effect would cascade a render on every load.
            onFocus={() => {
              if (name) return;
              try {
                setName(window.localStorage.getItem(NAME_KEY) ?? "");
              } catch {
                // Private mode: the player just types their name again.
              }
            }}
            maxLength={MAX_NAME_LENGTH}
            dir="auto"
            autoComplete="nickname"
            placeholder={copy.namePlaceholder}
            className="min-w-0 flex-1 rounded-xl border border-edge/80 bg-ink/70 px-3 py-2.5 text-sm text-sand outline-none placeholder:text-sand/30 focus:border-mint/60"
          />
          <button
            type="submit"
            disabled={!name.trim() || status === "submitting"}
            className="rounded-xl bg-mint px-4 py-2.5 text-sm font-bold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-edge disabled:text-sand/40"
          >
            {status === "submitting" ? copy.submitting : copy.submitScore}
          </button>
        </form>
      ) : null}

      <p className="mt-2 min-h-4 text-xs" aria-live="polite">
        {savedRank !== null ? (
          <span className="text-mint">
            {copy.scoreSaved} {toArabicDigits(savedRank)}
          </span>
        ) : status === "slow" ? (
          <span className="text-terracotta">{copy.leaderboardSlow}</span>
        ) : status === "failed" ? (
          <span className="text-terracotta">{copy.leaderboardDown}</span>
        ) : null}
      </p>
    </section>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <li
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
        entry.you ? "bg-mint/10 text-sand" : "text-sand/75"
      }`}
    >
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-sand/35">
        {toArabicDigits(entry.rank)}
      </span>
      <span className="min-w-0 flex-1 truncate" dir="auto">
        {entry.name}
      </span>
      {entry.you ? (
        <span className="shrink-0 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] text-mint">
          {copy.leaderboardYou}
        </span>
      ) : null}
      <span className="shrink-0 font-bold tabular-nums text-mint">
        {formatNumber(entry.score)}
      </span>
    </li>
  );
}
