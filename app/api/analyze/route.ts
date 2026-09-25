import { NextResponse } from "next/server";

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

type Candidate = {
  start: number;
  end: number;
  text: string;
  score: number;
};

const MAX_SHORTS = 4;
const MIN_DURATION = 20;
const IDEAL_MIN = 28;
const IDEAL_MAX = 50;
const MAX_DURATION = 60;

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string) {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

function cleanWord(word: string) {
  return word
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
}

function getLastWord(text: string) {
  const words = normalizeText(text).split(/\s+/);
  return cleanWord(words[words.length - 1] || "");
}

function getFirstWord(text: string) {
  const words = normalizeText(text).split(/\s+/);
  return cleanWord(words[0] || "");
}

/*
 * Words that often indicate a useful moment.
 */
const HIGH_VALUE_WORDS = [
  "wait",
  "whoa",
  "wow",
  "look",
  "listen",
  "watch",
  "finally",
  "actually",
  "literally",
  "insane",
  "crazy",
  "unbelievable",
  "incredible",
  "impossible",
  "secret",
  "important",
  "problem",
  "mistake",
  "wrong",
  "right",
  "danger",
  "dangerous",
  "attack",
  "attacked",
  "fight",
  "fighting",
  "battle",
  "escape",
  "survive",
  "survived",
  "destroy",
  "destroyed",
  "win",
  "won",
  "winning",
  "lose",
  "lost",
  "failed",
  "failure",
  "success",
  "million",
  "thousand",
  "hundred",
  "best",
  "worst",
  "first",
  "last",
  "never",
  "always",
  "secret",
  "reason",
  "because",
  "why",
  "how",
];

const WEAK_STARTS = new Set([
  "and",
  "but",
  "because",
  "then",
  "which",
  "that",
  "or",
  "also",
  "like",
  "so",
  "than",
]);

const WEAK_ENDS = new Set([
  "and",
  "but",
  "because",
  "so",
  "or",
  "that",
  "which",
  "if",
  "when",
  "then",
  "to",
  "of",
  "with",
  "for",
  "from",
  "in",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "a",
  "an",
  "the",
]);

function hasStrongHook(text: string) {
  const clean = normalizeText(text);

  return HIGH_VALUE_WORDS.some((word) =>
    clean.includes(word)
  );
}

function countHookWords(text: string) {
  const clean = normalizeText(text);

  let count = 0;

  for (const word of HIGH_VALUE_WORDS) {
    if (clean.includes(word)) {
      count++;
    }
  }

  return count;
}

function looksLikeQuestion(text: string) {
  return normalizeText(text).includes("?");
}

function looksLikeExcitement(text: string) {
  return normalizeText(text).includes("!");
}

function hasNumber(text: string) {
  return /\b\d+(?:[,.]\d+)?\b/.test(text);
}

function isWeakStart(text: string) {
  const first = getFirstWord(text);

  return WEAK_STARTS.has(first);
}

function isWeakEnd(text: string) {
  const last = getLastWord(text);

  return WEAK_ENDS.has(last);
}

/*
 * Whisper segments don't always contain punctuation
 * reliably, so punctuation is useful but never required.
 */
function hasNaturalEnding(
  segment: TranscriptSegment
) {
  const text = segment.text.trim();

  if (!text) {
    return false;
  }

  if (/[.!?]["')\]]?$/.test(text)) {
    return true;
  }

  return !isWeakEnd(text);
}

/*
 * Score a single transcript segment.
 */
function scoreSegment(
  segment: TranscriptSegment
) {
  const text = normalizeText(segment.text);

  let score = 0;

  const hooks = countHookWords(text);

  score += hooks * 4;

  if (looksLikeQuestion(text)) {
    score += 5;
  }

  if (looksLikeExcitement(text)) {
    score += 3;
  }

  if (hasNumber(text)) {
    score += 2;
  }

  if (text.length >= 35) {
    score += 2;
  }

  if (text.length >= 70) {
    score += 2;
  }

  if (text.length < 12) {
    score -= 4;
  }

  if (isWeakStart(text)) {
    score -= 4;
  }

  if (isWeakEnd(text)) {
    score -= 3;
  }

  return score;
}

/*
 * Give a candidate a score based on:
 *
 * - hook
 * - duration
 * - coherence
 * - information density
 * - natural ending
 */
function scoreCandidate(
  segments: TranscriptSegment[],
  startIndex: number,
  endIndex: number,
  start: number,
  end: number,
  text: string
) {
  const duration = end - start;

  let score = 0;

  const normalized = normalizeText(text);

  /*
   * Segment-level content score.
   */
  for (
    let i = startIndex;
    i <= endIndex;
    i++
  ) {
    score += scoreSegment(segments[i]);
  }

  /*
   * Duration.
   *
   * Prefer roughly 28–50 seconds.
   */
  if (
    duration >= IDEAL_MIN &&
    duration <= IDEAL_MAX
  ) {
    score += 10;
  } else if (
    duration >= 24 &&
    duration < IDEAL_MIN
  ) {
    score += 5;
  } else if (
    duration > IDEAL_MAX &&
    duration <= 55
  ) {
    score += 6;
  } else if (duration > 55) {
    score -= 4;
  }

  /*
   * Word count.
   */
  const words = wordCount(normalized);

  if (words >= 55 && words <= 170) {
    score += 7;
  } else if (words >= 35 && words < 55) {
    score += 3;
  } else if (words > 170 && words <= 220) {
    score += 2;
  } else if (words < 25) {
    score -= 5;
  }

  /*
   * Hook near the beginning.
   *
   * This matters a lot for Shorts.
   */
  const firstFewSegments =
    segments.slice(
      startIndex,
      Math.min(
        endIndex + 1,
        startIndex + 3
      )
    );

  const openingText =
    firstFewSegments
      .map((segment) => segment.text)
      .join(" ");

  if (hasStrongHook(openingText)) {
    score += 10;
  }

  /*
   * Curiosity / emotional punctuation.
   */
  if (looksLikeQuestion(openingText)) {
    score += 4;
  }

  if (looksLikeExcitement(openingText)) {
    score += 3;
  }

  /*
   * Numbers often make strong factual/story hooks.
   */
  if (hasNumber(openingText)) {
    score += 2;
  }

  /*
   * Strong ending.
   */
  const lastSegment =
    segments[endIndex];

  if (hasNaturalEnding(lastSegment)) {
    score += 6;
  } else {
    score -= 6;
  }

  /*
   * Penalize obvious continuation starts.
   */
  if (isWeakStart(segments[startIndex].text)) {
    score -= 8;
  }

  /*
   * Penalize extremely long clips.
   */
  if (duration > MAX_DURATION) {
    score -= 100;
  }

  return score;
}

/*
 * Build candidate clips.
 *
 * Instead of blindly making every possible
 * combination, we consider sensible windows.
 */
function buildCandidates(
  segments: TranscriptSegment[]
) {
  const candidates: Candidate[] = [];

  for (
    let startIndex = 0;
    startIndex < segments.length;
    startIndex++
  ) {
    const startSegment =
      segments[startIndex];

    /*
     * Don't begin on an obvious continuation.
     */
    if (
      isWeakStart(
        startSegment.text
      )
    ) {
      continue;
    }

    const start =
      startSegment.start;

    let combinedText = "";

    for (
      let endIndex = startIndex;
      endIndex < segments.length;
      endIndex++
    ) {
      const current =
        segments[endIndex];

      const end = current.end;

      const duration =
        end - start;

      if (duration > MAX_DURATION) {
        break;
      }

      combinedText +=
        `${current.text} `;

      /*
       * Don't consider tiny clips.
       */
      if (duration < MIN_DURATION) {
        continue;
      }

      /*
       * Only consider reasonable ending points.
       */
      if (
        !hasNaturalEnding(current)
      ) {
        continue;
      }

      /*
       * Don't make candidates ridiculously
       * short in terms of spoken content.
       */
      if (
        wordCount(combinedText) < 25
      ) {
        continue;
      }

      const score =
        scoreCandidate(
          segments,
          startIndex,
          endIndex,
          start,
          end,
          combinedText
        );

      candidates.push({
        start,
        end,
        text:
          combinedText.trim(),
        score,
      });
    }
  }

  return candidates;
}

/*
 * Calculate how much two clips overlap.
 */
function overlapRatio(
  a: Candidate,
  b: Candidate
) {
  const overlapStart =
    Math.max(a.start, b.start);

  const overlapEnd =
    Math.min(a.end, b.end);

  const overlap =
    Math.max(
      0,
      overlapEnd - overlapStart
    );

  if (overlap === 0) {
    return 0;
  }

  const shorter =
    Math.min(
      a.end - a.start,
      b.end - b.start
    );

  if (shorter <= 0) {
    return 0;
  }

  return overlap / shorter;
}

/*
 * Content similarity using meaningful words.
 */
function contentSimilarity(
  a: Candidate,
  b: Candidate
) {
  const aWords = new Set(
    normalizeText(a.text)
      .split(/\s+/)
      .map(cleanWord)
      .filter(
        (word) =>
          word.length >= 5
      )
  );

  const bWords = new Set(
    normalizeText(b.text)
      .split(/\s+/)
      .map(cleanWord)
      .filter(
        (word) =>
          word.length >= 5
      )
  );

  if (
    aWords.size === 0 ||
    bWords.size === 0
  ) {
    return 0;
  }

  let common = 0;

  for (const word of aWords) {
    if (bWords.has(word)) {
      common++;
    }
  }

  /*
   * Compare against the smaller set.
   */
  return (
    common /
    Math.min(
      aWords.size,
      bWords.size
    )
  );
}

/*
 * Determine whether two candidates are
 * too similar to both be selected.
 */
function isTooSimilar(
  a: Candidate,
  b: Candidate
) {
  /*
   * Heavy timeline overlap.
   */
  if (
    overlapRatio(a, b) > 0.25
  ) {
    return true;
  }

  /*
   * Very similar transcript.
   */
  if (
    contentSimilarity(a, b) > 0.65
  ) {
    return true;
  }

  return false;
}

/*
 * Prefer candidates that are spread throughout
 * the original video rather than four moments
 * from the same minute.
 */
function distancePenalty(
  candidate: Candidate,
  selected: Candidate[]
) {
  let penalty = 0;

  for (const existing of selected) {
    const distance =
      Math.abs(
        candidate.start -
          existing.start
      );

    /*
     * If two clips begin within 90 seconds,
     * slightly discourage the later one.
     *
     * We don't reject it completely because
     * sometimes two great moments are close together.
     */
    if (distance < 90) {
      penalty +=
        (90 - distance) / 15;
    }
  }

  return penalty;
}

function formatTime(
  seconds: number
) {
  const minutes =
    Math.floor(seconds / 60);

  const remainingSeconds =
    Math.floor(seconds % 60);

  return `${minutes}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const segments =
      body.segments as TranscriptSegment[];

    if (
      !Array.isArray(segments) ||
      segments.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No transcript segments were provided.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Validate and sort transcript.
     */
    const validSegments =
      segments
        .filter(
          (segment) =>
            typeof segment.start ===
              "number" &&
            typeof segment.end ===
              "number" &&
            Number.isFinite(
              segment.start
            ) &&
            Number.isFinite(
              segment.end
            ) &&
            segment.end >
              segment.start &&
            typeof segment.text ===
              "string" &&
            segment.text.trim()
              .length > 0
        )
        .sort(
          (a, b) =>
            a.start - b.start
        );

    if (
      validSegments.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Transcript segments were invalid.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Generate possible clips.
     */
    const candidates =
      buildCandidates(
        validSegments
      );

    console.log(
      `Generated ${candidates.length} possible Shorts.`
    );

    if (
      candidates.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Could not find suitable Shorts in this video.",
        },
        {
          status: 422,
        }
      );
    }

    /*
     * Sort strongest candidates first.
     */
    const ranked =
      candidates.sort(
        (a, b) =>
          b.score - a.score
      );

    /*
     * Select the best four while balancing:
     *
     * - score
     * - uniqueness
     * - timeline distribution
     */
    const selected: Candidate[] =
      [];

    for (
      const candidate of ranked
    ) {
      if (
        selected.length >= MAX_SHORTS
      ) {
        break;
      }

      /*
       * Don't select overlapping /
       * nearly identical clips.
       */
      const duplicate =
        selected.some(
          (existing) =>
            isTooSimilar(
              candidate,
              existing
            )
        );

      if (duplicate) {
        continue;
      }

      /*
       * Adjust for clustering.
       */
      const adjustedScore =
        candidate.score -
        distancePenalty(
          candidate,
          selected
        );

      /*
       * Attach the adjusted score
       * temporarily.
       */
      const adjustedCandidate = {
        ...candidate,
        score: adjustedScore,
      };

      selected.push(
        adjustedCandidate
      );
    }

    /*
     * Fallback:
     *
     * If strict filtering left us with
     * fewer than four, use the best remaining
     * non-overlapping candidates.
     */
    if (
      selected.length < MAX_SHORTS
    ) {
      for (
        const candidate of ranked
      ) {
        if (
          selected.length >=
          MAX_SHORTS
        ) {
          break;
        }

        const overlap =
          selected.some(
            (existing) =>
              overlapRatio(
                candidate,
                existing
              ) > 0.4
          );

        if (overlap) {
          continue;
        }

        selected.push(
          candidate
        );
      }
    }

    /*
     * Final chronological ordering.
     */
    selected.sort(
      (a, b) =>
        a.start - b.start
    );

    /*
     * Build API response.
     */
function createTitle(
  transcript: string,
  index: number
) {
  const text = transcript
    .replace(/\s+/g, " ")
    .trim();

  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let title =
    sentences[0] ||
    text;

  /*
   * Remove obvious filler at the beginning.
   */
  title = title.replace(
    /^(um|uh|okay|ok|so|well|and|but|like)\s+/i,
    ""
  );

  /*
   * Keep titles short enough for the UI.
   */
  const words = title
    .split(/\s+/)
    .filter(Boolean);

  if (words.length > 10) {
    title =
      words
        .slice(0, 10)
        .join(" ") +
      "...";
  }

  /*
   * Capitalize first letter.
   */
  if (title.length > 0) {
    title =
      title.charAt(0).toUpperCase() +
      title.slice(1);
  }

  /*
   * Fallback.
   */
  if (!title.trim()) {
    title = `Interesting moment ${index + 1}`;
  }

  return title;
}

function createCaption(
  transcript: string,
  index: number
) {
  const text = transcript
    .replace(/\s+/g, " ")
    .trim();

  const lower = text.toLowerCase();

  /*
   * Create captions from actual transcript content.
   */

  if (
    /\b(win|won|winning|victory)\b/.test(
      lower
    )
  ) {
    return "This is how the win happened 🔥";
  }

  if (
    /\b(lose|lost|losing|defeat)\b/.test(
      lower
    )
  ) {
    return "Things went completely wrong 😳";
  }

  if (
    /\b(attack|attacked|battle|fight|fighting)\b/.test(
      lower
    )
  ) {
    return "This turned into a serious battle ⚔️";
  }

  if (
    /\b(danger|dangerous|escape|survive|survived)\b/.test(
      lower
    )
  ) {
    return "This got dangerous really fast 😳";
  }

  if (
    /\b(mistake|wrong|failed|failure)\b/.test(
      lower
    )
  ) {
    return "One mistake changed everything 😬";
  }

  if (
    /\b(secret|reason|why|how)\b/.test(
      lower
    )
  ) {
    return "Here's what was really happening 👀";
  }

  if (
    /\b(insane|crazy|unbelievable|incredible)\b/.test(
      lower
    )
  ) {
    return "This moment was absolutely insane 🤯";
  }

  /*
   * Use the beginning of the actual transcript
   * rather than generating the same generic caption
   * for every Short.
   */
  const words = text
    .split(/\s+/)
    .filter(Boolean);

  let excerpt = words
    .slice(0, 8)
    .join(" ");

  if (excerpt.length > 70) {
    excerpt = excerpt.slice(0, 67) + "...";
  }

  if (!excerpt) {
    return `This moment is worth watching 👀`;
  }

  return `${excerpt} 👀`;
}

const shorts =
  selected.map(
    (short, index) => {
      const title =
        createTitle(
          short.text,
          index
        );

      const caption =
        createCaption(
          short.text,
          index
        );

      return {
        id: index + 1,

        start:
          short.start,

        end:
          short.end,

        duration:
          short.end -
          short.start,

        startTime:
          formatTime(
            short.start
          ),

        endTime:
          formatTime(
            short.end
          ),

        title,

        caption,

        transcript:
          short.text,

        score:
          Math.round(
            short.score
          ),
      };
    }
  );

    console.log(
      "Selected Shorts:",
      shorts.map(
        (short) => ({
          id: short.id,
          start: short.start,
          end: short.end,
          duration:
            short.duration,
          score:
            short.score,
        })
      )
    );

    return NextResponse.json({
      success: true,
      shorts,
    });
  } catch (error) {
    console.error(
      "Analyze error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to analyze transcript.",
      },
      {
        status: 500,
      }
    );
  }
}