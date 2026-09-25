import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_SHORTS = 4;

const FREE_DAILY_UPLOAD_LIMIT = 1;

const PROJECT_ROOT = process.cwd();

const UPLOAD_DIR = path.join(
  PROJECT_ROOT,
  "uploads"
);

const USAGE_FILE = path.join(
  PROJECT_ROOT,
  "uploads",
  "usage.json"
);

const WHISPER_EXE = path.join(
  PROJECT_ROOT,
  "whisper.cpp",
  "build",
  "bin",
  ...(process.platform === "win32" ? ["Release", "whisper-cli.exe"] : ["whisper-cli"])
);

const WHISPER_MODEL = path.join(
  PROJECT_ROOT,
  "whisper.cpp",
  "ggml-base.en.bin"
);

type UsageData = {
  date: string;
  uploads: number;
};

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

type Short = {
  id: number;
  start: number;
  end: number;
  duration: number;
  startTime: string;
  endTime: string;
  title: string;
  transcript: string;
  score: number;
  caption?: string;
  filename?: string;
  path?: string;
};

/*
 * STEP 5:
 *
 * Get today's date.
 */
function getToday() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/*
 * STEP 5:
 *
 * Read today's free-plan usage.
 *
 * If the date changed, automatically
 * reset the daily counter.
 */
async function getUsage(): Promise<UsageData> {
  try {
    const data = await fs.readFile(
      USAGE_FILE,
      "utf8"
    );

    const usage =
      JSON.parse(data) as UsageData;

    if (
      usage.date !== getToday()
    ) {
      return {
        date: getToday(),
        uploads: 0,
      };
    }

    return usage;
  } catch {
    return {
      date: getToday(),
      uploads: 0,
    };
  }
}

/*
 * STEP 5:
 *
 * Save today's free-plan usage.
 */
async function saveUsage(
  usage: UsageData
) {
  await fs.mkdir(
    UPLOAD_DIR,
    {
      recursive: true,
    }
  );

  await fs.writeFile(
    USAGE_FILE,
    JSON.stringify(
      usage,
      null,
      2
    ),
    "utf8"
  );
}

function runCommand(
  command: string,
  args: string[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(
      `[COMMAND] ${command} ${args.join(" ")}`
    );

    const child = spawn(command, args, {
      windowsHide: true,
    });

    let stderr = "";

    child.stdout.on("data", (data) => {
      console.log(data.toString());
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} failed with code ${code}\n${stderr}`
          )
        );
        return;
      }

      resolve();
    });
  });
}

function runWhisper(
  audioPath: string,
  outputSrtPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputBase =
      outputSrtPath.replace(
        /\.srt$/i,
        ""
      );

    const args = [
      "-m",
      WHISPER_MODEL,

      "-f",
      audioPath,

      "--output-srt",

      "--output-file",
      outputBase,

      "--print-progress",
    ];

    console.log("Starting Whisper...");
    console.log(
      "Whisper executable:",
      WHISPER_EXE
    );
    console.log(
      "Whisper model:",
      WHISPER_MODEL
    );

    const whisper = spawn(
      WHISPER_EXE,
      args,
      {
        windowsHide: true,
      }
    );

    let stderr = "";

    whisper.stdout.on("data", (data) => {
      console.log(data.toString());
    });

    whisper.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    whisper.on("error", (error) => {
      reject(error);
    });

    whisper.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Whisper failed with code ${code}\n${stderr}`
          )
        );
        return;
      }

      resolve();
    });
  });
}

function srtTimeToSeconds(
  time: string
): number {
  const match = time.match(
    /(\d+):(\d+):(\d+),(\d+)/
  );

  if (!match) {
    return 0;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);

  return (
    hours * 3600 +
    minutes * 60 +
    seconds +
    milliseconds / 1000
  );
}

function parseSrt(
  srt: string
): TranscriptSegment[] {
  const blocks = srt
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");

    const timeLineIndex =
      lines.findIndex((line) =>
        line.includes("-->")
      );

    if (timeLineIndex === -1) {
      continue;
    }

    const timeLine =
      lines[timeLineIndex];

    const parts = timeLine
      .split("-->")
      .map((value) =>
        value.trim()
      );

    if (parts.length !== 2) {
      continue;
    }

    const start =
      srtTimeToSeconds(parts[0]);

    const end =
      srtTimeToSeconds(parts[1]);

    const text = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      continue;
    }

    segments.push({
      start,
      end,
      text,
    });
  }

  return segments;
}

function secondsToSrtTime(
  seconds: number
): string {
  const totalMilliseconds =
    Math.max(
      0,
      Math.round(seconds * 1000)
    );

  const hours =
    Math.floor(
      totalMilliseconds /
        3600000
    );

  const minutes =
    Math.floor(
      (totalMilliseconds %
        3600000) /
        60000
    );

  const secs =
    Math.floor(
      (totalMilliseconds %
        60000) /
        1000
    );

  const milliseconds =
    totalMilliseconds % 1000;

  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(secs).padStart(2, "0") +
    "," +
    String(milliseconds).padStart(3, "0")
  );
}

/*
 * Create an SRT for a specific Short.
 *
 * IMPORTANT:
 *
 * This file is NOT burned into the video.
 */
async function createShortSrt(
  segments: TranscriptSegment[],
  shortStart: number,
  shortEnd: number,
  outputPath: string
): Promise<void> {
  const relevant =
    segments.filter(
      (segment) =>
        segment.end > shortStart &&
        segment.start < shortEnd
    );

  const blocks: string[] = [];

  let index = 1;

  for (const segment of relevant) {
    const start =
      Math.max(
        segment.start,
        shortStart
      );

    const end =
      Math.min(
        segment.end,
        shortEnd
      );

    if (end <= start) {
      continue;
    }

    const relativeStart =
      start - shortStart;

    const relativeEnd =
      end - shortStart;

    blocks.push(
      [
        String(index),

        `${secondsToSrtTime(
          relativeStart
        )} --> ${secondsToSrtTime(
          relativeEnd
        )}`,

        segment.text,

        "",
      ].join("\n")
    );

    index++;
  }

  await fs.writeFile(
    outputPath,
    blocks.join("\n"),
    "utf8"
  );
}

/*
 * Create the vertical Short.
 */
async function createShort(
  inputPath: string,
  outputPath: string,
  start: number,
  duration: number
): Promise<void> {
  const filterComplex =
    "[0:v]split=2[background][foreground];" +

    "[background]" +
    "scale=1080:1920:force_original_aspect_ratio=increase," +
    "crop=1080:1920," +
    "boxblur=30:10," +
    "eq=brightness=-0.15:saturation=0.85" +
    "[bg];" +

    "[foreground]" +
    "scale=980:551:force_original_aspect_ratio=decrease" +
    "[fg];" +

    "[bg][fg]" +
    "overlay=" +
    "(W-w)/2:" +
    "(H-h)/2" +
    "[video]";

  await runCommand(
    "ffmpeg",
    [
      "-y",

      "-ss",
      String(start),

      "-i",
      inputPath,

      "-t",
      String(duration),

      "-filter_complex",
      filterComplex,

      "-map",
      "[video]",

      "-map",
      "0:a?",

      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

      "-crf",
      "23",

      "-pix_fmt",
      "yuv420p",

      "-c:a",
      "aac",

      "-b:a",
      "128k",

      "-movflags",
      "+faststart",

      outputPath,
    ]
  );
}

export async function POST(
  request: Request
) {
  let audioPath: string | null =
    null;

  let srtPath: string | null =
    null;

  try {
    await fs.mkdir(
      UPLOAD_DIR,
      {
        recursive: true,
      }
    );

    const formData =
      await request.formData();

    const file =
      formData.get("video");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error:
            "No video file was provided.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * STEP 5:
     *
     * FREE PLAN:
     *
     * Allow only one video upload
     * per calendar day.
     */
    const usage =
      await getUsage();

    if (
      usage.uploads >=
      FREE_DAILY_UPLOAD_LIMIT
    ) {
      return NextResponse.json(
        {
          error:
            "Daily free upload limit reached.",

          code:
            "DAILY_LIMIT_REACHED",

          limit:
            FREE_DAILY_UPLOAD_LIMIT,

          used:
            usage.uploads,

          date:
            usage.date,
        },
        {
          status: 429,
        }
      );
    }

    if (
      !file.type.startsWith(
        "video/"
      )
    ) {
      return NextResponse.json(
        {
          error:
            "The uploaded file is not a video.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      file.size >
      MAX_FILE_SIZE
    ) {
      return NextResponse.json(
        {
          error:
            "The video file is too large. Maximum size is 2 GB.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Save uploaded video.
     */

    const safeName =
      file.name.replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );

    const filename =
      `${Date.now()}-${safeName}`;

    const filePath =
      path.join(
        UPLOAD_DIR,
        filename
      );

    const bytes =
      await file.arrayBuffer();

    await fs.writeFile(
      filePath,
      Buffer.from(bytes)
    );

    console.log(
      "Video saved:",
      filePath
    );

    /*
     * Extract audio for Whisper.
     */

    audioPath =
      path.join(
        UPLOAD_DIR,
        `${Date.now()}-audio.wav`
      );

    await runCommand(
      "ffmpeg",
      [
        "-y",

        "-i",
        filePath,

        "-vn",

        "-ac",
        "1",

        "-ar",
        "16000",

        "-c:a",
        "pcm_s16le",

        audioPath,
      ]
    );

    console.log(
      "Audio extracted:",
      audioPath
    );

    /*
     * Run Whisper.
     */

    srtPath =
      path.join(
        UPLOAD_DIR,
        `${Date.now()}-transcript.srt`
      );

    await runWhisper(
      audioPath,
      srtPath
    );

    console.log(
      "Whisper transcript generated."
    );

    /*
     * Read transcript.
     */

    const srt =
      await fs.readFile(
        srtPath,
        "utf8"
      );

    const segments =
      parseSrt(srt);

    console.log(
      `Parsed ${segments.length} transcript segments.`
    );

    if (
      segments.length === 0
    ) {
      throw new Error(
        "Whisper did not produce any transcript segments."
      );
    }

    /*
     * Ask analyzer to find Shorts.
     */

    const analyzeResponse =
      await fetch(
        "http://localhost:3000/api/analyze",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            segments,
          }),
        }
      );

    const analysis =
      await analyzeResponse.json();

    if (
      !analyzeResponse.ok
    ) {
      throw new Error(
        analysis.error ||
          "Video analysis failed."
      );
    }

    let shorts: Short[] =
      Array.isArray(
        analysis.shorts
      )
        ? analysis.shorts
        : [];

    /*
     * Safety:
     *
     * Only generate four Shorts.
     */

    shorts =
      shorts
        .filter(
          (short) =>
            Number.isFinite(
              short.start
            ) &&
            Number.isFinite(
              short.end
            ) &&
            short.end >
              short.start
        )
        .slice(
          0,
          MAX_SHORTS
        );

    console.log(
      `Using ${shorts.length} Shorts.`
    );

    if (
      shorts.length === 0
    ) {
      throw new Error(
        "The analyzer did not find any valid Shorts."
      );
    }

    /*
     * Shorts directory.
     */

    const shortsDir =
      path.join(
        UPLOAD_DIR,
        "shorts"
      );

    await fs.mkdir(
      shortsDir,
      {
        recursive: true,
      }
    );

    /*
     * Generate actual MP4 Shorts.
     */

    const generatedShorts: Short[] =
      [];

    for (
      let i = 0;
      i < shorts.length;
      i++
    ) {
      const short =
        shorts[i];

      const shortNumber =
        i + 1;

      const timestamp =
        Date.now();

      const outputFilename =
        `${timestamp}-short-${shortNumber}.mp4`;

      const outputPath =
        path.join(
          shortsDir,
          outputFilename
        );

      const subtitleFilename =
        `${timestamp}-short-${shortNumber}.srt`;

      const subtitlePath =
        path.join(
          UPLOAD_DIR,
          subtitleFilename
        );

      const duration =
        short.end -
        short.start;

      /*
       * Keep Shorts between 1 and 90 sec.
       */

      const safeDuration =
        Math.min(
          Math.max(
            duration,
            1
          ),
          90
        );

      console.log(
        `Creating Short ${shortNumber}: ` +
          `${short.start}s → ` +
          `${short.start + safeDuration}s`
      );

      /*
       * Create transcript file.
       */

      await createShortSrt(
        segments,
        short.start,
        short.end,
        subtitlePath
      );

      /*
       * Create vertical video.
       */

      await createShort(
        filePath,
        outputPath,
        short.start,
        safeDuration
      );

      console.log(
        `Short ${shortNumber} created:`,
        outputPath
      );

      generatedShorts.push({
        ...short,

        id: shortNumber,

        duration:
          safeDuration,

        filename:
          outputFilename,

        path:
          outputPath,
      });

      /*
       * Delete temporary SRT.
       */

      try {
        await fs.unlink(
          subtitlePath
        );
      } catch {
        // Ignore cleanup errors.
      }
    }

    /*
     * STEP 5:
     *
     * Count upload only after successful
     * Short generation.
     */

    const updatedUsage =
      await getUsage();

    updatedUsage.uploads += 1;

    await saveUsage(
      updatedUsage
    );

    console.log(
      `Free-plan usage: ${updatedUsage.uploads}/${FREE_DAILY_UPLOAD_LIMIT} videos today.`
    );

    /*
     * Delete temporary audio.
     */

    try {
      if (audioPath) {
        await fs.unlink(
          audioPath
        );
      }
    } catch {
      // Ignore cleanup errors.
    }

    /*
     * Delete Whisper SRT.
     */

    try {
      if (srtPath) {
        await fs.unlink(
          srtPath
        );
      }
    } catch {
      // Ignore cleanup errors.
    }

    /*
     * Return results.
     */

    return NextResponse.json({
      success: true,

      filename,

      videoPath:
        filePath,

      transcript:
        segments,

      plan: {
        name: "Free",

        dailyUploadLimit:
          FREE_DAILY_UPLOAD_LIMIT,

        uploadsToday:
          updatedUsage.uploads,

        uploadsRemaining:
          Math.max(
            0,
            FREE_DAILY_UPLOAD_LIMIT -
              updatedUsage.uploads
          ),

        maxShorts:
          MAX_SHORTS,
      },

      shorts:
        generatedShorts,
    });
  } catch (error) {
    console.error(
      "Upload processing error:",
      error
    );

    try {
      if (audioPath) {
        await fs.unlink(
          audioPath
        );
      }
    } catch {
      // Ignore.
    }

    try {
      if (srtPath) {
        await fs.unlink(
          srtPath
        );
      }
    } catch {
      // Ignore.
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed.",
      },
      {
        status: 500,
      }
    );
  }
}