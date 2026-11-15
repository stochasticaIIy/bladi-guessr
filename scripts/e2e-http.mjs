#!/usr/bin/env node
/**
 * Plays complete games against a running server over plain HTTP.
 *
 *   npm run build && npm start
 *   npm run e2e
 *
 * It is deliberately dependency-free (node fetch only) so it can run anywhere,
 * including a phone-hotspot connection, and it checks the things the browser
 * test cannot: cookie flags, round resumption, forged cookies and the fact that
 * the public API never leaks coordinates before a guess.
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Minimal cookie jar for the two cookies the app sets: game + player id. */
const COOKIES = new Set(["bladi_game", "bladi_player"]);

function makeJar() {
  const store = new Map();
  return {
    get header() {
      return [...store].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    absorb(response) {
      const raw = response.headers.getSetCookie?.() ?? [];
      for (const line of raw) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim();
        if (COOKIES.has(name)) store.set(name, pair.slice(index + 1).trim());
      }
      return raw.join(" | ");
    },
    get(name) {
      return store.get(name) ?? null;
    },
    set(value) {
      const index = value.indexOf("=");
      store.set(value.slice(0, index), value.slice(index + 1));
    },
  };
}

async function call(jar, path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(jar.header ? { Cookie: jar.header } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  const setCookies = jar.absorb(response);
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, setCookies };
}

const jar = makeJar();

// --------------------------------------------------------------- fresh session
{
  const resume = await call(jar, "/api/game");
  check("GET /api/game before starting is inactive", resume.status === 200 && resume.body.active === false);
}

// ------------------------------------------------------------- start + payload
let started;
{
  const response = await call(jar, "/api/game", { method: "POST" });
  started = response.body;
  check("POST /api/game starts a game", response.status === 200 && started.active === true);
  check("game has five rounds", started.totalRounds === 5, String(started.totalRounds));
  check("first round has an image id", typeof started.imageId === "string" && started.imageId.length > 5, started.imageId);
  check("round starts at index 0", started.roundIndex === 0);

  const flags = response.setCookies;
  check("cookie is HttpOnly", /HttpOnly/i.test(flags), flags);
  check("cookie is SameSite=Lax", /SameSite=Lax/i.test(flags));
  check("cookie is path-scoped", /Path=\//i.test(flags));

  const leaked = /"(lat|lng|latitude|longitude|city|region)"/.test(JSON.stringify(started));
  check("public payload leaks no location fields", !leaked, JSON.stringify(started));
}

// -------------------------------------------------------------------- resuming
{
  const resumed = await call(jar, "/api/game");
  check(
    "a refresh resumes the same round",
    resumed.body.active === true && resumed.body.imageId === started.imageId,
  );
}

// ------------------------------------------------------------------ bad input
{
  const invalid = await call(jar, "/api/game/guess", {
    method: "POST",
    body: JSON.stringify({ lat: 123, lng: 999 }),
  });
  check("out-of-range coordinates are rejected", invalid.status === 400, String(invalid.status));

  const garbage = await call(jar, "/api/game/guess", { method: "POST", body: "{not json" });
  check("malformed body is rejected", garbage.status === 400, String(garbage.status));
}

// ----------------------------------------------------------------------- swap
{
  const before = await call(jar, "/api/game");
  const swapped = await call(jar, "/api/game/swap", { method: "POST" });
  check("swap returns a different panorama", swapped.status === 200 && swapped.body.imageId !== before.body.imageId);

  const after = await call(jar, "/api/game");
  check("swap does not score the round", after.body.roundIndex === 0 && after.body.score === 0);

  // Spend the rest of the skip budget, then make sure it is enforced.
  for (let i = 0; i < 4; i++) await call(jar, "/api/game/swap", { method: "POST" });
  const blocked = await call(jar, "/api/game/swap", { method: "POST" });
  check("skip budget is enforced", blocked.status === 429, String(blocked.status));
}

// ------------------------------------------------------------------- full game
let finalScore = null;
{
  let previousScore = 0;
  const seenSources = new Set();
  for (let round = 0; round < 5; round++) {
    const guess = await call(jar, "/api/game/guess", {
      method: "POST",
      body: JSON.stringify({ lat: 31.5 + round, lng: -7.5 - round }),
    });
    const result = guess.body;
    if (guess.status !== 200) {
      check(`round ${round + 1}: guess accepted`, false, JSON.stringify(result));
      break;
    }
    const ok =
      result.roundIndex === round &&
      typeof result.distanceKm === "number" &&
      result.distanceKm > 0 &&
      typeof result.score === "number" &&
      result.score >= 0 &&
      result.score <= 5000 &&
      result.answer &&
      typeof result.answer.lat === "number" &&
      typeof result.answer.lng === "number" &&
      typeof result.answer.city === "string" &&
      result.totalScore >= previousScore;
    check(`round ${round + 1}: scored and revealed`, ok, `d=${result.distanceKm?.toFixed(1)}km s=${result.score}`);

    // Each round must be a different place. The source URL is the only stable
    // per-round identity in the answer, and it differs for every capture.
    check(
      `round ${round + 1}: new place`,
      !seenSources.has(result.answer.credit.url),
      result.answer.credit.url,
    );
    seenSources.add(result.answer.credit.url);
    previousScore = result.totalScore;

    if (round < 4) {
      check(`round ${round + 1}: next round handed over`, typeof result.nextRound?.imageId === "string");
    } else {
      check("last round finishes the game", result.finished === true && result.nextRound === null);
      check("summary totals five rounds", result.summary?.rounds?.length === 5, String(result.summary?.rounds?.length));
      check("summary max total is 25000", result.summary?.maxTotal === 25000);
      finalScore = result.summary?.totalScore;
      check(
        "summary total equals the rounds",
        result.summary?.rounds?.reduce((sum, entry) => sum + entry.score, 0) === result.summary?.totalScore,
      );
    }
  }

  const sixth = await call(jar, "/api/game/guess", {
    method: "POST",
    body: JSON.stringify({ lat: 31, lng: -7 }),
  });
  check("a sixth guess is refused", sixth.status === 409, String(sixth.status));

  const swapAfterEnd = await call(jar, "/api/game/swap", { method: "POST" });
  check("cannot swap after the game ended", swapAfterEnd.status === 409, String(swapAfterEnd.status));

  const finished = await call(jar, "/api/game");
  check("finished state survives a refresh", finished.body.finished === true && finished.body.summary !== null);
}

// ------------------------------------------------------------- shared challenge
const CHALLENGE_SEED = "e2etest01";
let challengeRuns = null;
{
  const first = makeJar();
  const second = makeJar();
  const one = await call(first, "/api/game", {
    method: "POST",
    body: JSON.stringify({ challenge: CHALLENGE_SEED }),
  });
  const two = await call(second, "/api/game", {
    method: "POST",
    body: JSON.stringify({ challenge: CHALLENGE_SEED }),
  });
  check("a challenge link starts a game", one.status === 200 && one.body.challenge === CHALLENGE_SEED, String(one.status));
  check("the second player joins the same challenge", two.body.challenge === CHALLENGE_SEED);
  check("both players start on the same panorama", one.body.imageId === two.body.imageId, `${one.body.imageId} vs ${two.body.imageId}`);

  const bad = await call(makeJar(), "/api/game", {
    method: "POST",
    body: JSON.stringify({ challenge: "not a seed" }),
  });
  check("an invalid challenge seed is refused", bad.status === 400, String(bad.status));

  // Play both games with identical guesses, recording every dealt panorama.
  const ids = { one: [one.body.imageId], two: [two.body.imageId] };
  let scores = { one: 0, two: 0 };
  for (let round = 0; round < 5; round++) {
    const guess = JSON.stringify({ lat: 31.5 + round, lng: -7.5 - round });
    const a = await call(first, "/api/game/guess", { method: "POST", body: guess });
    const b = await call(second, "/api/game/guess", { method: "POST", body: guess });
    if (round < 4) {
      ids.one.push(a.body.nextRound?.imageId);
      ids.two.push(b.body.nextRound?.imageId);
    } else {
      scores = { one: a.body.summary?.totalScore ?? -1, two: b.body.summary?.totalScore ?? -1 };
    }
  }
  check("every round of the challenge is identical", ids.one.join() === ids.two.join(), ids.one.join());
  check("identical guesses score identically on both games", scores.one === scores.two && scores.one > 0, `${scores.one} vs ${scores.two}`);
  challengeRuns = { first, second, scores };
}

// ---------------------------------------------------------------- photo mode
const PHOTO_CHALLENGE = "e2ephoto01";
let photoRuns = null;
{
  const unknownMode = await call(jar, "/api/game", { method: "POST", body: JSON.stringify({ mode: "video" }) });
  check("an unknown mode is refused", unknownMode.status === 400, String(unknownMode.status));

  const solo = makeJar();
  const started = await call(solo, "/api/game", {
    method: "POST",
    body: JSON.stringify({ mode: "photos" }),
  });
  check("a photo game starts", started.status === 200 && started.body.mode === "photos", String(started.status));
  check("a photo round carries no street image", started.body.imageId === null);
  check(
    "a photo round serves a hashed photo path",
    /^\/photos\/[0-9a-f]{12}\.jpg$/.test(started.body.photo ?? ""),
    String(started.body.photo),
  );
  check(
    "a photo round credits its photographer",
    Boolean(started.body.credit?.label && started.body.credit?.licence),
    JSON.stringify(started.body.credit),
  );
  check(
    "a photo payload leaks no location fields",
    !/"(lat|lng|latitude|longitude|city|region)"/.test(JSON.stringify(started.body)),
    JSON.stringify(started.body),
  );

  const swappedPhoto = await call(solo, "/api/game/swap", { method: "POST" });
  check(
    "a broken photo is swapped for another photo",
    swappedPhoto.status === 200 &&
      /^\/photos\//.test(swappedPhoto.body.photo ?? "") &&
      swappedPhoto.body.photo !== started.body.photo &&
      swappedPhoto.body.imageId === null,
    `${started.body.photo} -> ${swappedPhoto.body.photo}`,
  );

  for (let round = 0; round < 5; round++) {
    const guess = await call(solo, "/api/game/guess", {
      method: "POST",
      body: JSON.stringify({ lat: 31.5 + round, lng: -7.5 - round }),
    });
    if (round < 4) {
      check(`photo round ${round + 1}: a photo is handed over`, /^\/photos\//.test(guess.body.nextRound?.photo ?? ""));
      check(`photo round ${round + 1}: no street imagery leaks in`, guess.body.nextRound?.imageId === null);
    } else {
      check("the photo game finishes with a photo summary", guess.body.summary?.mode === "photos");
      check(
        "the photo answer links to its Commons file",
        /^https:\/\/commons\.wikimedia\.org\//.test(guess.body.answer?.credit?.url ?? ""),
        String(guess.body.answer?.credit?.url),
      );
    }
  }

  const first = makeJar();
  const second = makeJar();
  const one = await call(first, "/api/game", {
    method: "POST",
    body: JSON.stringify({ challenge: PHOTO_CHALLENGE, mode: "photos" }),
  });
  const two = await call(second, "/api/game", {
    method: "POST",
    body: JSON.stringify({ challenge: PHOTO_CHALLENGE, mode: "photos" }),
  });
  check("a photo challenge link starts a photo game", one.body.mode === "photos" && one.body.challenge === PHOTO_CHALLENGE);
  check("both photo players start on the same photo", one.body.photo === two.body.photo, `${one.body.photo} vs ${two.body.photo}`);

  const photos = { one: [one.body.photo], two: [two.body.photo] };
  let photoScores = { one: 0, two: 0 };
  for (let round = 0; round < 5; round++) {
    const guess = JSON.stringify({ lat: 31.5 + round, lng: -7.5 - round });
    const a = await call(first, "/api/game/guess", { method: "POST", body: guess });
    const b = await call(second, "/api/game/guess", { method: "POST", body: guess });
    if (round < 4) {
      photos.one.push(a.body.nextRound?.photo);
      photos.two.push(b.body.nextRound?.photo);
    } else {
      photoScores = { one: a.body.summary?.totalScore ?? -1, two: b.body.summary?.totalScore ?? -1 };
    }
  }
  check("every round of the photo challenge is identical", photos.one.join() === photos.two.join(), photos.one.join());
  check("identical photo guesses score identically", photoScores.one === photoScores.two && photoScores.one > 0, `${photoScores.one} vs ${photoScores.two}`);
  photoRuns = { first, second };
}

// -------------------------------------------------------------- forged cookies
{
  const forged = makeJar();
  forged.set("bladi_game=eyJ2IjoyLCJpZCI6ImZha2UifQ.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  const response = await call(forged, "/api/game");
  check("a forged cookie is ignored", response.body.active === false);

  const tampered = makeJar();
  tampered.set(`bladi_game=${(jar.get("bladi_game") ?? "").slice(0, -4)}AAAA`);
  const tamperedResponse = await call(tampered, "/api/game");
  check("a tampered cookie is ignored", tamperedResponse.body.active === false);
}

// ------------------------------------------------------------- leaderboard
{
  const read = await call(jar, "/api/leaderboard");
  check("GET /api/leaderboard answers", read.status === 200, String(read.status));

  if (!read.body.configured) {
    console.log("SKIP  leaderboard: JSONBIN_BIN_ID / JSONBIN_MASTER_KEY are not set");
  } else {
    check("a configured leaderboard is available", read.body.available === true);
    check("top rows are ranked from one", read.body.entries.every((row, index) => row.rank === index + 1));
    check("the public board never carries player ids", !/"id"\s*:/.test(JSON.stringify(read.body)));

    const unnamed = await call(jar, "/api/leaderboard", {
      method: "POST",
      body: JSON.stringify({ name: "\u202E\u200F  " }),
    });
    check("an invisible-only name is rejected", unnamed.status === 400, String(unnamed.status));

    // A live game has no final score and must not be snapshotted early.
    const fresh = makeJar();
    await call(fresh, "/api/game", { method: "POST" });
    const early = await call(fresh, "/api/leaderboard", {
      method: "POST",
      body: JSON.stringify({ name: "e2e" }),
    });
    check("an unfinished game cannot be submitted", early.status === 409, String(early.status));

    if (process.env.LEADERBOARD_E2E_WRITE !== "1") {
      console.log("SKIP  leaderboard write: set LEADERBOARD_E2E_WRITE=1 to post a test score");
    } else {
      const name = `e2e-${Date.now().toString(36).slice(-6)}`;
      const saved = await call(jar, "/api/leaderboard", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      check("a finished game is accepted", saved.status === 200 && saved.body.saved === true, String(saved.status));
      check("the stored score is the server-computed total", saved.body.you?.score === finalScore, `${saved.body.you?.score} vs ${finalScore}`);
      check("the row is yours and ranked", saved.body.you?.rank > 0 && saved.body.you?.name === name);
      check("the response hides player ids", !/"id"\s*:/.test(JSON.stringify(saved.body)));
      check("the player id cookie is HttpOnly", /HttpOnly/i.test(saved.setCookies), saved.setCookies);

      const repeated = await call(jar, "/api/leaderboard", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      check("a second submission is rate limited", repeated.status === 429, String(repeated.status));

      const after = await call(jar, "/api/leaderboard");
      check(
        "the submitted row is on the shared board",
        after.body.entries.some((row) => row.name === name && row.you && row.score === finalScore),
      );

      // ---- the challenge board written by the two players above
      if (challengeRuns) {
        const stamp = Date.now().toString(36).slice(-6);
        const first = await call(challengeRuns.first, "/api/leaderboard", {
          method: "POST",
          body: JSON.stringify({ name: `chA-${stamp}` }),
        });
        const second = await call(challengeRuns.second, "/api/leaderboard", {
          method: "POST",
          body: JSON.stringify({ name: `chB-${stamp}` }),
        });
        check("a challenge score is accepted", first.status === 200 && second.status === 200, `${first.status}/${second.status}`);
        check("the submit response is scoped to the challenge", first.body.challenge === CHALLENGE_SEED && first.body.you?.name === `chA-${stamp}`);

        const board = await call(challengeRuns.first, `/api/leaderboard?c=${CHALLENGE_SEED}`);
        const boardForSecond = await call(challengeRuns.second, `/api/leaderboard?c=${CHALLENGE_SEED}`);
        // Other runs may have played the same seed before, so the board holds at
        // least these two players rather than exactly two.
        check(
          "the challenge board holds both players",
          board.body.total >= 2 && boardForSecond.body.you?.name === `chB-${stamp}`,
          `${board.body.total} rows, second sees ${boardForSecond.body.you?.name}`,
        );
        check("the challenge board knows you", board.body.you?.name === `chA-${stamp}`);
        check(
          "challenge rows never carry player ids",
          !/"id":/.test(JSON.stringify(board.body)),
        );

        const other = await call(challengeRuns.first, "/api/leaderboard?c=otherchallenge");
        check("another link's board stays empty", other.body.total === 0, String(other.body.total));

        const global = await call(challengeRuns.first, "/api/leaderboard");
        check("challenge runs also count on the global board", global.body.total >= 3, String(global.body.total));
      }

      if (photoRuns) {
        const stamp = Date.now().toString(36).slice(-6);
        const photoFirst = await call(photoRuns.first, "/api/leaderboard", {
          method: "POST",
          body: JSON.stringify({ name: `phA-${stamp}` }),
        });
        const photoSecond = await call(photoRuns.second, "/api/leaderboard", {
          method: "POST",
          body: JSON.stringify({ name: `phB-${stamp}` }),
        });
        check("photo challenge scores are accepted", photoFirst.status === 200 && photoSecond.status === 200, `${photoFirst.status}/${photoSecond.status}`);
        check("the photo response is scoped to photo mode", photoFirst.body.mode === "photos");

        const photoBoard = await call(photoRuns.first, `/api/leaderboard?c=${PHOTO_CHALLENGE}&m=photos`);
        const photoBoardForSecond = await call(
          photoRuns.second,
          `/api/leaderboard?c=${PHOTO_CHALLENGE}&m=photos`,
        );
        check(
          "the photo challenge board holds both players",
          photoBoard.body.total >= 2 && photoBoardForSecond.body.you?.name === `phB-${stamp}`,
          `${photoBoard.body.total} rows, second sees ${photoBoardForSecond.body.you?.name}`,
        );
        check("the photo challenge board knows you", photoBoard.body.mode === "photos" && Boolean(photoBoard.body.you));

        const streetBoard = await call(photoRuns.first, `/api/leaderboard?c=${PHOTO_CHALLENGE}`);
        check("the same seed has a separate street board", streetBoard.body.total === 0, String(streetBoard.body.total));
      }

      const badMode = await call(jar, "/api/leaderboard?c=whatever&m=video");
      check("an unknown leaderboard mode is refused", badMode.status === 400, String(badMode.status));
    }
  }
}

console.log(failures === 0 ? "\nALL HTTP CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
