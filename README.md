# بلادي گيسر · BladiGuessr

A GeoGuessr-style game for **Morocco only**, played entirely in Moroccan Darija
(Arabic script, RTL). Every round drops you somewhere in the country — either a
real 360° street capture you can walk down, or a still photograph of a place no
car has ever driven through — and asks you to place a pin where you think you
are.

```
npm install
cp .env.example .env.local     # add NEXT_PUBLIC_MAPILLARY_TOKEN (street mode only)
npm run dev                    # http://localhost:3000
```

## Two modes

| | شوارع · street | تصاور · photos |
| --- | --- | --- |
| What you see | Mapillary 360° capture | Wikimedia Commons photograph |
| What you can do | look around, walk with the arrows | look (no walking) |
| Pool | 155 panoramas, walkable ones first | 46 places across the country |
| Needs `NEXT_PUBLIC_MAPILLARY_TOKEN` | yes | **no** |
| Attribution | author · CC BY-SA 4.0 on reveal | author · licence on screen and on reveal |

The mode is chosen on the intro screen, travels into challenge links
(`/c/<seed>?m=photos`), and is stored in the signed game cookie, so a refresh
resumes the same mode. Scores, rounds and boards are otherwise identical, and
the two modes never share standings.

## How a round works

1. The server deals five rounds from `data/panoramas.json` (street: walkable
   ones first) or `data/locations.json` (photos), both pure server-side data.
2. The browser receives **an image id or a photo path only** — never the
   coordinates, the city or the region. Photo paths are hashed file names, so
   the URL does not spell the place out either.
3. The player looks around (and walks the street in street mode).
4. They place a pin; the server scores the great-circle distance and reveals
   the answer.

Points per round: `5000 · e^(−d / 260)` on kilometres, with a 1 km perfect
radius (see `lib/scoring.ts`).

Finished games can be posted to a shared leaderboard (JSONBin), one row per
browser holding that player's personal best. Send a friend a challenge link and
they get **the same five rounds** as you, in the same mode, with a board for
just that link. See [Shared leaderboard](#shared-leaderboard).

## Shared challenge links

`/c/<seed>` deals the same five rounds to everyone who opens it, so scores
are comparable between friends instead of across unrelated games.

- The link is a short, URL-safe seed (`/c/k3m9x2qa`; photo links add
  `?m=photos`). Dealing is a pure function of the seed and the mode
  (`lib/game.ts` → `challengeRoundIds`), so every server and every player gets
  the identical five rounds in the identical order, walkable ones first as
  usual.
- **Creating one:** the button under "بدا اللعب" on the intro generates a seed
  and opens its link. Sharing it is a normal URL — WhatsApp, Instagram, a
  screenshot of the QR, anything.
- **Playing one:** the landing page shows who is already on that link's board;
  the final screen offers the native share sheet (clipboard as fallback) and
  posts your result to the challenge board as well as your global best.
- **Boards are scoped by seed *and* mode.** A photo link and a street link may
  share a seed but never share standings: `?c=<seed>&m=photos` reads the photo
  board, `?c=<seed>` the street one.
- A challenge link only resumes its *own* game, in its own mode. Opening a
  friend's link never silently swallows an unrelated game in progress.
- No cleanup job: only the 10 most recently played links keep a board (25 rows
  each), and the oldest is evicted, so the document stays inside JSONBin's
  100 KB bin limit.

The seed is public, so it is not a secret and not a score: the server still
deals and scores everything, and a challenge game is scored exactly like a
normal one. Someone willing to script the API could enumerate seeds — which is
no more than what the visible Mapillary attribution already allows.

## Where the photos come from

`scripts/resolve-locations.mjs` (`npm run photos`) picks one photograph per
place from [Wikimedia Commons](https://commons.wikimedia.org), keeps it only if
the image is freely licensed and its recorded coordinates match the town, then
re-encodes it to a 1280 px WebP-quality JPEG (46 files, ~5.7 MB total), names
it by content hash (`/photos/896933718970.jpg`) and writes
`data/locations.json` with the answer, the author, the licence and the file
page. Re-running the script is idempotent for places that already pass.

The photo is chosen for being *recognisable*, not rare: a square, a gate, a
coastline, a mountain road. Two rules keep it fair:

- the on-screen attribution gives the photographer and licence but **not the
  file page**, because the file name would spell the place out — the reveal
  card links it instead;
- one photo per place, so the same landmark never appears twice in a game.

Photo mode needs no Mapillary token at all, which also makes the game playable
where that imagery is blocked, rate-limited or simply absent.

## Street imagery: why Mapillary

Google Street View is the only dataset with dense Moroccan coverage, but using
it in a game is not permitted. Google Maps Platform Terms of Service
§3.2.3(d) forbids products that "re-create the features of another Google
product", and §3.2.3(e) forbids displaying Street View imagery together with a
non-Google map — which is exactly this layout. GeoGuessr itself pays Google for
a licence.

[Mapillary](https://www.mapillary.com) is the free, openly licensed alternative
(imagery is CC BY-SA 4.0, attribution is shown on every round). The trade-off is
coverage: it only exists where contributors have driven.

Measured on 2026-11-15 across 50 Moroccan towns:

| | |
| --- | --- |
| 360° panoramas found | ~760 |
| Towns with any imagery | 18 |
| Playable rounds in the pool | 155 |
| Rounds you can walk from | 60 |
| Strongest towns | Casablanca, Mohammedia, Settat, Rabat, Salé, El Jadida |

The pool is therefore honest about its limits: a game is drawn from walkable
rounds first, and a round with no neighbours is still a full 360° look-around.

### Growing the map

```bash
MAPILLARY_TOKEN=MLY\|... npm run scan
```

Scans the coverage tiles around the towns in `scripts/scan-panoramas.mjs`,
groups panoramas into chains a player can walk along, and rewrites
`data/panoramas.json`. Add your own drive to Mapillary first and it joins the
game on the next scan — that is how Morocco coverage improves.

## Architecture

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Server page, passes the round counts to the client |
| `components/game-shell.tsx` | Client state machine: idle → playing → revealed → finished, for both modes |
| `components/panorama-viewer.tsx` | MapillaryJS 360° viewer, arrows on, everything that reveals location off |
| `components/photo-panel.tsx` | Still-photo round, attribution on screen, no answer in the DOM |
| `components/game-map.tsx` | Leaflet answer map, pins, reveal line, tile fallback |
| `app/api/game/route.ts` | `GET` resume, `POST` new game (`{ challenge, mode }`), `DELETE` abandon |
| `app/api/game/guess/route.ts` | Scores one guess and reveals the answer |
| `app/api/game/swap/route.ts` | Swaps an unloadable panorama or photo |
| `app/api/leaderboard/route.ts` | `GET` top scores (`?c=<seed>&m=<mode>` for one link), `POST` a finished game's score |
| `app/c/[seed]/page.tsx` | Shared challenge link: the same five rounds for everyone |
| `components/leaderboard.tsx` | Leaderboard list + name form (intro and final screen) |
| `components/challenge-share.tsx` | Native share / clipboard for a challenge link |
| `lib/challenge.ts` | Seed validation, generation, and the mode-aware link builder |
| `lib/modes.ts` | `street` / `photos` vocabulary, shared by client and server |
| `lib/game.ts` | Pure, mode-aware game state machine (rounds, guesses, swaps, summary) |
| `lib/locations.ts` | Server-only photo dataset (holds the coordinates) |
| `lib/leaderboard.ts` | Name sanitising, bin parsing, personal-best merge, public view |
| `lib/jsonbin.ts` | Server-only JSONBin read/write (holds the master key) |
| `lib/player.ts` | Long-lived random per-browser id so a player keeps one row |
| `lib/rate-limit.ts` | Sliding-window limiter protecting the leaderboard quota |
| `data/panoramas.json` | Street round pool (coordinates included: server-only) |
| `data/locations.json` | Photo round pool: answer, author, licence, file page |
| `public/photos/` | The 46 photos, content-hashed names |
| `lib/panoramas.ts` | Server-only panorama dataset (holds the coordinates) |
| `lib/mapillary.ts` | Client-safe token and attribution link helpers |
| `lib/scoring.ts` | Distance → points curve |
| `lib/session-core.ts` | Encodes, verifies and re-validates the signed game cookie |
| `lib/darija.ts` | All player-facing Darija copy + Arabic-Indic digit formatting |
| `scripts/scan-panoramas.mjs` | Builds the street round pool from Mapillary coverage |
| `scripts/resolve-locations.mjs` | Builds the photo pool + images from Wikimedia Commons |
| `scripts/e2e-http.mjs` | Plays full games over HTTP, including forged cookies and the leaderboard |
| `scripts/smoke-browser.mjs` | Plays the game in Chromium, mobile and desktop |

**No database.** The whole game lives in an HMAC-signed, `HttpOnly` cookie:
survives a refresh, works on serverless, and the browser cannot read the
answers. On top of the signature, the server **recomputes every distance and
score** from the stored guesses, so a correctly signed cookie still cannot
carry an inflated score. The only shared state is the leaderboard, kept in a
single JSONBin document.

## Shared leaderboard

Finished games can be posted to a [JSONBin](https://jsonbin.io) document, which
is what makes the board shared without running a database. It shows the top 10
on the final screen (top 5 on the intro), one row per player. Games played
through a shared link also land on that link's own board (`?c=<seed>`), which is
where friends who saw the same rounds compare scores.

- **The score is never accepted from the browser.** `POST /api/leaderboard`
  takes a name only. The server decodes the signed game cookie, refuses
  anything that is not a *finished* game, and recomputes the total from the
  stored guesses.
- **One row per player.** A random `HttpOnly` per-browser id keeps your personal
  best: replaying replaces the row only when you beat it, and renaming keeps
  both the score and its place. The id is never sent to other players — it is
  the capability to rename your own row.
- **Names are cleaned server-side:** control and bidi-override characters are
  stripped (so a name cannot visually impersonate the score column),
  whitespace is collapsed, and the name is cut to 16 visible characters without
  splitting an emoji or Arabic letter join.
- **Quota guards.** The board is cached for 20 s server-side, an unchanged
  submission costs no write, one browser may submit once every 15 s, and the
  process caps writes at 40/min. A finished game costs at most one read and one
  write of JSONBin's free 10,000 requests/month — a challenge result costs the
  same single write as a normal one.

Setup: create a bin at [jsonbin.io](https://jsonbin.io), then set
`JSONBIN_BIN_ID` and `JSONBIN_MASTER_KEY`. Without them the leaderboard hides
itself and the game is unchanged.

```json
{
  "v": 2,
  "game": "bladi",
  "updatedAt": 1763200000000,
  "scores": [
    {
      "id": "0f1c2d3e-…",
      "name": "amine",
      "score": 21400,
      "max": 25000,
      "rounds": 5,
      "at": 1763200000000
    }
  ],
  "challenges": [
    {
      "seed": "k3m9x2qa",
      "mode": "photos",
      "createdAt": 1763200000000,
      "scores": [{ "id": "0f1c2d3e-…", "name": "amine", "score": 21400, "max": 25000, "rounds": 5, "at": 1763200000000 }]
    }
  ]
}
```

Boards written before modes existed carry no `mode` and are read as street
boards, so the migration is just a read.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `GAME_SECRET` | dev fallback | HMAC key for the game cookie. **Set it in production** (`openssl rand -hex 32`). |
| `NEXT_PUBLIC_MAPILLARY_TOKEN` | none | Mapillary *client* token for street mode. Public by design. Without it, street mode is disabled on the intro and photo mode still works. |
| `MAPILLARY_TOKEN` | none | Only used by `npm run scan`. |
| `JSONBIN_BIN_ID` | none | Bin that stores the shared leaderboard. Empty hides the leaderboard. |
| `JSONBIN_MASTER_KEY` | none | JSONBin master key, server-side only. Escape `$` when writing it in a `.env` file. |

Get a token for free (no card) at
[mapillary.com/dashboard/developers](https://www.mapillary.com/dashboard/developers):
register an application and copy the client token.

## Scripts

```bash
npm run dev        # dev server
npm run build      # production build
npm start          # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest (102 unit tests)
npm run e2e        # HTTP end-to-end against a running server
LEADERBOARD_E2E_WRITE=1 npm run e2e   # ...and post one score to the live bin
npm run smoke      # Chromium end-to-end (needs CHROME_PATH if no bundled browser)
npm run scan       # rebuild the street round pool from Mapillary
npm run photos     # rebuild the photo pool + images from Wikimedia Commons
```

## Performance from Morocco

Measured with Chromium against the production build (no throttling):

| Phase | Transferred |
| --- | --- |
| Intro screen | 218 KB (141 KB JS) |
| Entering a street round | +1.8 MB, of which 1.5 MB is the street imagery |
| One step down the street | ~0.7 MB |
| Entering a photo round | +~130 KB (one photo, no 3D viewer) |

The imagery is the unavoidable cost of real street-level video-like data —
Mapillary streams tiles so you can zoom in to read a sign. What the app controls
it does control:

- the intro ships without the 3D viewer — MapillaryJS loads only when a round
  starts;
- fonts and CSS are self-hosted (`next/font`, so no `fonts.googleapis.com`);
- one WebGL context is reused across all five rounds instead of being rebuilt;
- map tiles fall back from CARTO to OpenStreetMap, and the game stays playable
  on a dark canvas if both are unreachable;
- if a panorama never paints (dead capture, blocked CDN), the round offers a
  swap after 25 s instead of stranding the player.

## Deploying for free

**Vercel Hobby** fits: free, no card, zero-config for Next.js, and no database
to buy.

No git repository is needed — the CLI uploads the folder:

```bash
npx vercel login          # GitHub, Google or email; no card is asked for
npx vercel                # first deploy, creates the project + preview URL
npx vercel --prod         # ship it: https://<project>.vercel.app
```

Then add the values from `.env.local` under **Project → Settings → Environment
Variables** (Production, and Preview if you want). `vercel env add` works too,
but paste the JSONBin key **with its `\$` unescaped to `$`**: `.env` files
swallow `$`, the dashboard does not.

| Variable | Needed? | What it does |
| --- | --- | --- |
| `GAME_SECRET` | **yes** | Signs the game cookie. Without it the code falls back to a development key printed in the source, so anyone could forge a perfect score. `openssl rand -hex 32`. |
| `NEXT_PUBLIC_MAPILLARY_TOKEN` | optional | Turns street mode on. Read at **build** time, so redeploy after adding it. Without it the intro offers photo mode only, which is still a complete game. |
| `JSONBIN_BIN_ID`, `JSONBIN_MASTER_KEY` | optional | Turns the shared leaderboard and challenge boards on. Skip both and the board hides itself. |

Alternatively, push the repo to GitHub and import it at
[vercel.com/new](https://vercel.com/new); the framework preset, build command and
output all need no changes.

Notes:

- Hobby is for personal, non-commercial projects; a commercial launch needs Pro.
- The free tier is far bigger than this game: 100 GB transfer, 1M function
  invocations and 5 000 image transformations a month. Twenty friends playing a
  few games each uses a fraction of the image budget (46 photos, a handful of
  widths each), and the photos are the only images Vercel optimises.
- Route handlers run as serverless functions and `x-forwarded-proto: https`
  makes the session cookie `Secure` automatically. Game state lives in that
  cookie, so there is no database to size, back up or pay for.
- Bandwidth is mostly Mapillary's, not yours: their imagery is served from
  Meta's CDN, so the free tier carries almost no image traffic.
- Past a Hobby limit Vercel pauses that feature until the month resets rather
  than billing you — there is no way to accidentally owe money.
- Alternatives, all free but weaker fits: Render or Koyeb free web services
  (`npm run build` + `npm start`; they sleep when idle, so the first request
  after a quiet spell is slow), or Cloudflare with `@opennextjs/cloudflare`
  (Workers free gives each request only 10 ms of CPU, which a server-rendered
  React page can exceed). `sharp` is a runtime dependency precisely so a plain
  Node host can serve `next/image` without a build-machine-only install.

## Known limitations

- **Street coverage is thin and clustered.** Morocco's Mapillary coverage is a
  few hundred panoramas in 18 towns; outside them street mode has nothing to
  show. Photo mode reaches 46 places instead, but with one still image each, so
  it cannot be walked and is easier to recognise from a single landmark.
- **Photo mode images are public.** They are Wikimedia Commons files, chosen to
  be recognisable, so a reverse image search or a good memory beats the game.
  The licence requires showing the author, which is exactly what it does.
- The image id is visible in the page (Mapillary attribution links to the
  original capture), so a determined player could look the location up.
  GeoGuessr has the same property.
- The leaderboard is a single JSONBin document, not a database: two players
  finishing in the same instant can lose one row (last write wins), and the
  rate limit is per server process, so a burst spread across many serverless
  instances is not globally capped.
- Leaderboard names are typed by players and not verified; there are no
  accounts. Clearing cookies starts a new row rather than recovering the old
  one. Scores themselves are still recomputed server-side.
- Only the 10 most recently played challenge links keep a board. A link sent to
  a group chat and played a week later may outlive its board (the rounds still
  work; the standings would start again).
- Challenge seeds are public: the rounds are repeatable and enumerable. The
  imagery attribution already allows looking a location up, so this is a
  convenience feature, not an anti-cheat one.
- An unusable challenge link (for example `/c/no`, too short to be a seed)
  renders the 404 page, but Next streams the not-found boundary for a dynamic
  route, so the HTTP status stays 200. It cannot start a game.
- Arabic-script copy only; no Arabizi toggle.
- Photo mode depends on Commons staying up. A missing image offers the same
  swap as a dead panorama, and two failures in a row offer a retry; it never
  leaves the player on a round they cannot end.
