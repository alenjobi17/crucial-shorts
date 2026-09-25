"use client";

import {
  ChangeEvent,
  useState,
} from "react";

const MAX_VIDEO_DURATION = 30 * 60;

const REQUIRED_ADS = 2;

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
  filename: string;
  path: string;
  caption?: string;
};

export default function Home() {
  const [file, setFile] =
    useState<File | null>(null);

  const [error, setError] =
    useState("");

  const [uploading, setUploading] =
    useState(false);

  const [uploadMessage, setUploadMessage] =
    useState("");

  const [shorts, setShorts] =
    useState<Short[]>([]);

  const [copiedId, setCopiedId] =
    useState<number | null>(null);

  /*
   * STEP 5:
   *
   * Free-plan usage.
   */
  const [uploadsToday, setUploadsToday] =
    useState(0);

  const [dailyUploadLimit, setDailyUploadLimit] =
    useState(1);

  const [uploadsRemaining, setUploadsRemaining] =
    useState(1);

  /*
   * STEP 6:
   *
   * Two ads are required before
   * downloading a Short.
   *
   * This is currently a TEST ad flow.
   *
   * Later the test completion function
   * can be replaced by the real ad
   * provider's completion callback.
   */
  const [adsWatched, setAdsWatched] =
    useState(0);

  const [showAdModal, setShowAdModal] =
    useState(false);

  const [adLoading, setAdLoading] =
    useState(false);

  const [downloadUnlocked, setDownloadUnlocked] =
    useState(false);

  /*
   * STEP 6:
   *
   * The Short the user originally
   * wanted to download.
   *
   * We keep this so after Ad 2 we
   * can automatically start that
   * download.
   */
  const [pendingDownload, setPendingDownload] =
    useState<Short | null>(null);

  const handleFileChange = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFile =
      event.target.files?.[0];

    setError("");
    setUploadMessage("");
    setShorts([]);
    setCopiedId(null);

    /*
     * STEP 6:
     *
     * Reset ad progress when a new
     * video is selected.
     */
    setAdsWatched(0);
    setShowAdModal(false);
    setAdLoading(false);
    setDownloadUnlocked(false);
    setPendingDownload(null);

    setFile(null);

    if (!selectedFile) {
      return;
    }

    if (
      !selectedFile.type.startsWith(
        "video/"
      )
    ) {
      setError(
        "Please select a valid video file."
      );
      return;
    }

    const video =
      document.createElement("video");

    const videoUrl =
      URL.createObjectURL(
        selectedFile
      );

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(
        videoUrl
      );

      if (
        !Number.isFinite(
          video.duration
        )
      ) {
        setError(
          "We couldn't determine the video's duration."
        );
        return;
      }

      if (
        video.duration >
        MAX_VIDEO_DURATION
      ) {
        setError(
          "Your video is longer than the 30-minute limit."
        );
        return;
      }

      setFile(selectedFile);
    };

    video.onerror = () => {
      URL.revokeObjectURL(
        videoUrl
      );

      setError(
        "This video could not be read. Please try another file."
      );
    };

    video.src = videoUrl;
  };

  const removeFile = () => {
    setFile(null);
    setError("");
    setUploadMessage("");
    setShorts([]);
    setCopiedId(null);

    /*
     * STEP 6:
     *
     * Reset ad requirement when the
     * current video is removed.
     */
    setAdsWatched(0);
    setShowAdModal(false);
    setAdLoading(false);
    setDownloadUnlocked(false);
    setPendingDownload(null);
  };

  const uploadVideo = async () => {
    if (!file || uploading) {
      return;
    }

    /*
     * STEP 5:
     *
     * Prevent upload from the frontend
     * after the daily free limit.
     *
     * The backend also enforces this.
     */
    if (uploadsRemaining <= 0) {
      setError(
        "You've already used your free video upload for today. Come back tomorrow."
      );
      return;
    }

    setUploading(true);
    setError("");
    setShorts([]);
    setCopiedId(null);

    /*
     * STEP 6:
     *
     * New processing session means
     * ads must be completed again.
     */
    setAdsWatched(0);
    setShowAdModal(false);
    setAdLoading(false);
    setDownloadUnlocked(false);
    setPendingDownload(null);

    setUploadMessage(
      "Uploading video and creating your Shorts..."
    );

    try {
      const formData =
        new FormData();

      formData.append(
        "video",
        file
      );

      const response =
        await fetch(
          "/api/upload",
          {
            method: "POST",
            body: formData,
          }
        );

      const data =
        await response.json();

      /*
       * STEP 5:
       *
       * Backend says the daily limit
       * has been reached.
       */
      if (
        response.status === 429 &&
        data.code ===
          "DAILY_LIMIT_REACHED"
      ) {
        setUploadsToday(
          data.used ?? 1
        );

        setDailyUploadLimit(
          data.limit ?? 1
        );

        setUploadsRemaining(0);

        throw new Error(
          "You've already used your free video upload for today. Come back tomorrow."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Video processing failed."
        );
      }

      if (
        !Array.isArray(
          data.shorts
        ) ||
        data.shorts.length === 0
      ) {
        throw new Error(
          "The server did not return any Shorts."
        );
      }

      /*
       * STEP 5:
       *
       * Update usage from the server.
       */
      if (data.plan) {
        setUploadsToday(
          data.plan.uploadsToday ??
            1
        );

        setDailyUploadLimit(
          data.plan.dailyUploadLimit ??
            1
        );

        setUploadsRemaining(
          data.plan.uploadsRemaining ??
            0
        );
      } else {
        setUploadsToday(1);
        setDailyUploadLimit(1);
        setUploadsRemaining(0);
      }

      setShorts(
        data.shorts
      );

      setUploadMessage(
        `Done! ${data.shorts.length} Shorts are ready.`
      );
    } catch (error) {
      setUploadMessage("");

      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong while creating the Shorts."
      );
    } finally {
      setUploading(false);
    }
  };

  const getShortUrl = (
    filename: string
  ) => {
    return `/api/shorts/${encodeURIComponent(
      filename
    )}`;
  };

  const getCaption = (
    short: Short
  ) => {
    if (
      short.caption?.trim()
    ) {
      return short.caption.trim();
    }

    if (
      short.title?.trim()
    ) {
      return short.title.trim();
    }

    return "This moment is crazy 👀";
  };

  const getCopyText = (
    short: Short
  ) => {
    return `${getCaption(
      short
    )}

#shorts #viral #trending`;
  };

  const copyCaption = async (
    short: Short
  ) => {
    try {
      await navigator.clipboard.writeText(
        getCopyText(short)
      );

      setCopiedId(
        short.id
      );

      window.setTimeout(
        () => {
          setCopiedId(null);
        },
        2000
      );
    } catch {
      setError(
        "Could not copy the caption."
      );
    }
  };

  /*
   * STEP 6:
   *
   * Start the download.
   */
  const startDownload = (
    short: Short
  ) => {
    const link =
      document.createElement(
        "a"
      );

    link.href =
      getShortUrl(
        short.filename
      );

    link.download =
      `crucial-short-${short.id}.mp4`;

    document.body.appendChild(
      link
    );

    link.click();

    document.body.removeChild(
      link
    );
  };

  /*
   * STEP 6:
   *
   * User clicked Download.
   *
   * If both ads have already been
   * completed, download immediately.
   *
   * Otherwise open the ad requirement.
   */
  const handleDownload = (
    short: Short
  ) => {
    if (
      downloadUnlocked ||
      adsWatched >= REQUIRED_ADS
    ) {
      startDownload(short);
      return;
    }

    setPendingDownload(short);
    setShowAdModal(true);
  };

  /*
   * STEP 6:
   *
   * TEST AD COMPLETION.
   *
   * This simulates an ad being watched.
   *
   * IMPORTANT:
   *
   * This should NOT be considered
   * real monetization yet.
   *
   * Later, replace the timeout with
   * the actual ad provider callback.
   */
  const watchTestAd = () => {
    if (adLoading) {
      return;
    }

    setAdLoading(true);

    /*
     * Simulate a short ad.
     */
    window.setTimeout(() => {
      setAdsWatched(
        (current) => {
          const next =
            Math.min(
              current + 1,
              REQUIRED_ADS
            );

          /*
           * Two ads completed.
           */
          if (
            next >=
            REQUIRED_ADS
          ) {
            setDownloadUnlocked(
              true
            );

            setShowAdModal(
              false
            );

            /*
             * Automatically download
             * the Short the user clicked.
             */
            window.setTimeout(() => {
              setPendingDownload(
                (pending) => {
                  if (pending) {
                    startDownload(
                      pending
                    );
                  }

                  return null;
                }
              );
            }, 100);
          }

          return next;
        }
      );

      setAdLoading(false);
    }, 2000);
  };

  return (
    <main className="min-h-screen bg-[#09090b] text-white">

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 sm:px-6">

        {/* HEADER */}

        <header className="flex h-20 items-center justify-between">

          <div className="text-xl font-bold tracking-tight">
            Crucial
            <span className="text-violet-400">
              Shorts
            </span>
          </div>

          <button
            type="button"
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/80 transition hover:border-white/20 hover:bg-white/5"
          >
            Sign in
          </button>

        </header>

        {/* MAIN */}

        <section className="flex flex-1 flex-col items-center pb-24 pt-10 text-center">

          {/* BADGE */}

          <div className="mb-5 rounded-full border border-violet-400/20 bg-violet-400/10 px-4 py-2 text-sm text-violet-300">
            ✨ AI-powered video → Shorts
          </div>

          {/* TITLE */}

          <h1 className="max-w-4xl text-4xl font-bold tracking-tight sm:text-6xl">

            Turn your long video into{" "}

            <span className="text-violet-400">
              4 Shorts.
            </span>

          </h1>

          <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg sm:leading-8">
            Upload a video up to 30 minutes.
            Our AI finds important moments and
            turns them into ready-to-post vertical
            Shorts.
          </p>

          {/* UPLOAD AREA */}

          <div className="mt-10 w-full max-w-2xl">

            <label
              htmlFor="video-upload"
              className="group flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/60 p-8 transition hover:border-violet-400/60 hover:bg-zinc-900"
            >

              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 text-3xl transition group-hover:scale-105">
                ↑
              </div>

              <h2 className="max-w-full truncate text-xl font-semibold">
                {file
                  ? file.name
                  : "Upload your video"}
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                MP4, MOV, WebM and other common
                video formats
              </p>

              <p className="mt-1 text-sm text-zinc-500">
                Maximum length: 30 minutes
              </p>

              <input
                id="video-upload"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={
                  handleFileChange
                }
              />

            </label>

            {/* ERROR */}

            {error && (
              <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-left text-sm text-red-300">
                {error}
              </div>
            )}

            {/* SELECTED FILE */}

            {file && (
              <div className="mt-4 rounded-xl border border-white/10 bg-zinc-900 p-4 text-left">

                <div className="flex items-center justify-between gap-4">

                  <div className="min-w-0">

                    <p className="truncate font-medium">
                      {file.name}
                    </p>

                    <p className="mt-1 text-sm text-zinc-500">
                      {(
                        file.size /
                        1024 /
                        1024
                      ).toFixed(1)}{" "}
                      MB
                    </p>

                  </div>

                  <button
                    type="button"
                    onClick={
                      removeFile
                    }
                    disabled={
                      uploading
                    }
                    className="shrink-0 text-sm text-zinc-500 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>

                </div>

              </div>
            )}

            {/* CREATE BUTTON */}

            <button
              type="button"
              disabled={
                !file ||
                uploading ||
                uploadsRemaining <= 0
              }
              onClick={
                uploadVideo
              }
              className="mt-5 w-full rounded-xl bg-violet-600 px-6 py-4 font-semibold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >

              {uploading
                ? "Creating Shorts..."
                : uploadsRemaining <= 0
                  ? "Daily Limit Reached"
                  : file
                    ? "Create 4 Shorts"
                    : "Choose a video first"}

            </button>

            {/* STATUS */}

            {uploadMessage && (
              <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/10 p-4 text-sm text-violet-300">
                {uploadMessage}
              </div>
            )}

            {/* FREE PLAN STATUS */}

            <div className="mt-4 rounded-xl border border-white/5 bg-zinc-900/50 px-4 py-3 text-xs text-zinc-500">

              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">

                <span>
                  Free plan
                </span>

                <span className="text-zinc-700">
                  •
                </span>

                <span>
                  {uploadsToday}/
                  {dailyUploadLimit}{" "}
                  video today
                </span>

                <span className="text-zinc-700">
                  •
                </span>

                <span>
                  4 Shorts
                </span>

                <span className="text-zinc-700">
                  •
                </span>

                <span>
                  2 ads required
                </span>

              </div>

              {uploadsRemaining ===
                0 && (
                <p className="mt-2 text-center text-amber-400">
                  Daily upload used.
                  Come back tomorrow.
                </p>
              )}

            </div>

          </div>

          {/* RESULTS */}

          {shorts.length > 0 && (
            <section className="mt-20 w-full">

              {/* RESULTS HEADER */}

              <div className="mb-10 text-left">

                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">

                  <div>

                    <div className="mb-2 inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                      ✓ READY TO POST
                    </div>

                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                      Your Shorts
                    </h2>

                    <p className="mt-2 text-zinc-500">
                      AI-selected clips from your video.
                    </p>

                  </div>

                  <div className="rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">

                    <span className="font-semibold text-white">
                      {
                        shorts.length
                      }
                    </span>{" "}
                    Shorts created

                  </div>

                </div>

              </div>

              {/* STEP 6 AD STATUS */}

              <div className="mb-8 rounded-2xl border border-violet-400/20 bg-violet-400/5 p-5 text-left">

                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">

                  <div>

                    <p className="text-xs font-bold uppercase tracking-widest text-violet-400">
                      FREE DOWNLOAD
                    </p>

                    <h3 className="mt-1 text-lg font-semibold text-white">
                      {downloadUnlocked
                        ? "Downloads unlocked ✓"
                        : "Watch 2 short ads to download"}
                    </h3>

                    <p className="mt-1 text-sm text-zinc-500">
                      {downloadUnlocked
                        ? "You can now download your Shorts."
                        : `${adsWatched}/${REQUIRED_ADS} ads completed`}
                    </p>

                  </div>

                  {!downloadUnlocked && (
                    <div className="shrink-0 rounded-xl bg-zinc-900 px-4 py-3 text-center">

                      <span className="text-2xl font-bold text-white">
                        {adsWatched}
                      </span>

                      <span className="text-zinc-600">
                        /
                      </span>

                      <span className="text-2xl font-bold text-zinc-500">
                        {REQUIRED_ADS}
                      </span>

                      <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">
                        ads
                      </p>

                    </div>
                  )}

                </div>

              </div>

              {/* SHORT CARDS */}

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">

                {shorts.map(
                  (short) => {

                    const caption =
                      getCaption(
                        short
                      );

                    return (
                      <article
                        key={
                          short.id
                        }
                        className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 text-left shadow-xl shadow-black/20 transition hover:-translate-y-1 hover:border-violet-400/30"
                      >

                        {/* VIDEO */}

                        <div className="relative aspect-[9/16] overflow-hidden bg-black">

                          <video
                            className="h-full w-full object-contain"
                            controls
                            playsInline
                            preload="metadata"
                            src={getShortUrl(
                              short.filename
                            )}
                          />

                          <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
                            SHORT{" "}
                            {
                              short.id
                            }
                          </div>

                        </div>

                        {/* CONTENT */}

                        <div className="p-4">

                          {/* POST CAPTION */}

                          <div className="rounded-xl border border-violet-400/10 bg-violet-400/5 p-3">

                            <div className="flex items-center justify-between gap-2">

                              <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400">
                                POST
                                CAPTION
                              </p>

                              <span className="text-[10px] text-zinc-600">
                                YouTube /
                                TikTok
                              </span>

                            </div>

                            <p className="mt-2 text-sm font-semibold leading-5 text-white">
                              {
                                caption
                              }
                            </p>

                          </div>

                          {/* META */}

                          <div className="mt-4 flex items-center justify-between gap-2">

                            <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-xs text-zinc-400">
                              {Math.round(
                                short.duration
                              )}
                              s
                            </span>

                            <span className="truncate text-xs text-zinc-600">
                              {
                                short.startTime
                              }{" "}
                              →{" "}
                              {
                                short.endTime
                              }
                            </span>

                          </div>

                          {/* TITLE */}

                          {short.title && (
                            <div className="mt-4">

                              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                                TITLE
                              </p>

                              <p className="text-sm font-medium leading-5 text-zinc-300">
                                {
                                  short.title
                                }
                              </p>

                            </div>
                          )}

                          {/* TRANSCRIPT */}

                          {short.transcript && (
                            <div className="mt-4">

                              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                                TRANSCRIPT
                              </p>

                              <p className="line-clamp-4 text-sm leading-6 text-zinc-500">
                                {
                                  short.transcript
                                }
                              </p>

                            </div>
                          )}

                          {/* ACTIONS */}

                          <div className="mt-5 grid grid-cols-2 gap-2">

                            {/* STEP 6 DOWNLOAD */}

                            <button
                              type="button"
                              onClick={() =>
                                handleDownload(
                                  short
                                )
                              }
                              className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold transition ${
                                downloadUnlocked
                                  ? "bg-violet-600 hover:bg-violet-500"
                                  : "bg-violet-600 hover:bg-violet-500"
                              }`}
                            >
                              {downloadUnlocked
                                ? "↓ Download"
                                : "🔒 Download"}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                copyCaption(
                                  short
                                )
                              }
                              className="rounded-lg border border-white/10 px-3 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/5 hover:text-white"
                            >
                              {copiedId ===
                              short.id
                                ? "✓ Copied"
                                : "Copy Caption"}
                            </button>

                          </div>

                          {/* OPEN */}

                          <a
                            href={getShortUrl(
                              short.filename
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 block rounded-lg border border-white/5 px-3 py-2 text-center text-xs text-zinc-500 transition hover:bg-white/5 hover:text-white"
                          >
                            Open full video
                          </a>

                        </div>

                      </article>
                    );
                  }
                )}

              </div>

            </section>
          )}

        </section>
      </div>

      {/* ===================================================== */}
      {/* STEP 6 — AD MODAL */}
      {/* ===================================================== */}

      {showAdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">

          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-2xl">

            {/* HEADER */}

            <div className="text-center">

              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-2xl">
                ▶
              </div>

              <h2 className="mt-4 text-2xl font-bold">
                Unlock your download
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Watch 2 short ads to unlock
                downloads for your Shorts.
              </p>

            </div>

            {/* PROGRESS */}

            <div className="mt-6">

              <div className="mb-2 flex items-center justify-between text-xs">

                <span className="text-zinc-500">
                  Ad progress
                </span>

                <span className="font-semibold text-violet-400">
                  {adsWatched}/{REQUIRED_ADS}
                </span>

              </div>

              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">

                <div
                  className="h-full rounded-full bg-violet-500 transition-all duration-500"
                  style={{
                    width: `${
                      (adsWatched /
                        REQUIRED_ADS) *
                      100
                    }%`,
                  }}
                />

              </div>

            </div>

            {/* TEST AD */}

            {adsWatched <
              REQUIRED_ADS && (
              <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black">

                <div className="flex aspect-video items-center justify-center">

                  <div className="text-center">

                    <div className="text-4xl">
                      📺
                    </div>

                    <p className="mt-3 text-sm font-semibold text-white">
                      Test Advertisement
                    </p>

                    <p className="mt-1 text-xs text-zinc-600">
                      Ad provider will appear here
                    </p>

                  </div>

                </div>

              </div>
            )}

            {/* BUTTON */}

            {adsWatched <
              REQUIRED_ADS ? (
              <button
                type="button"
                disabled={
                  adLoading
                }
                onClick={
                  watchTestAd
                }
                className="mt-5 w-full rounded-xl bg-violet-600 px-5 py-3.5 font-semibold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                {adLoading
                  ? "Watching ad..."
                  : `Watch Ad ${
                      adsWatched + 1
                    }`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowAdModal(
                    false
                  );
                }}
                className="mt-5 w-full rounded-xl bg-emerald-600 px-5 py-3.5 font-semibold"
              >
                ✓ Downloads Unlocked
              </button>
            )}

            {/* CANCEL */}

            <button
              type="button"
              disabled={
                adLoading
              }
              onClick={() => {
                setShowAdModal(
                  false
                );
                setPendingDownload(
                  null
                );
              }}
              className="mt-3 w-full px-5 py-3 text-sm text-zinc-500 transition hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>

            {/* NOTE */}

            <p className="mt-4 text-center text-[10px] leading-4 text-zinc-700">
              You only need to complete the
              ads once for this upload.
            </p>

          </div>

        </div>
      )}

    </main>
  );
}