import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  CHALLENGE_ENTRIES,
  MAX_CHALLENGES,
  MAX_ENTRIES,
  MAX_NAME_LENGTH,
  cleanName,
  emptyBoard,
  parseBoard,
  publicBoard,
  publicChallenge,
  sameContent,
  submitChallengeScore,
  submitScore,
  type Board,
  type ScoreEntry,
} from "./leaderboard";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const entry = (overrides: Partial<ScoreEntry> = {}): ScoreEntry => ({
  id: ID_A,
  name: "amine",
  score: 12_000,
  max: 25_000,
  rounds: 5,
  at: 1_700_000_000_000,
  ...overrides,
});

const boardWith = (scores: ScoreEntry[]): Board => ({ ...emptyBoard(0), scores });

describe("cleanName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanName("  amine   el   filali ")).toBe("amine el filali");
  });

  it("strips control characters and bidi overrides", () => {
    expect(cleanName("ami\u202Ene\u0000")).toBe("amine");
    expect(cleanName("\u200F")).toBeNull();
    expect(cleanName("\u202E\u202D")).toBeNull();
  });

  it("keeps Arabic and emoji intact without splitting them", () => {
    expect(cleanName("ولد البلاد")).toBe("ولد البلاد");
    const family = "👨‍👩‍👧‍👦";
    const cut = cleanName(family.repeat(20))!;
    expect(cut).not.toBeNull();
    expect(cut.endsWith("\u200d")).toBe(false);
    expect(cut).toBe(family.repeat(MAX_NAME_LENGTH));
  });

  it("truncates to the maximum length", () => {
    expect(Array.from(cleanName("x".repeat(100))!)).toHaveLength(MAX_NAME_LENGTH);
  });

  it("rejects empty, blank and non-string input", () => {
    expect(cleanName("")).toBeNull();
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName({ name: "x" })).toBeNull();
  });
});

describe("parseBoard", () => {
  it("returns an empty board for an unknown shape", () => {
    for (const record of [null, undefined, [], "x", 42, {}, { scores: "nope" }]) {
      const board = parseBoard(record, 10);
      expect(board.scores).toEqual([]);
      expect(board.challenges).toEqual([]);
      expect(board.v).toBe(2);
    }
  });

  it("reads a JSONBin envelope as well as a bare record", () => {
    const board = parseBoard({ record: { v: 1, scores: [entry()] }, metadata: { id: "x" } }, 5);
    expect(board.scores).toHaveLength(1);
    expect(board.scores[0]?.name).toBe("amine");
  });

  it("drops broken rows without losing the good ones", () => {
    const board = parseBoard(
      {
        scores: [
          entry(),
          entry({ id: "nope" }),
          entry({ id: ID_B, score: 999_999 }),
          entry({ id: ID_B, name: "" }),
          { id: ID_B, name: "ok", score: -5, max: 25_000, rounds: 5, at: 1 },
          entry({ id: ID_B, at: Number.NaN }),
          entry({ id: ID_B, name: "Omar", score: 15_000 }),
        ],
      },
      0,
    );
    expect(board.scores.map((row) => row.name)).toEqual(["Omar", "amine"]);
  });

  it("de-duplicates rows for the same player", () => {
    const board = parseBoard({ scores: [entry(), entry({ score: 1 })] }, 0);
    expect(board.scores).toHaveLength(1);
  });

  it("keeps the board ordered and capped", () => {
    const many = Array.from({ length: MAX_ENTRIES + 25 }, (_, index) =>
      entry({
        id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
        score: index,
        at: 1_700_000_000_000 + index,
      }),
    );
    const board = parseBoard({ scores: many }, 0);
    expect(board.scores).toHaveLength(MAX_ENTRIES);
    expect(board.scores[0]?.score).toBe(MAX_ENTRIES + 24);
    expect(board.scores.at(-1)!.score).toBe(25);
  });
});

describe("submitScore", () => {
  it("adds a first result", () => {
    const board = submitScore(emptyBoard(0), { ...entry(), at: 100 }, 5);
    expect(board.scores).toHaveLength(1);
    expect(board.updatedAt).toBe(5);
  });

  it("keeps one row per player and only improves it", () => {
    const start = boardWith([entry({ score: 12_000 })]);
    const better = submitScore(start, { ...entry(), score: 20_000, at: 200 }, 5);
    expect(better.scores).toHaveLength(1);
    expect(better.scores[0]?.score).toBe(20_000);
    expect(better.scores[0]?.at).toBe(200);

    const worse = submitScore(better, { ...entry(), score: 3_000, at: 300 }, 6);
    expect(worse.scores).toHaveLength(1);
    expect(worse.scores[0]?.score).toBe(20_000);
    expect(worse.scores[0]?.at).toBe(200);
  });

  it("renames a row without losing its place or score", () => {
    const start = boardWith([entry({ name: "amine", score: 12_000 })]);
    const renamed = submitScore(start, { ...entry(), name: "Amine", score: 1_000 }, 5);
    expect(renamed.scores).toHaveLength(1);
    expect(renamed.scores[0]).toMatchObject({ name: "Amine", score: 12_000 });
  });

  it("ranks a better score above someone else", () => {
    const start = boardWith([
      entry({ id: ID_A, score: 10_000 }),
      entry({ id: ID_B, name: "Omar", score: 15_000 }),
    ]);
    const board = submitScore(start, { ...entry({ id: ID_A }), score: 16_000, at: 900 }, 1);
    expect(board.scores.map((row) => row.name)).toEqual(["amine", "Omar"]);
  });

  it("does not mutate the board it is given", () => {
    const start = boardWith([entry()]);
    const snapshot = JSON.stringify(start);
    submitScore(start, { ...entry(), score: 24_000, at: 999 }, 2);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});

describe("publicBoard", () => {
  it("never leaks player ids", () => {
    const view = publicBoard(boardWith([entry(), entry({ id: ID_B, name: "Omar" })]), ID_A);
    expect(JSON.stringify(view)).not.toContain(ID_A);
    expect(JSON.stringify(view)).not.toContain(ID_B);
    expect(view.entries.map((row) => row.rank)).toEqual([1, 2]);
  });

  it("marks the viewer's own row", () => {
    const view = publicBoard(
      boardWith([entry({ score: 20_000 }), entry({ id: ID_B, name: "Omar", score: 10_000 })]),
      ID_B,
    );
    expect(view.entries.map((row) => row.you)).toEqual([false, true]);
    expect(view.you?.rank).toBe(2);
    expect(view.you?.name).toBe("Omar");
  });

  it("still reports the viewer's rank when they are outside the top ten", () => {
    const scores = Array.from({ length: BOARD_SIZE + 5 }, (_, index) =>
      entry({
        id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
        name: `p${index}`,
        score: 20_000 - index,
        at: 1 + index,
      }),
    );
    const view = publicBoard(boardWith(scores), "00000012-1111-4111-8111-111111111111");
    expect(view.entries).toHaveLength(BOARD_SIZE);
    expect(view.you?.rank).toBe(13);
    expect(view.total).toBe(BOARD_SIZE + 5);
  });

  it("has no personal row for a new player", () => {
    const view = publicBoard(boardWith([entry()]), null);
    expect(view.you).toBeNull();
    expect(view.entries).toHaveLength(1);
  });
});

describe("challenge boards", () => {
  const submission = { ...entry(), at: 100 };

  it("creates a board for a shared link, separate from the global one", () => {
    const board = submitChallengeScore(emptyBoard(0), "share123", "street", submission, 5);
    expect(board.challenges).toHaveLength(1);
    expect(board.challenges[0]?.seed).toBe("share123");
    expect(board.challenges[0]?.mode).toBe("street");
    expect(board.challenges[0]?.createdAt).toBe(5);
    // Challenge rows only reach the global board when the caller adds them.
    expect(board.scores).toEqual([]);
  });

  it("keeps one row per player per challenge, keeping the best", () => {
    let board = submitChallengeScore(emptyBoard(0), "share123", "photos", submission, 1);
    board = submitChallengeScore(
      board,
      "share123",
      "photos",
      { ...submission, score: 20_000, at: 200 },
      2,
    );
    board = submitChallengeScore(
      board,
      "share123",
      "photos",
      { ...submission, score: 5_000, at: 300 },
      3,
    );
    expect(board.challenges[0]?.scores).toHaveLength(1);
    expect(board.challenges[0]?.scores[0]?.score).toBe(20_000);
  });

  it("keeps different links apart", () => {
    let board = submitChallengeScore(emptyBoard(0), "share123", "street", submission, 1);
    board = submitChallengeScore(
      board,
      "share456",
      "street",
      { ...submission, id: ID_B, name: "Omar", score: 9_000 },
      2,
    );
    expect(publicChallenge(board, "share123", "street", ID_A).total).toBe(1);
    expect(publicChallenge(board, "share456", "street", ID_A).total).toBe(1);
    expect(publicChallenge(board, "share789", "street", ID_A).entries).toEqual([]);
    expect(publicChallenge(board, "share123", "street", ID_A).you?.name).toBe("amine");
  });

  it("keeps a street and a photo board apart even when they share a seed", () => {
    let board = submitChallengeScore(emptyBoard(0), "share123", "street", submission, 1);
    board = submitChallengeScore(
      board,
      "share123",
      "photos",
      { ...submission, id: ID_B, name: "Omar", score: 9_000 },
      2,
    );
    expect(board.challenges).toHaveLength(2);
    expect(publicChallenge(board, "share123", "street", ID_A).total).toBe(1);
    expect(publicChallenge(board, "share123", "photos", ID_A).total).toBe(1);
    expect(publicChallenge(board, "share123", "photos", ID_A).you).toBeNull();
    expect(publicChallenge(board, "share123", "photos", ID_B).you?.name).toBe("Omar");
  });

  it("moves a replayed link to the front and evicts the oldest", () => {
    let board = submitChallengeScore(emptyBoard(0), "oldseed1", "street", submission, 1);
    for (let index = 0; index < MAX_CHALLENGES + 2; index++) {
      board = submitChallengeScore(
        board,
        `seed${String(index).padStart(4, "0")}`,
        "street",
        { ...submission, id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111` },
        10 + index,
      );
    }
    expect(board.challenges).toHaveLength(MAX_CHALLENGES);
    expect(board.challenges[0]?.seed).toBe(`seed${String(MAX_CHALLENGES + 1).padStart(4, "0")}`);
    expect(board.challenges.some((challenge) => challenge.seed === "oldseed1")).toBe(false);
  });

  it("caps the rows kept per link", () => {
    let board = emptyBoard(0);
    for (let index = 0; index < CHALLENGE_ENTRIES + 10; index++) {
      board = submitChallengeScore(
        board,
        "share123",
        "photos",
        {
          ...submission,
          id: `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
          score: index,
        },
        1 + index,
      );
    }
    expect(board.challenges[0]?.scores).toHaveLength(CHALLENGE_ENTRIES);
    expect(board.challenges[0]?.scores[0]?.score).toBe(CHALLENGE_ENTRIES + 9);
  });

  it("round-trips through the bin, and reads a board written without challenges", () => {
    const board = submitChallengeScore(emptyBoard(0), "share123", "photos", submission, 5);
    expect(parseBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);

    const legacy = parseBoard({ v: 1, game: "bladi", updatedAt: 1, scores: [entry()] }, 0);
    expect(legacy.challenges).toEqual([]);
    expect(legacy.scores).toHaveLength(1);
  });

  it("treats a board written before photo mode as a street board", () => {
    const board = parseBoard(
      { challenges: [{ seed: "share123", createdAt: 5, scores: [entry()] }] },
      0,
    );
    expect(board.challenges).toHaveLength(1);
    expect(board.challenges[0]?.mode).toBe("street");
    expect(publicChallenge(board, "share123", "street", ID_A).total).toBe(1);
    expect(publicChallenge(board, "share123", "photos", ID_A).total).toBe(0);
  });

  it("drops challenge rows with a bad seed but keeps the good ones", () => {
    const base = submitChallengeScore(emptyBoard(0), "share123", "street", submission, 5);
    const board = parseBoard(
      {
        ...base,
        challenges: [
          { seed: "not a seed", createdAt: 1, scores: [] },
          { seed: "other12", mode: "street", createdAt: 1, scores: "nope" }, // tolerated, empty
          ...base.challenges,
          { seed: "share123", mode: "street", createdAt: 2, scores: [] }, // duplicate
        ],
      },
      0,
    );
    expect(board.challenges).toHaveLength(2);
    expect(
      board.challenges.find((challenge) => challenge.seed === "share123")?.scores,
    ).toHaveLength(1);
  });

  it("never leaks ids from a challenge board", () => {
    const board = submitChallengeScore(emptyBoard(0), "share123", "street", submission, 5);
    expect(
      JSON.stringify(publicChallenge(board, "share123", "street", ID_A)),
    ).not.toContain(ID_A);
    expect(publicChallenge(board, "share123", "street", ID_A).you?.rank).toBe(1);
  });

  it("detects whether a write would change anything", () => {
    const board = submitChallengeScore(emptyBoard(0), "share123", "street", submission, 5);
    const same = submitChallengeScore(board, "share123", "street", submission, 6);
    expect(sameContent(board, same)).toBe(true);

    const better = submitChallengeScore(
      board,
      "share123",
      "street",
      { ...submission, score: 20_000 },
      7,
    );
    expect(sameContent(board, better)).toBe(false);
  });
});
