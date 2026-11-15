"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/geo";

export type GameMapProps = {
  guess: LatLng | null;
  answer?: LatLng | null;
  onPick?: (value: LatLng) => void;
  onTilesFailing?: () => void;
};

const MOROCCO_CENTER: [number, number] = [31.4, -7.0];
const GUESS_COLOR = "#e4704b";
const ANSWER_COLOR = "#43c08d";

/**
 * Two tile sources. CARTO is faster and looks better; OpenStreetMap is the
 * fallback when a network blocks or throttles the first one. Both are free
 * and do not need a key, which keeps the game playable on any connection.
 */
const TILE_SOURCES = {
  carto: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
  },
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    subdomains: "abc",
  },
} as const;

type Tier = keyof typeof TILE_SOURCES | "dead";

function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "bladi-pin",
    html: `<svg width="30" height="40" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 25 15 25s15-14 15-25C30 6.7 23.3 0 15 0z" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
      <circle cx="15" cy="15" r="5.5" fill="#0b0f0e"/>
    </svg>`,
    iconSize: [30, 40],
    iconAnchor: [15, 38],
  });
}

function ClickHandler({ onPick }: { onPick: (value: LatLng) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** Zoom to the guess and the answer so both are visible after a round. */
function FitBoth({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
    // Not animated on purpose: Leaflet's zoom transition end handler fires
    // ~250 ms later, and the player can reach the summary screen (which
    // unmounts the map) before that. The handler then reads a detached pane
    // and throws. An instant fit is also kinder to a mid-range phone.
    map.fitBounds(bounds, { padding: [44, 44], maxZoom: 9, animate: false });
  }, [map, points]);
  return null;
}


export default function GameMap({ guess, answer, onPick, onTilesFailing }: GameMapProps) {
  const guessIcon = useMemo(() => pinIcon(GUESS_COLOR), []);
  const answerIcon = useMemo(() => pinIcon(ANSWER_COLOR), []);
  const both = useMemo(() => (guess && answer ? [guess, answer] : []), [guess, answer]);

  const [tier, setTier] = useState<Tier>("carto");
  // Mirrors `tier` synchronously so late tile events from a layer that has
  // already been replaced can be ignored.
  const tierRef = useRef<Tier>("carto");
  const failures = useRef(0);
  const loads = useRef(0);
  const reported = useRef(false);

  const escalate = useCallback(() => {
    const current = tierRef.current;
    const next: Tier = current === "carto" ? "osm" : current === "osm" ? "dead" : current;
    if (next === current) return;
    console.info(`[bladi] tile source ${current} -> ${next}`);
    tierRef.current = next;
    setTier(next);
  }, []);

  // A failed tile or two is normal; a burst means this source is unreachable.
  const tileHandlers = useMemo(
    () => ({
      tileerror: () => {
        if (tierRef.current !== tier) return; // a retired layer draining its queue
        failures.current += 1;
        if (failures.current < 4) return;
        failures.current = 0;
        escalate();
      },
      tileload: () => {
        if (tierRef.current !== tier) return;
        loads.current += 1;
      },
    }),
    [tier, escalate],
  );

  // Some networks do not fail tiles, they hang them. If nothing has rendered a
  // few seconds after mounting a source, move on to the next one.
  useEffect(() => {
    loads.current = 0;
    failures.current = 0;
    if (tier === "dead") {
      if (!reported.current) {
        reported.current = true;
        onTilesFailing?.();
      }
      return;
    }
    const timer = setTimeout(() => {
      if (loads.current === 0) escalate();
    }, 3500);
    return () => clearTimeout(timer);
  }, [tier, escalate, onTilesFailing]);

  return (
    <div data-tile-tier={tier} className="h-full w-full">
    <MapContainer
      center={MOROCCO_CENTER}
      zoom={5}
      minZoom={4}
      maxZoom={12}
      zoomControl={false}
      attributionControl
      preferCanvas
      // z-0 makes the map its own stacking context. Leaflet's panes use
      // z-index 400+, which would otherwise paint over the guess controls that
      // sit on top of the map once the canvas renderer exists.
      className="z-0 h-full w-full"
      style={{ height: "100%", width: "100%" }}
    >
      {tier !== "dead" ? (
        <TileLayer
          key={tier}
          url={TILE_SOURCES[tier].url}
          attribution={TILE_SOURCES[tier].attribution}
          subdomains={TILE_SOURCES[tier].subdomains}
          maxZoom={19}
          detectRetina
          eventHandlers={tileHandlers}
        />
      ) : null}
      {onPick ? <ClickHandler onPick={onPick} /> : null}

      {answer ? <Marker position={[answer.lat, answer.lng]} icon={answerIcon} /> : null}
      {guess ? <Marker position={[guess.lat, guess.lng]} icon={guessIcon} /> : null}
      {both.length === 2 ? (
        <Polyline
          positions={both.map((point) => [point.lat, point.lng] as [number, number])}
          pathOptions={{ color: "#efe6d6", weight: 2, dashArray: "6 8", opacity: 0.75 }}
        />
      ) : null}
      {both.length === 2 ? <FitBoth points={both} /> : null}
    </MapContainer>
    </div>
  );
}
