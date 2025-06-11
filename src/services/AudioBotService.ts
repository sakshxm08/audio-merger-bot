import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { AudioQueueItem, DownloadResult, ProcessingStatus } from "../types";
import { FileDownloadService } from "./FileDownloadService";
import { AudioMergeService } from "./AudioMergeService";
import { SessionManager } from "./SessionManager";
import { Logger } from "../utils/logger";

export class AudioBotService {
  private bot: Telegraf;
  private fileDownloadService: FileDownloadService;
  private audioMergeService: AudioMergeService;
  private sessionManager: SessionManager;
  private processingUsers = new Set<number>();
  private logger = new Logger("AudioBotService");
  private botStartTime = Date.now();

  constructor(token: string, apiRoot?: string) {
    this.bot = new Telegraf(token, {
      telegram: {
        apiRoot: apiRoot || "http://127.0.0.1:8081",
      },
    });

    this.fileDownloadService = new FileDownloadService();
    this.audioMergeService = new AudioMergeService();
    this.sessionManager = new SessionManager();

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    // Start command
    this.bot.start((ctx) =>
      ctx.reply(
        `🎵 Welcome to Audio Merger Bot!\n\n` +
          "Send audio files one by one, then use /merge to combine them.\n" +
          "Max 10 files per session. Supports large files up to 2GB!\n\n" +
          "Supported formats: MP3, WAV, OGG, M4A"
      )
    );

    // Help command
    this.bot.help((ctx) =>
      ctx.reply(
        `📖 Help Guide:\n\n` +
          "/merge - Combine queued audio files\n" +
          "/cancel - Clear current queue\n" +
          "/status - Show current queue\n" +
          "/help - Show this guide\n\n" +
          "Just send audio files to add them to your merge queue!"
      )
    );

    // Audio message handler
    this.bot.on(message("audio"), async (ctx) => {
      await this.handleAudioMessage(ctx);
    });

    // Voice message handler
    this.bot.on(message("voice"), async (ctx) => {
      await ctx.reply(
        "🎤 Voice messages detected! Please convert to audio file format (MP3, WAV, etc.) for merging."
      );
    });

    // Commands
    this.bot.command("merge", async (ctx) => {
      await this.handleMergeCommand(ctx);
    });

    this.bot.command("status", async (ctx) => {
      await this.handleStatusCommand(ctx);
    });

    this.bot.command("cancel", async (ctx) => {
      await this.handleCancelCommand(ctx);
    });
  }

  private async handleAudioMessage(
    ctx: Context & { message: any }
  ): Promise<void> {
    const userId = ctx.from!.id;
    const audio = ctx.message.audio;

    // Ignore old messages (sent before bot startup)
    const messageTime = ctx.message.date * 1000;
    if (messageTime < this.botStartTime - 300000) {
      // 5 minutes grace period
      this.logger.log(`Ignoring old message from ${new Date(messageTime)}`);
      return;
    }

    const audioFile: AudioQueueItem = {
      fileId: audio.file_id,
      fileName: audio.file_name || `audio_${Date.now()}`,
      userId,
      timestamp: Date.now(),
    };

    const success = this.sessionManager.addAudioFile(userId, audioFile);

    if (!success) {
      await ctx.reply("❌ Queue is full (10/10). Use /merge or /cancel first.");
      return;
    }

    const status = this.sessionManager.getQueueStatus(userId);
    await ctx.reply(
      `🎧 Audio added to queue! (${status.count}/10)\n` +
        "Send another audio file or use /merge to combine them."
    );
  }

  private async handleMergeCommand(ctx: Context): Promise<void> {
    const userId = ctx.from!.id;

    // Check if user is already processing
    if (this.processingUsers.has(userId)) {
      await ctx.reply(
        "⏳ You already have a merge operation in progress. Please wait..."
      );
      return;
    }

    const session = this.sessionManager.getSession(userId);
    if (!session?.audioFiles.length) {
      await ctx.reply("❌ No audio files in queue. Send audio files first.");
      return;
    }

    if (session.audioFiles.length < 2) {
      await ctx.reply("❌ Need at least 2 audio files to merge.");
      return;
    }

    // Mark user as processing
    this.processingUsers.add(userId);

    try {
      await this.processAudioMerge(ctx, userId, session.audioFiles);
    } catch (error) {
      this.logger.error("Merge operation failed:", error);
      await this.handleMergeError(ctx, error);
    } finally {
      // Always remove from processing set and cleanup session
      this.processingUsers.delete(userId);
      this.sessionManager.deleteSession(userId);
    }
  }

  private async processAudioMerge(
    ctx: Context,
    userId: number,
    audioFiles: AudioQueueItem[]
  ): Promise<void> {
    const processingMsg = await ctx.reply(
      "⏳ Processing large files... This may take several minutes."
    );

    // Download all files
    this.logger.log(
      `Starting download of ${audioFiles.length} files for user ${userId}`
    );

    // Send single progress message instead of per-file messages
    await ctx.reply(`📥 Downloading ${audioFiles.length} files...`);

    const downloads: DownloadResult[] = [];

    try {
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const fileLink = await this.bot.telegram.getFileLink(file.fileId);
        const download = await this.fileDownloadService.downloadFile(
          fileLink.href,
          userId
        );
        downloads.push(download);

        // Update progress every 3 files to avoid rate limiting
        if ((i + 1) % 3 === 0 || i === audioFiles.length - 1) {
          await ctx.reply(
            `📥 Downloaded ${i + 1}/${audioFiles.length} files...`
          );
        }
      }

      await ctx.reply("🔄 Merging audio files... Please wait...");

      // Add periodic progress updates for long operations
      const progressInterval = setInterval(async () => {
        try {
          await ctx.reply(
            "🔄 Still processing... Large files take time on our server."
          );
        } catch (e) {
          // Ignore if user blocked bot or chat closed
        }
      }, 120000); // Every 2 minutes

      try {
        // Merge files without timeout - let FFmpeg finish naturally
        const outputPath = await this.audioMergeService.mergeAudios(
          downloads.map((d) => d.path),
          { threads: 1, bitrate: 192 }
        );

        clearInterval(progressInterval);

        await ctx.reply("📤 Uploading merged file...");

        // Send merged file
        await ctx.replyWithAudio({
          source: outputPath,
          filename: `merged_${Date.now()}.mp3`,
        });

        await ctx.reply("✅ Audio files merged successfully!");
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    } finally {
      // Cleanup all downloaded files
      for (const download of downloads) {
        try {
          await download.cleanup();
        } catch (error) {
          this.logger.error("Failed to cleanup download:", error);
        }
      }
    }
  }

  private async handleMergeError(ctx: Context, error: any): Promise<void> {
    if (error instanceof Error) {
      if (error.message.includes("timed out")) {
        await ctx.reply(
          "❌ Processing timed out. Files may be too large for current server capacity. Try with smaller files."
        );
      } else if (error.message.includes("429")) {
        await ctx.reply(
          "❌ Too many requests. Please wait a moment and try again."
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

  private async handleStatusCommand(ctx: Context): Promise<void> {
    const status = this.sessionManager.getQueueStatus(ctx.from!.id);

    if (!status.count) {
      await ctx.reply("📭 Your queue is empty");
      return;
    }

    const fileList = status.files
      .map((f, i) => `${i + 1}. ${f.fileName}`)
      .join("\n");

    await ctx.reply(`📥 Current queue (${status.count}/10):\n\n${fileList}`);
  }

  private async handleCancelCommand(ctx: Context): Promise<void> {
    const session = this.sessionManager.getSession(ctx.from!.id);

    if (!session?.audioFiles.length) {
      await ctx.reply("📭 Your queue is already empty");
      return;
    }

    this.sessionManager.deleteSession(ctx.from!.id);
    await ctx.reply("🗑 Queue cleared");
  }

  private setupErrorHandling(): void {
    this.bot.catch((err) => {
      this.logger.error("Bot error:", err);
    });

    // Cleanup old sessions periodically
    setInterval(() => {
      this.sessionManager.cleanupOldSessions(24);
    }, 60 * 60 * 1000); // Every hour
  }

  async launch(): Promise<void> {
    await this.bot.launch();
    this.logger.log("🚀 Audio Merger Bot is running with large file support!");
  }

  stop(reason?: string): void {
    this.bot.stop(reason);
    this.sessionManager.destroy();
  }

  // Public API for external use
  async mergeAudioFiles(filePaths: string[]): Promise<string> {
    return this.audioMergeService.mergeAudios(filePaths);
  }

  async downloadFile(url: string, userId: number): Promise<DownloadResult> {
    return this.fileDownloadService.downloadFile(url, userId);
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
