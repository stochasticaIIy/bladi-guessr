import GameShell from "@/components/game-shell";
import { locationCount } from "@/lib/locations";
import { panoramaCount } from "@/lib/panoramas";

export default function Home() {
  return <GameShell panoramaCount={panoramaCount} photoCount={locationCount} />;
}
