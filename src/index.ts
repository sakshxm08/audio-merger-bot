import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import axios from "axios";
import tmp from "tmp-promise";
import "dotenv/config";

// Type definitions
interface AudioQueueItem {
  fileId: string;
  fileName: string;
  userId: number;
}

interface UserSession {
  audioFiles: AudioQueueItem[];
}

// Configure bot with Local Telegram Bot API Server
const bot = new Telegraf(process.env.TELEGRAM_TOKEN!, {
  telegram: {
    apiRoot: process.env.LOCAL_TELEGRAM_API_ROOT || "http://127.0.0.1:8081",
  },
});

const userSessions = new Map<number, UserSession>();

// Temporary directory setup
tmp.setGracefulCleanup();

// FFmpeg configuration
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg");
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || "/opt/homebrew/bin/ffprobe");

// Helper: Download Telegram file (fixed for local Bot API server)
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
      await fsp.copyFile(localPath, tempFile.path);
    } catch (accessError) {
      throw new Error(`Local file not found: ${localPath}`);
    }

    return {
      path: tempFile.path,
      cleanup: tempFile.cleanup,
    };
  } else {
    // Handle HTTP/HTTPS protocols (original logic)
    const extension = path.extname(url);
    const tempFile = await tmp.file({ postfix: extension });

    const response = await axios({
      url: url,
      method: "GET",
      responseType: "stream",
    });

    await new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(tempFile.path))
        .on("finish", resolve)
        .on("error", reject);
    });

    return {
      path: tempFile.path,
      cleanup: tempFile.cleanup,
    };
  }
}

// Helper: Merge audio files
async function mergeAudios(files: string[], outputPath: string) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg();

    files.forEach((file) => command.input(file));

    command
      .on("end", resolve)
      .on("error", reject)
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

// Merge command
bot.command("merge", async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  if (!session?.audioFiles.length) {
    return ctx.reply("❌ No audio files in queue. Send audio files first.");
  }

  if (session.audioFiles.length < 2) {
    return ctx.reply("❌ Need at least 2 audio files to merge.");
  }

  const processingMsg = await ctx.reply("⏳ Processing...");

  try {
    // Download all files
    const downloads = await Promise.all(
      session.audioFiles.map(async (file) => {
        const { path, cleanup } = await downloadFile(file.fileId, userId);
        return { path, cleanup };
      })
    );

    // Merge files
    const outputFile = await tmp.file({ postfix: ".mp3" });
    await mergeAudios(
      downloads.map((d) => d.path),
      outputFile.path
    );

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
  } catch (error) {
    console.error("Merge error:", error);
    await ctx.reply("❌ Error processing audio files. Please try again.");
  } finally {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
    } catch (deleteError) {
      // Ignore deletion errors (message might already be deleted)
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

// Launch bot
bot.launch().then(() => {
  console.log("🚀 Audio Merger Bot is running with large file support!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
