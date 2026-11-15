import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const EXEC = process.env.CHROME_PATH || undefined; // set CHROME_PATH if the bundled browser is missing
const BASE = process.env.BASE_URL || "http://localhost:3000";

// Every town in the round pool: none of them may appear on screen before the
// player has guessed, or the game would be handing out the answer.
const CITIES = [
  ...new Set(
    JSON.parse(readFileSync("data/panoramas.json", "utf8")).rounds.map((round) => round.city),
  ),
];

let failures = 0;
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ executablePath: EXEC });

async function newContext({ blockTiles = false, blockImagery = false, viewport } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  if (blockTiles) {
    await context.route("**basemaps.cartocdn.com/**", (route) => route.abort());
  }
  if (blockImagery) {
    await context.route("**graph.mapillary.com/**", (route) => route.abort());
  }
  return context;
}

/** The attribution link is the only stable handle on "which panorama is this". */
const currentPano = (page) =>
  page
    .locator(".mapillary-attribution-image-container")
    .getAttribute("href", { timeout: 5000 })
    .then((href) => href ?? "")
    .catch(() => "");

// ---------------------------------------------------------------- main flow
{
  const context = await newContext();
  const page = await context.newPage();
  const hosts = new Set();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle" });

  const dir = await page.evaluate(() => getComputedStyle(document.body).direction);
  check("document direction is rtl", dir === "rtl", dir);
  check("html lang is ar", (await page.getAttribute("html", "lang")) === "ar");
  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  check("Cairo font applied", /Cairo/i.test(font), font.slice(0, 40));
  check(
    "Cairo font file actually loaded",
    await page.evaluate(() => document.fonts.check('16px "Cairo"')),
  );
  check(
    "the intro offers creating a shared challenge",
    await page.getByRole("button", { name: "دير تحدي مع صحابك" }).isVisible(),
  );

  const startButton = page.getByRole("button", { name: "بدا اللعب" });
  check("start button visible", await startButton.isVisible());

  // The shared board is read-only here: the browser test never writes a score,
  // so running it against a live bin cannot pollute the real leaderboard.
  const board = await page.evaluate(() =>
    fetch("/api/leaderboard", { cache: "no-store" }).then((response) => response.json()),
  );
  if (board.configured) {
    check("intro renders the shared leaderboard", await page.getByRole("heading", { name: "الترتيب العام" }).isVisible());
    check("the public board carries no player ids", !/"id":/.test(JSON.stringify(board)));
  } else {
    console.log("SKIP  leaderboard: JSONBIN_BIN_ID / JSONBIN_MASTER_KEY are not set");
  }

  await page.screenshot({ path: "/tmp/shot-idle.png" });

  await startButton.click();

  // ---- the street itself
  const viewerBox = await page
    .waitForFunction(
      () => {
        const el = document.querySelector(".mapillary-viewer");
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 100 && rect.height > 100 ? { w: rect.width, h: rect.height } : false;
      },
      { timeout: 30000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  check("street panel has a real size", Boolean(viewerBox), viewerBox ? `${Math.round(viewerBox.w)}x${Math.round(viewerBox.h)}` : "0");

  const canvasPainted = await page
    .waitForFunction(
      () => {
        const canvas = document.querySelector("canvas.mapillary-canvas");
        return Boolean(canvas && canvas.width > 200 && canvas.height > 200);
      },
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);
  check("360 panorama renders on a canvas", canvasPainted);

  check(
    "imagery is streamed from Mapillary",
    [...hosts].some((host) => host.includes("mapillary")),
    [...hosts].filter((host) => host.includes("mapillary")).join(","),
  );

  check("no cover map is rendered", (await page.locator(".mapillary-cover").count()) === 0);
  check("no compass is rendered", (await page.locator(".mapillary-bearing-container").count()) === 0);

  // Arrows appear once the neighbouring images have been fetched.
  const failuresBeforeArrows = failedRequests.length;
  const arrowReady = await page
    .locator(".mapillary-direction-circle")
    .first()
    .waitFor({ state: "visible", timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  const arrows = await page.locator(".mapillary-direction-circle").count();

  if (arrowReady && arrows > 0) {
    check("navigation arrows are shown", true, `${arrows} arrow(s)`);
  } else {
    // No arrows at all means the neighbourhood request was refused. That is a
    // Mapillary availability problem (the shared test token is rate limited),
    // not a missing feature, so it is reported rather than silently passed.
    const refused = failedRequests
      .slice(failuresBeforeArrows)
      .some((url) => /mapillary|fbcdn/.test(url));
    if (refused) {
      console.log("SKIP  navigation arrows: Mapillary refused the request (rate limit)");
    } else {
      check("navigation arrows are shown", false, "0 arrows, no failed request");
    }
  }

  // ---- no answer leaking before the guess
  const preGuessText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const leaked = CITIES.filter((city) => preGuessText.includes(city));
  check("no city name is on screen before guessing", leaked.length === 0, leaked.join(","));

  // ---- walking down the street
  const before = await currentPano(page);
  await page.locator(".mapillary-direction-circle").first().click({ force: true });
  await page.waitForTimeout(4500);
  const after = await currentPano(page);
  check(
    "clicking an arrow actually moves to another panorama",
    Boolean(before && after && before !== after),
    `${before.split("pKey=")[1] ?? before} -> ${after.split("pKey=")[1] ?? after}`,
  );
  await page.screenshot({ path: "/tmp/shot-playing.png" });

  // ---- the answer map
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  const tilesLoaded = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("img.leaflet-tile")].some(
          (img) => img.complete && img.naturalWidth > 0,
        ),
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  check("map tiles render", tilesLoaded);

  const clickMap = async (x, y) => {
    await page.locator(".leaflet-container").click({ position: { x, y } });
    await page.waitForSelector(".bladi-pin", { timeout: 5000 });
  };

  for (let round = 1; round <= 5; round++) {
    if (round > 1) {
      await page.getByRole("button", { name: "الدورة اللي جاية" }).click();
      await page.waitForSelector(".bladi-pin", { state: "detached", timeout: 5000 }).catch(() => {});
      const nextPano = await page
        .waitForSelector(".mapillary-viewer", { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      check(`round ${round}: street loads`, nextPano);
    }

    const confirm = page.getByRole("button", { name: "أكد التخمين" });
    check(`round ${round}: confirm disabled before picking`, await confirm.isDisabled());
    await clickMap(120 + round * 15, 140);
    check(`round ${round}: confirm enabled after picking`, await confirm.isEnabled());

    await confirm.click();
    try {
      await page.waitForSelector("text=البلاصة الصحيحة", { timeout: 15000 });
    } catch (error) {
      const visible = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 200);
      console.error(`\n[round ${round}] reveal did not appear. page says: ${visible}`);
      console.error(
        `[round ${round}] errors: ${[...pageErrors, ...consoleErrors].join(" | ") || "none"}`,
      );
      throw error;
    }

    if (round === 1) {
      const card = await page.locator("[data-reveal]").innerText();
      check("reveal card shows a score", /[٠-٩]{2,}/.test(card), card.replace(/\s+/g, " ").slice(0, 70));
      check("reveal card credits Mapillary", /CC BY-SA/.test(card));
      check("reveal card shows the distance", /المسافة/.test(card));
      await page.screenshot({ path: "/tmp/shot-revealed.png" });
    }
  }

  await page.getByRole("button", { name: "شوف النتيجة" }).click();
  await page.waitForSelector("text=النتيجة النهائية", { timeout: 10000 });
  const summaryText = await page.locator("main").innerText();
  check(
    "summary screen shows a grade",
    /ولد البلاد|ماشي خايب|خاصك تدور|خريطة المغرب|تبدا من هنا/.test(summaryText),
  );
  check("summary lists five rounds", (summaryText.match(/\n/g) ?? []).length > 5);

  if (board.configured) {
    const formReady = await page
      .getByRole("button", { name: "دخل النتيجة للترتيب" })
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check("final screen offers a leaderboard submit", formReady);
  }

  await page.screenshot({ path: "/tmp/shot-summary.png", fullPage: true });

  await page.reload({ waitUntil: "networkidle" });
  check(
    "finished game survives a refresh",
    await page
      .locator("text=النتيجة النهائية")
      .isVisible()
      .catch(() => false),
  );

  await context.close();
}

// ------------------------------------------------- broken panorama → swap
{
  const context = await newContext({ blockImagery: true });
  const page = await context.newPage();
  let swapStatus = null;
  page.on("response", (response) => {
    if (response.url().endsWith("/api/game/swap")) swapStatus = response.status();
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "بدا اللعب" }).click();

  const cardShown = await page
    .locator("text=بدل هاد البلاصة")
    .first()
    .waitFor({ state: "visible", timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  check("a dead panorama offers a swap", cardShown);

  if (cardShown) {
    await page.getByRole("button", { name: "بدل هاد البلاصة" }).click();
    await page.waitForTimeout(2500);
    check("swap request succeeds", swapStatus === 200, String(swapStatus));
    // A second failure in a row means the imagery service itself is down:
    // swapping again would only burn the player's budget, so offer a retry.
    const retryShown = await page
      .getByRole("button", { name: "عاود جرب" })
      .waitFor({ state: "visible", timeout: 40000 })
      .then(() => true)
      .catch(() => false);
    check("a second failure offers a retry instead of another swap", retryShown);
    check(
      "the swap button is gone once imagery is down",
      (await page.getByRole("button", { name: "بدل هاد البلاصة" }).count()) === 0,
    );
  }
  await page.screenshot({ path: "/tmp/shot-swap.png" });
  await context.close();
}

// ------------------------------------------------------- desktop + fallback
{
  const context = await newContext({ blockTiles: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const tileHosts = new Set();
  page.on("request", (request) => {
    if (/openstreetmap|\/\/[a-d]\.basemaps\./.test(request.url())) {
      tileHosts.add(new URL(request.url()).host);
    }
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "بدا اللعب" }).click();
  await page.waitForSelector(".leaflet-container", { timeout: 15000 });

  const switched = await page
    .waitForFunction(() => document.querySelector('[data-tile-tier="osm"]'), { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  // OSM is a third party and a slow edge can take a while: give the tiles the
  // same 30 s the street viewer gets before calling the fallback broken.
  const osmTiles = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("img.leaflet-tile")].some(
          (img) => img.complete && img.naturalWidth > 0 && !img.src.includes("cartocdn"),
        ),
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);
  check(
    "map falls back to OSM when CARTO is blocked",
    switched && osmTiles,
    `${[...tileHosts].join(",")} | switched=${switched} tiles=${osmTiles}`,
  );

  const boxes = await page.evaluate(() => {
    const sections = [...document.querySelectorAll("main > section")];
    const street = sections[0]?.getBoundingClientRect();
    const map = sections[1]?.getBoundingClientRect();
    return street && map ? { street, map } : null;
  });
  check(
    "desktop shows street and map side by side",
    Boolean(boxes && Math.abs(boxes.street.y - boxes.map.y) < 5),
    boxes ? `street.x=${Math.round(boxes.street.x)} map.x=${Math.round(boxes.map.x)}` : "no boxes",
  );
  check(
    "RTL puts the street on the right",
    Boolean(boxes && Math.abs(boxes.street.x - (boxes.map.x + boxes.map.width)) < 5),
    boxes ? `street.x=${Math.round(boxes.street.x)} map ends ${Math.round(boxes.map.x + boxes.map.width)}` : "",
  );
  await page.screenshot({ path: "/tmp/shot-fallback.png" });

  await context.close();
}

// ------------------------------------------------------ shared challenge link
{
  const context = await newContext();
  const page = await context.newPage();
  const response = await page.goto(`${BASE}/c/smoketest1`, { waitUntil: "networkidle" });
  check("a challenge link loads", response?.status() === 200, String(response?.status()));
  check(
    "a challenge link explains that the rounds are shared",
    await page.getByText("تحدي من صحابك").isVisible(),
  );
  const start = page.getByRole("button", { name: "بدا التحدي" });
  check("a challenge link offers its own start button", await start.isVisible());
  check(
    "a challenge link can be shared before playing",
    await page.getByRole("button", { name: "شارك الرابط مع صحابك" }).isVisible(),
  );

  const challengeBoard = await page.evaluate(() =>
    fetch("/api/leaderboard?c=smoketest1", { cache: "no-store" }).then((res) => res.json()),
  );
  if (challengeBoard.configured) {
    check(
      "the challenge page shows its own board",
      await page
        .getByRole("heading", { name: "ترتيب التحدي" })
        .waitFor({ state: "visible", timeout: 15000 })
        .then(() => true)
        .catch(() => false),
    );
    check("the challenge board is scoped to the link", challengeBoard.challenge === "smoketest1");
  }
  await page.screenshot({ path: "/tmp/shot-challenge.png" });

  // Next streams a shell for dynamic params, so the not-found boundary is
  // rendered from the stream and the HTTP status stays 200. What matters is
  // that a bad link never shows a playable challenge.
  await page.goto(`${BASE}/c/no`, { waitUntil: "networkidle" });
  const notFound = await page
    .getByText("This page could not be found")
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("an unusable challenge seed shows the not-found page", notFound);
  check(
    "an unusable challenge seed cannot start a game",
    (await page.getByRole("button", { name: "بدا التحدي" }).count()) === 0,
  );
  await context.close();
}

// ---------------------------------------------------------- still-photo mode
{
  // Photo mode never touches Mapillary: it must work with the street imagery
  // service blocked entirely, which is exactly the point of having it.
  const context = await newContext({ blockImagery: true });
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  const photosByName = new Map(
    JSON.parse(readFileSync("data/locations.json", "utf8")).locations.map((entry) => [
      entry.photo,
      entry.name,
    ]),
  );

  await page.goto(BASE, { waitUntil: "networkidle" });
  const photosTab = page.getByRole("button", { name: "تصاور" });
  check("the intro offers a photo mode", await photosTab.isVisible());
  await photosTab.click();
  check(
    "photo mode explains itself",
    /تصويرة حقيقية من المغرب/.test(await page.locator("main").innerText()),
  );

  await page.getByRole("button", { name: "بدا اللعب" }).click();
  const src = await page
    .locator("[data-photo-id]")
    .getAttribute("data-photo-id", { timeout: 20000 })
    .catch(() => "");
  check("a photo round loads a photo", Boolean(src) && src.startsWith("/photos/"), src ?? "");
  check("photo mode renders no street viewer", (await page.locator(".mapillary-viewer").count()) === 0);
  check(
    "the photo actually paints",
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("img")].some(
            (img) =>
              (img.getAttribute("src") ?? "").includes("photos") && img.complete && img.naturalWidth > 300,
          ),
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false),
  );

  // The credit chip is rendered once the image's load handler has fired, which
  // can be a frame after the pixels are on screen.
  const creditShown = await page
    .getByText(/تصويرة: .+ · (CC BY|Public domain|CC0)/)
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  const preGuessText = await page.locator("main").innerText();
  check(
    "the photo round shows its attribution",
    creditShown,
    preGuessText.match(/تصويرة:[^\n]*/)?.[0] ?? "",
  );
  const answerName = photosByName.get(src) ?? "";
  check(
    "the photo round does not name its location",
    answerName === "" || !preGuessText.includes(answerName),
    answerName,
  );

  await page.waitForSelector(".leaflet-container", { timeout: 15000 });
  const seen = new Set([src]);
  let current = src;
  for (let round = 1; round <= 5; round++) {
    if (round > 1) {
      await page.getByRole("button", { name: "الدورة اللي جاية" }).click();
      await page.waitForSelector("[data-reveal]", { state: "detached", timeout: 15000 }).catch(() => {});
      await page
        .waitForFunction(
          (previous) =>
            document.querySelector("[data-photo-id]")?.getAttribute("data-photo-id") !== previous,
          current,
          { timeout: 15000 },
        )
        .catch(() => {});
      current = await page.locator("[data-photo-id]").getAttribute("data-photo-id").catch(() => "");
      check(
        `photo round ${round}: a new photo is painted`,
        Boolean(current) && current !== [...seen].pop() && current.startsWith("/photos/"),
        current ?? "",
      );
      seen.add(current);
    }

    await page.locator(".leaflet-container").click({ position: { x: 140, y: 150 } });
    await page.waitForSelector(".bladi-pin", { timeout: 8000 });
    await page.getByRole("button", { name: "أكد التخمين" }).click();
    await page.waitForSelector("text=البلاصة الصحيحة", { timeout: 20000 });

    if (round === 1) {
      check(
        "the photo reveal links its Commons file",
        (await page.locator("[data-reveal] a[href*='commons.wikimedia.org']").count()) === 1,
      );
      const reveal = await page.locator("[data-reveal]").innerText();
      check("the photo reveal names the photographer", /(CC BY|Public domain|CC0)/.test(reveal));
      await page.screenshot({ path: "/tmp/shot-photo-reveal.png" });
    }
    if (round === 5) await page.getByRole("button", { name: "شوف النتيجة" }).click();
  }

  check("all five photo rounds were different", seen.size === 5, `${seen.size} photos`);
  await page.waitForSelector("text=النتيجة النهائية", { timeout: 15000 });
  check(
    "the summary says it was a photo game",
    /النتيجة النهائية · تصاور/.test(await page.locator("main").innerText()),
  );
  await page.screenshot({ path: "/tmp/shot-photo-summary.png", fullPage: true });
  await context.close();
}

await browser.close();

// Third-party imagery can fail for reasons outside the app's control (rate
// limits, a CDN edge without CORS headers, a blocked host). The browser reports
// those as "Failed to load resource" with no URL attached, so instead of
// pattern-matching message text, assert precisely what the app owns: nothing
// served from our own origin may fail.
const ownOriginFailures = failedRequests.filter((url) => url.startsWith(BASE));
// A third-party host can also answer a cross-origin request without the CORS
// headers, which the browser logs as an error the app cannot prevent. Only
// those messages are ignored, and only for the hosts the app does not own.
const resourceNoise =
  /^(Failed to load resource|Access to (XMLHttpRequest|fetch) at 'https:\/\/[^']*(mapillary\.com|openstreetmap\.org|basemaps\.cartocdn\.com)[^']*' from origin '[^']*' has been blocked by CORS policy)/;
const appConsoleErrors = consoleErrors.filter((e) => !resourceNoise.test(e));

check(
  "no failed requests from our own origin",
  ownOriginFailures.length === 0,
  ownOriginFailures.slice(0, 2).join(" | "),
);
check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check(
  "no application console errors",
  appConsoleErrors.length === 0,
  appConsoleErrors.slice(0, 2).join(" | "),
);

console.log(failures === 0 ? "\nALL BROWSER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
