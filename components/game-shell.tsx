"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { challengePath, newSeed } from "@/lib/challenge";
import type { PublicGame, PublicRound, RoundResult, Summary } from "@/lib/game";
import type { LatLng } from "@/lib/geo";
import { copy, formatKm, formatNumber, gradeFor, toArabicDigits } from "@/lib/darija";
import { MAPILLARY_TOKEN } from "@/lib/mapillary";
import { DEFAULT_MODE, type GameMode } from "@/lib/modes";
import ChallengeShare from "./challenge-share";
import LeaderboardPanel from "./leaderboard";
import MapPanel from "./map-panel";
import PanoramaPanel from "./panorama-panel";
import PhotoPanel from "./photo-panel";

type Phase = "idle" | "playing" | "revealed" | "finished" | "error";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

export default function GameShell({
  panoramaCount,
  photoCount,
  challenge = null,
  mode: initialMode = DEFAULT_MODE,
}: {
  panoramaCount: number;
  photoCount: number;
  /** Seed from a `/c/<seed>` link: every player is dealt the same five rounds. */
  challenge?: string | null;
  /** Mode of a challenge link, or the mode a normal game starts on. */
  mode?: GameMode;
}) {
  // Start on the intro screen rather than a spinner: it is the common case and
  // it renders instantly on a slow connection while we look for a saved game.
  const hasToken = MAPILLARY_TOKEN.length > 0;
  // A data-saver on a slow connection can still play photos without a
  // Mapillary token; only street mode needs one. Without a token the intro
  // starts on photos rather than on a mode that cannot load.
  const streetAvailable = hasToken;
  const [mode, setMode] = useState<GameMode>(
    !hasToken && !challenge ? "photos" : initialMode,
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [checking, setChecking] = useState(true);
  const [game, setGame] = useState<PublicGame | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [guess, setGuess] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [imageryFailed, setImageryFailed] = useState(false);
  // Consecutive failures across swaps: one broken capture is normal, a run of
  // them means Mapillary itself is unreachable and swapping will not help.
  const [imageryFailures, setImageryFailures] = useState(0);

  // Resume an in-flight game so a refresh never costs a round. A challenge link
  // only resumes its own game: an unrelated saved game must not quietly replace
  // the rounds the link promises — and a photo link must not resume a street
  // game that happens to share its seed.
  useEffect(() => {
    let cancelled = false;
    api<PublicGame>("/api/game")
      .then((state) => {
        if (cancelled) return;
        if (challenge && (state.challenge !== challenge || state.mode !== initialMode)) return;
        if (state.active && state.finished) {
          setGame(state);
          setMode(state.mode);
          setPhase("finished");
        } else if (state.active && (state.imageId || state.photo)) {
          setGame(state);
          setMode(state.mode);
          setPhase("playing");
        }
      })
      .catch(() => {
        // No saved game (or the request failed): the intro screen still works.
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [challenge, initialMode]);

  const start = useCallback(async () => {
    setBusy(true);
    setGuess(null);
    setImageryFailed(false);
    setImageryFailures(0);
    try {
      const state = await api<PublicGame>("/api/game", {
        method: "POST",
        body: JSON.stringify(
          challenge ? { challenge, mode: initialMode } : { mode },
        ),
      });
      // The summary is cleared in the same batch as the new game. Clearing it
      // earlier would leave `phase` on "finished" with no summary, which falls
      // through to the playing screen and mounts the viewer on the previous
      // round's panorama.
      setResult(null);
      setGame(state);
      setMode(state.mode);
      setPhase("playing");
    } catch {
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [challenge, initialMode, mode]);

  const confirm = useCallback(async () => {
    if (!guess || busy) return;
    setBusy(true);
    try {
      const round = await api<RoundResult>("/api/game/guess", {
        method: "POST",
        body: JSON.stringify(guess),
      });
      setResult(round);
      setPhase("revealed");
    } catch {
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, [guess, busy]);

  const advance = useCallback(() => {
    if (!result) return;
    if (!result.nextRound) {
      setPhase("finished");
      return;
    }
    const next = result.nextRound;
    // Every field the panel renders comes from the next round: leaving `photo`
    // (or `credit`) on the old value would keep the previous photo on screen
    // for the rest of a photo game.
    setGame((current) =>
      current
        ? {
            ...current,
            score: result.totalScore,
            roundIndex: next.index,
            imageId: next.imageId,
            photo: next.photo,
            credit: next.credit,
          }
        : current,
    );
    setGuess(null);
    setResult(null);
    setImageryFailed(false);
    setImageryFailures(0);
    setPhase("playing");
  }, [result]);

  /** Mapillary occasionally loses a capture: swap it instead of stalling. */
  const swapPanorama = useCallback(async () => {
    setBusy(true);
    try {
      const round = await api<PublicRound>("/api/game/swap", { method: "POST" });
      setGame((current) =>
        current
          ? { ...current, imageId: round.imageId, photo: round.photo, credit: round.credit }
          : current,
      );
      setImageryFailed(false);
    } catch {
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }, []);

  // Stable identity: the viewer stores this callback when it mounts.
  const handleImageryError = useCallback(() => {
    setImageryFailed(true);
    setImageryFailures((count) => count + 1);
  }, []);

  const roundIndex = result?.roundIndex ?? game?.roundIndex ?? 0;
  const totalRounds = game?.totalRounds ?? 0;
  const score = result?.totalScore ?? game?.score ?? 0;

  // Street challenges cannot be played without Mapillary; photo challenges and
  // the intro are not blocked on it.
  if (!hasToken && challenge && initialMode === "street") {
    return (
      <Shell>
        <div className="w-full max-w-xl rounded-[2rem] border border-edge/70 bg-surface/90 p-8 shadow-2xl backdrop-blur sm:p-10">
          <h1 className="mb-3 text-3xl font-black">{copy.appName}</h1>
          <p className="mb-4 leading-8 text-sand/75">{copy.noToken}</p>
          <ol className="space-y-2 rounded-xl bg-ink/60 p-4 text-sm text-sand/60" dir="ltr">
            <li>1. https://www.mapillary.com/dashboard/developers</li>
            <li>2. Register application → copy the client token</li>
            <li>
              3. <code>NEXT_PUBLIC_MAPILLARY_TOKEN=MLY|…</code>
            </li>
          </ol>
        </div>
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <div className="text-center">
          <p className="mb-6 text-lg">{copy.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full bg-terracotta px-8 py-3 font-semibold text-ink"
          >
            {copy.playAgain}
          </button>
        </div>
      </Shell>
    );
  }

  if (phase === "idle") {
    return (
      <Shell>
        <div className="my-auto flex w-full max-w-xl flex-col gap-4">
          <div className="relative overflow-hidden rounded-[2rem] border border-edge/70 bg-surface/90 p-8 shadow-2xl backdrop-blur sm:p-12">
            <div className="pointer-events-none absolute -end-16 -top-20 h-56 w-56 rounded-full bg-terracotta/20 blur-3xl" />
            <div className="pointer-events-none absolute -start-20 -bottom-24 h-64 w-64 rounded-full bg-mint/15 blur-3xl" />
            <div className="relative">
              {challenge ? null : (
                <div
                  role="group"
                  aria-label={copy.modeLabel}
                  className="mb-5 grid grid-cols-2 gap-1.5 rounded-2xl border border-edge/80 bg-ink/40 p-1.5"
                >
                  <button
                    type="button"
                    onClick={() => setMode("street")}
                    aria-pressed={mode === "street"}
                    disabled={!streetAvailable}
                    className={`rounded-xl px-3 py-2.5 text-center transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      mode === "street"
                        ? "bg-terracotta text-ink"
                        : "text-sand/70 hover:text-sand"
                    }`}
                  >
                    <span className="block text-sm font-bold">{copy.modeStreet}</span>
                    <span className="mt-0.5 block text-[10px] opacity-80">
                      {streetAvailable
                        ? `${toArabicDigits(panoramaCount)} ${copy.modeStreetPlaces}`
                        : copy.modeStreetOffline}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("photos")}
                    aria-pressed={mode === "photos"}
                    className={`rounded-xl px-3 py-2.5 text-center transition ${
                      mode === "photos"
                        ? "bg-terracotta text-ink"
                        : "text-sand/70 hover:text-sand"
                    }`}
                  >
                    <span className="block text-sm font-bold">{copy.modePhotos}</span>
                    <span className="mt-0.5 block text-[10px] opacity-80">
                      {toArabicDigits(photoCount)} {copy.modePhotoPlaces}
                    </span>
                  </button>
                </div>
              )}

              <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-edge/80 px-3 py-1 text-xs text-sand/60">
                <span
                  className={`h-2 w-2 rounded-full ${
                    challenge || mode === "photos" ? "bg-terracotta" : "bg-mint"
                  }`}
                />
                {challenge
                  ? initialMode === "photos"
                    ? copy.challengePhotos
                    : copy.challengeStreet
                  : mode === "photos"
                    ? `${toArabicDigits(photoCount)} ${copy.modePhotoPlaces} من المغرب`
                    : `${toArabicDigits(panoramaCount)} بلاصة من الشمال للجنوب`}
              </span>
              <h1 className="mb-3 text-5xl font-black tracking-tight sm:text-6xl">{copy.appName}</h1>
              <p className="mb-6 text-xl text-terracotta">
                {challenge ? copy.challengeIntroTitle : copy.tagline}
              </p>
              <p className="mb-8 leading-8 text-sand/75">
                {challenge
                  ? initialMode === "photos"
                    ? copy.challengeIntroPhotos
                    : copy.challengeIntro
                  : mode === "photos"
                    ? copy.photoIntro
                    : copy.intro}
              </p>
              <button
                onClick={start}
                disabled={busy || checking}
                className="w-full rounded-2xl bg-terracotta px-8 py-4 text-lg font-bold text-ink transition hover:brightness-110 disabled:opacity-60 sm:w-auto"
              >
                {busy ? copy.changing : challenge ? copy.challengeStart : copy.start}
              </button>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="text-sm text-sand/45" aria-live="polite">
                  {checking
                    ? copy.loading
                    : challenge
                      ? copy.challengeStartHint
                      : mode === "photos"
                        ? copy.photoStartHint
                        : copy.startHint}
                </p>
                {challenge ? null : (
                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = challengePath(newSeed(), mode);
                    }}
                    className="text-sm text-sand/55 underline underline-offset-4 transition hover:text-sand"
                  >
                    {copy.createChallenge}
                  </button>
                )}
              </div>

              {challenge ? (
                <div className="mt-6 rounded-xl border border-edge/80 bg-ink/40 p-3">
                  <p className="mb-1 text-xs text-sand/50">{copy.challengeInviteHint}</p>
                  <ChallengeShare seed={challenge} mode={initialMode} />
                </div>
              ) : null}
            </div>
          </div>
          <LeaderboardPanel challenge={challenge} challengeMode={initialMode} />
        </div>
      </Shell>
    );
  }

  if (phase === "finished" && (result?.summary ?? game?.summary)) {
    return (
      <SummaryScreen
        summary={(result?.summary ?? game?.summary) as Summary}
        onRestart={start}
        busy={busy}
        challenge={game?.challenge ?? null}
        mode={game?.mode ?? mode}
      />
    );
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-ink text-sand lg:flex-row">
      <section className="relative h-[52dvh] shrink-0 lg:h-full lg:flex-1">
        {game?.mode === "photos" && game.photo ? (
          <PhotoPanel
            photo={game.photo}
            credit={game.credit}
            failed={imageryFailed}
            onError={handleImageryError}
          />
        ) : game?.imageId ? (
          // Deliberately not keyed by round: the viewer is created once and
          // moved between panoramas, so each round does not pay for a new
          // WebGL context on a phone.
          <PanoramaPanel
            imageId={game.imageId}
            token={MAPILLARY_TOKEN}
            failed={imageryFailed}
            onError={handleImageryError}
          />
        ) : (
          <div className="h-full w-full bg-[#0f1513]" />
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/85 to-transparent" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-4">
          <span className="rounded-full bg-ink/70 px-3 py-1 text-sm">
            {copy.round} {toArabicDigits(roundIndex + 1)} {copy.of} {toArabicDigits(totalRounds)}
          </span>
          <span className="rounded-full bg-ink/70 px-3 py-1 text-sm">
            <span className="text-terracotta">{formatNumber(score)}</span> {copy.pointsSuffix}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-16 flex justify-center gap-2">
          {Array.from({ length: totalRounds }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 rounded-full transition-all ${
                index < roundIndex
                  ? "w-6 bg-mint"
                  : index === roundIndex
                    ? "w-10 bg-terracotta"
                    : "w-6 bg-sand/25"
              }`}
            />
          ))}
        </div>

        {phase === "revealed" && result ? (
          <RevealCard result={result} onNext={advance} />
        ) : imageryFailed ? (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink/95 to-transparent p-4 pb-5">
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-edge/70 bg-ink/90 p-4 text-center">
              <p className="text-sm text-sand/75">
                {imageryFailures >= 2
                  ? copy.imageryDown
                  : game?.mode === "photos"
                    ? copy.photoError
                    : copy.viewerError}
              </p>
              {imageryFailures >= 2 ? (
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-xl bg-mint px-5 py-3 text-sm font-bold text-ink transition hover:brightness-110"
                >
                  {copy.retry}
                </button>
              ) : (
                <button
                  onClick={swapPanorama}
                  disabled={busy}
                  className="rounded-xl bg-terracotta px-5 py-3 text-sm font-bold text-ink transition hover:brightness-110 disabled:opacity-60"
                >
                  {busy ? copy.swapping : copy.swap}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-ink/90 to-transparent p-4 pb-5 text-center">
            <p className="text-sm text-sand/70">
              {game?.mode === "photos" ? copy.photoHint : copy.navHint}
            </p>
          </div>
        )}
      </section>

      {/* `isolate` keeps Leaflet's internal z-indexes (400+) from painting over
          the controls that sit on top of the map. */}
      <section className="relative isolate min-h-0 flex-1 border-t border-edge/60 lg:h-full lg:w-[42%] lg:flex-none lg:border-s lg:border-t-0">
        <MapPanel
          guess={guess}
          answer={phase === "revealed" && result ? result.answer : null}
          onPick={phase === "playing" ? setGuess : undefined}
          onTilesFailing={() => setTilesFailing(true)}
        />

        {tilesFailing ? (
          <p className="pointer-events-none absolute inset-x-3 top-3 z-10 rounded-xl bg-ink/85 px-3 py-2 text-center text-xs text-sand/70">
            {copy.tilesFailed}
          </p>
        ) : null}

        {phase === "playing" ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 pb-4">
            <div className="pointer-events-auto mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-edge/70 bg-ink/85 p-2 backdrop-blur">
              <p className="flex-1 ps-3 text-xs text-sand/55">
                {guess ? copy.mapHintSet : copy.mapHint}
              </p>
              <button
                onClick={confirm}
                disabled={!guess || busy}
                className="rounded-xl bg-terracotta px-5 py-3 text-sm font-bold text-ink transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-edge disabled:text-sand/40"
              >
                {busy ? copy.changing : copy.confirm}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-y-auto bg-ink px-4 py-10 text-sand">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, #43c08d 0, transparent 45%), radial-gradient(circle at 70% 80%, #e4704b 0, transparent 40%)",
        }}
      />
      {children}
    </main>
  );
}

function RevealCard({ result, onNext }: { result: RoundResult; onNext: () => void }) {
  const perfect = result.score === 5000;
  const { answer } = result;
  return (
    // Above Mapillary's navigation arrows (z-index 5): an arrow must never sit
    // on top of the "next round" or "swap" button on a small screen.
    <div className="absolute inset-x-0 bottom-0 z-10">
      <div className="mx-auto w-full max-w-xl p-3">
        <div
          data-reveal
          className="rounded-2xl border border-edge/80 bg-ink/92 p-4 shadow-xl backdrop-blur-md"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-sand/50">{copy.correctPlace}</p>
              <p className="text-xl font-bold">{answer.city}</p>
              <p className="text-xs text-sand/50">{answer.region}</p>
            </div>
            <div className="text-end">
              <p className={`text-2xl font-black ${perfect ? "text-mint" : "text-terracotta"}`}>
                {formatNumber(result.score)}
              </p>
              <p className="text-xs text-sand/50">{copy.pointsSuffix}</p>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-sand/70">
            <span>
              {copy.distance}: <strong className="text-sand">{formatKm(result.distanceKm)}</strong>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <a
              href={answer.credit.url}
              target="_blank"
              rel="noreferrer noopener"
              className="max-w-[55%] truncate text-[11px] text-sand/35 underline-offset-2 hover:text-sand/60 hover:underline"
            >
              {copy.imageCredit}: {answer.credit.label} · {answer.credit.licence}
            </a>
            <button
              onClick={onNext}
              className="rounded-xl bg-mint px-5 py-3 text-sm font-bold text-ink transition hover:brightness-110"
            >
              {result.finished ? copy.seeResult : copy.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryScreen({
  summary,
  onRestart,
  busy,
  challenge,
  mode,
}: {
  summary: Summary;
  onRestart: () => void;
  busy: boolean;
  challenge: string | null;
  mode: GameMode;
}) {
  const grade = useMemo(() => gradeFor(summary.totalScore, summary.maxTotal), [summary]);
  return (
    <main className="min-h-dvh overflow-y-auto bg-ink px-4 py-10 text-sand">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-sm text-sand/50">
          {copy.finalScore} · {mode === "photos" ? copy.modePhotos : copy.modeStreet}
        </p>
        <h1 className="mb-1 text-6xl font-black tracking-tight">
          {formatNumber(summary.totalScore)}
          <span className="ms-2 text-2xl font-medium text-sand/40">
            {copy.outOf} {formatNumber(summary.maxTotal)}
          </span>
        </h1>
        <p className="mt-4 text-2xl font-bold text-terracotta">{grade.title}</p>
        <p className="mb-8 text-sand/70">{grade.note}</p>

        <h2 className="mb-3 text-sm text-sand/50">{copy.rounds}</h2>
        <ul className="mb-8 divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge/70 bg-surface/70">
          {summary.rounds.map((round, index) => (
            <li key={`${round.city}-${index}`} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {toArabicDigits(index + 1)}. {round.city}
                </p>
                <p className="text-xs text-sand/45">
                  {round.region} · {copy.distance} {formatKm(round.distanceKm)}
                </p>
              </div>
              <span className="shrink-0 font-bold text-mint">{formatNumber(round.score)}</span>
            </li>
          ))}
        </ul>

        {challenge ? (
          <div className="mb-4 rounded-2xl border border-terracotta/40 bg-terracotta/10 p-4">
            <p className="text-sm font-bold text-terracotta">{copy.challengeBadge}</p>
            <p className="mt-1 text-xs leading-6 text-sand/65">{copy.challengeSummary}</p>
            <ChallengeShare seed={challenge} mode={mode} />
          </div>
        ) : null}

        <div className="mb-6">
          <LeaderboardPanel submit challenge={challenge} challengeMode={mode} />
        </div>

        <button
          onClick={onRestart}
          disabled={busy}
          className="w-full rounded-2xl bg-terracotta px-8 py-4 text-lg font-bold text-ink transition hover:brightness-110 disabled:opacity-60"
        >
          {busy ? copy.changing : copy.playAgain}
        </button>
      </div>
    </main>
  );
}
