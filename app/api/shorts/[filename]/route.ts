import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const SHORTS_DIR = path.join(
  process.cwd(),
  "uploads",
  "shorts"
);

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      filename: string;
    }>;
  }
) {
  try {
    const { filename } =
      await context.params;

    /*
     * Security:
     *
     * Only allow a plain filename.
     * Prevent:
     *
     * ../
     * ..\
     * absolute paths
     * other directories
     */
    const safeFilename =
      path.basename(filename);

    if (
      safeFilename !== filename ||
      !safeFilename
        .toLowerCase()
        .endsWith(".mp4")
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid video filename.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * Build the final path.
     */
    const filePath =
      path.join(
        SHORTS_DIR,
        safeFilename
      );

    /*
     * Verify the file exists.
     */
    const stat =
      await fs.stat(filePath);

    if (!stat.isFile()) {
      return NextResponse.json(
        {
          error:
            "Short not found.",
        },
        {
          status: 404,
        }
      );
    }

    const fileSize =
      stat.size;

    /*
     * Support HTTP Range requests.
     *
     * This is important for:
     *
     * - <video> playback
     * - seeking
     * - downloading
     * - large files
     */
    const range =
      request.headers.get(
        "range"
      );

    /*
     * No Range header:
     *
     * Return the entire file.
     */
    if (!range) {
      const file =
        await fs.readFile(
          filePath
        );

      return new NextResponse(
        file,
        {
          status: 200,

          headers: {
            "Content-Type":
              "video/mp4",

            "Content-Length":
              String(fileSize),

            "Accept-Ranges":
              "bytes",

            "Content-Disposition":
              `attachment; filename="${safeFilename}"`,

            "Cache-Control":
              "private, max-age=3600",
          },
        }
      );
    }

    /*
     * Parse:
     *
     * Range: bytes=START-END
     */
    const match =
      range.match(
        /bytes=(\d*)-(\d*)/
      );

    if (!match) {
      return new NextResponse(
        null,
        {
          status: 416,

          headers: {
            "Content-Range":
              `bytes */${fileSize}`,
          },
        }
      );
    }

    const startString =
      match[1];

    const endString =
      match[2];

    let start: number;
    let end: number;

    /*
     * Example:
     *
     * bytes=500-
     */
    if (
      startString &&
      !endString
    ) {
      start =
        Number(startString);

      end =
        fileSize - 1;
    }

    /*
     * Example:
     *
     * bytes=-500
     *
     * Means the final 500 bytes.
     */
    else if (
      !startString &&
      endString
    ) {
      const suffixLength =
        Number(endString);

      if (
        !Number.isFinite(
          suffixLength
        ) ||
        suffixLength <= 0
      ) {
        return new NextResponse(
          null,
          {
            status: 416,

            headers: {
              "Content-Range":
                `bytes */${fileSize}`,
            },
          }
        );
      }

      start =
        Math.max(
          fileSize -
            suffixLength,
          0
        );

      end =
        fileSize - 1;
    }

    /*
     * Example:
     *
     * bytes=500-999
     */
    else {
      start =
        Number(startString);

      end =
        Number(endString);
    }

    /*
     * Validate range.
     */
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start >= fileSize
    ) {
      return new NextResponse(
        null,
        {
          status: 416,

          headers: {
            "Content-Range":
              `bytes */${fileSize}`,
          },
        }
      );
    }

    /*
     * Never allow the end beyond the file.
     */
    end =
      Math.min(
        end,
        fileSize - 1
      );

    const chunkSize =
      end - start + 1;

    /*
     * Read only the requested
     * section of the file.
     *
     * This is much better for
     * video seeking than always
     * loading the entire MP4.
     */
    const fileHandle =
      await fs.open(
        filePath,
        "r"
      );

    try {
      const buffer =
        Buffer.alloc(
          chunkSize
        );

      await fileHandle.read(
        buffer,
        0,
        chunkSize,
        start
      );

      return new NextResponse(
        buffer,
        {
          status: 206,

          headers: {
            "Content-Type":
              "video/mp4",

            "Content-Length":
              String(chunkSize),

            "Content-Range":
              `bytes ${start}-${end}/${fileSize}`,

            "Accept-Ranges":
              "bytes",

            "Content-Disposition":
              `inline; filename="${safeFilename}"`,

            "Cache-Control":
              "private, max-age=3600",
          },
        }
      );
    } finally {
      await fileHandle.close();
    }
  } catch (error) {
    console.error(
      "Short video error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Short not found.",
      },
      {
        status: 404,
      }
    );
  }
}