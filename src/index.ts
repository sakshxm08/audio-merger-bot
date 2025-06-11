import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import axios from "axios";
import tmp from "tmp-promise";
import "dotenv/config";
import { startPeriodicCleanup } from "./cleanup-service";

import "./logger";

// Type definitions
interface AudioQueueItem {
  fileId: string;
  fileName: string;
  userId: number;
}

interface UserSession {
  audioFiles: AudioQueueItem[];
}

// Configure bot with Local Telegram Bot API Server and increased timeout
const bot = new Telegraf(process.env.TELEGRAM_TOKEN!, {
  telegram: {
    apiRoot: process.env.LOCAL_TELEGRAM_API_ROOT || "http://127.0.0.1:8081",
  },
});

const userSessions = new Map<number, UserSession>();

// Temporary directory setup
tmp.setGracefulCleanup();

// FFmpeg configuration
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || "/usr/bin/ffprobe");

// Helper: Download Telegram file with enhanced logging and timeout handling
async function downloadFile(fileId: string, userId: number) {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const url = fileLink.href;

  // Check if it's a local file path (starts with file://)
  if (url.startsWith("file://")) {
    // Handle local file protocol - clean the path properly
    let localPath = url.replace("file://", "");

    // Remove any server IP prefix that might be incorrectly added
    if (localPath.startsWith("127.0.0.1/")) {
      localPath = localPath.replace("127.0.0.1/", "/");
    }

    const extension = path.extname(localPath);
    const tempFile = await tmp.file({ postfix: extension });

    // Check if file exists before copying
    try {
      await fsp.access(localPath);
      console.log(`Copying file: ${localPath} to ${tempFile.path}`);
      await fsp.copyFile(localPath, tempFile.path);
      console.log(`File copied successfully: ${tempFile.path}`);
    } catch (accessError) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    return {
      path: tempFile.path,
      cleanup: tempFile.cleanup,
    };
  } else {
    // Handle HTTP/HTTPS protocols with timeout
    const extension = path.extname(url);
    const tempFile = await tmp.file({ postfix: extension });

    console.log(`Downloading file from: ${url}`);
    const response = await axios({
      url: url,
      method: "GET",
      responseType: "stream",
      timeout: 300000, // 5 minutes timeout for downloads
    });

    await new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(tempFile.path))
        .on("finish", () => {
          console.log(`Download completed: ${tempFile.path}`);
          resolve(undefined);
        })
        .on("error", reject);
    });

    return {
      path: tempFile.path,
      cleanup: tempFile.cleanup,
    };
  }
}

// Helper: Merge audio files with performance optimization and progress tracking
async function mergeAudios(files: string[], outputPath: string) {
  return new Promise((resolve, reject) => {
    console.log(`Starting merge of ${files.length} files`);
    const command = ffmpeg();

    files.forEach((file, index) => {
      console.log(`Adding input file ${index + 1}: ${file}`);
      command.input(file);
    });

    command
      .audioCodec("mp3")
      .audioBitrate(192) // Good quality for merged output
      .audioChannels(2)
      .outputOptions([
        "-threads 1", // Limit CPU threads for 1GB server
        "-preset fast", // Balance speed vs quality
        "-avoid_negative_ts make_zero",
        "-max_muxing_queue_size 1024",
      ])
      .on("start", (commandLine) => {
        console.log("FFmpeg started with command:", commandLine);
      })
      .on("progress", (progress) => {
        console.log(
          `Processing: ${progress.percent}% done, time: ${progress.timemark}`
        );
      })
      .on("end", () => {
        console.log("FFmpeg merge completed successfully");
        resolve(undefined);
      })
      .on("error", (error) => {
        console.error("FFmpeg error:", error);
        reject(error);
      })
      .mergeToFile(outputPath, tmp.dirSync().name);
  });
}

// Handle audio messages
bot.on(message("audio"), async (ctx) => {
  const userId = ctx.from.id;
  const audio = ctx.message.audio;

  if (!userSessions.has(userId)) {
    userSessions.set(userId, { audioFiles: [] });
  }

  const session = userSessions.get(userId)!;

  // Check queue limit
  if (session.audioFiles.length >= 10) {
    return ctx.reply("❌ Queue is full (10/10). Use /merge or /cancel first.");
  }

  session.audioFiles.push({
    fileId: audio.file_id,
    fileName: audio.file_name || `audio_${Date.now()}`,
    userId,
  });

  await ctx.reply(
    `🎧 Audio added to queue! (${session.audioFiles.length}/10)\n` +
      "Send another audio file or use /merge to combine them."
  );
});

// Enhanced merge command with timeout handling and user feedback
bot.command("merge", async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session?.audioFiles.length) {
    return ctx.reply("❌ No audio files in queue. Send audio files first.");
  }

  if (session.audioFiles.length < 2) {
    return ctx.reply("❌ Need at least 2 audio files to merge.");
  }

  const processingMsg = await ctx.reply(
    "⏳ Processing large files... This may take several minutes."
  );

  try {
    // Download all files with progress updates
    console.log(
      `Starting download of ${session.audioFiles.length} files for user ${userId}`
    );
    const downloads = await Promise.all(
      session.audioFiles.map(async (file, index) => {
        await ctx.reply(
          `📥 Downloading file ${index + 1}/${session.audioFiles.length}...`
        );
        const { path, cleanup } = await downloadFile(file.fileId, userId);
        return { path, cleanup };
      })
    );

    await ctx.reply("🔄 Merging audio files... Please wait...");

    // Merge files with timeout protection
    const outputFile = await tmp.file({ postfix: ".mp3" });

    // Add timeout wrapper for merge operation
    const mergePromise = mergeAudios(
      downloads.map((d) => d.path),
      outputFile.path
    );

    // Set 8-minute timeout for merge operation
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Merge operation timed out after 8 minutes")),
        480000
      );
    });

    await Promise.race([mergePromise, timeoutPromise]);

    await ctx.reply("📤 Uploading merged file...");

    // Send merged file
    await ctx.replyWithAudio({
      source: outputFile.path,
      filename: `merged_${Date.now()}.mp3`,
    });

    await ctx.reply("✅ Audio files merged successfully!");

    // Cleanup
    downloads.forEach((d) => d.cleanup());
    await outputFile.cleanup();
    userSessions.delete(userId);
  } catch (error: unknown) {
    console.error("Merge error:", error);
    if (error instanceof Error) {
      if (error.message.includes("timed out")) {
        await ctx.reply(
          "❌ Processing timed out. Files may be too large for current server capacity. Try with smaller files."
        );
      } else {
        await ctx.reply(
          "❌ Error processing audio files. Please try again with smaller files."
        );
      }
    } else {
      await ctx.reply("❌ An unexpected error occurred. Please try again.");
    }
  }
});

// Basic commands
bot.start((ctx) =>
  ctx.reply(
    `🎵 Welcome to Audio Merger Bot!\n\n` +
      "Send audio files one by one, then use /merge to combine them.\n" +
      "Max 10 files per session. Supports large files up to 2GB!\n\n" +
      "Supported formats: MP3, WAV, OGG, M4A"
  )
);

bot.help((ctx) =>
  ctx.reply(
    `📖 Help Guide:\n\n` +
      "/merge - Combine queued audio files\n" +
      "/cancel - Clear current queue\n" +
      "/status - Show current queue\n" +
      "/help - Show this guide\n\n" +
      "Just send audio files to add them to your merge queue!"
  )
);

bot.command("status", (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session?.audioFiles.length) {
    return ctx.reply("📭 Your queue is empty");
  }

  const fileList = session.audioFiles
    .map((f, i) => `${i + 1}. ${f.fileName}`)
    .join("\n");

  ctx.reply(
    `📥 Current queue (${session.audioFiles.length}/10):\n\n${fileList}`
  );
});

bot.command("cancel", (ctx) => {
  const session = userSessions.get(ctx.from.id);
  if (!session?.audioFiles.length) {
    return ctx.reply("📭 Your queue is already empty");
  }

  userSessions.delete(ctx.from.id);
  ctx.reply("🗑 Queue cleared");
});

// Handle voice messages as well
bot.on(message("voice"), async (ctx) => {
  await ctx.reply(
    "🎤 Voice messages detected! Please convert to audio file format (MP3, WAV, etc.) for merging."
  );
});

// Error handling
bot.catch((err) => {
  console.error("Bot error:", err);
});

// Start periodic cleanup for Telegram Bot API files
const telegramApiDirectory = "/var/lib/telegram-bot-api";
startPeriodicCleanup(telegramApiDirectory, 24);

// Launch bot
bot.launch().then(() => {
  console.log("🚀 Audio Merger Bot is running with large file support!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
