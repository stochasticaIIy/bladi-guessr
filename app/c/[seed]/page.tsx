import type { Metadata } from "next";
import { notFound } from "next/navigation";
import GameShell from "@/components/game-shell";
import { normaliseSeed } from "@/lib/challenge";
import { DEFAULT_MODE, isGameMode, type GameMode } from "@/lib/modes";
import { locationCount } from "@/lib/locations";
import { panoramaCount } from "@/lib/panoramas";

/**
 * The seed is runtime data (it comes from the URL), and the shell renders a
 * complete screen rather than streaming into it, so this page is allowed to
 * block the prerender. There is nothing static to pre-generate: every link is
 * a different challenge.
 */
export const instant = false;

type ChallengePageProps = {
  params: Promise<{ seed: string }>;
  searchParams: Promise<{ m?: string | string[] }>;
};

function challengeMode(value: string | string[] | undefined): GameMode {
  return isGameMode(value) ? value : DEFAULT_MODE;
}

export async function generateMetadata({ params }: ChallengePageProps): Promise<Metadata> {
  const { seed } = await params;
  return {
    title: normaliseSeed(seed) ? "تحدي — بلادي گيسر" : "بلادي گيسر",
  };
}

/**
 * A shared challenge: everyone who opens this link is dealt the same five
 * rounds, in the same mode (street by default, still photos with `?m=photos`),
 * so the scores on the challenge board are comparable.
 */
export default async function ChallengePage({ params, searchParams }: ChallengePageProps) {
  const [{ seed }, query] = await Promise.all([params, searchParams]);
  const challenge = normaliseSeed(seed);
  if (!challenge) notFound();

  const mode = challengeMode(query.m);

  return (
    <GameShell
      panoramaCount={panoramaCount}
      photoCount={locationCount}
      challenge={challenge}
      mode={mode}
    />
  );
}
