import { Telegraf, Context } from "telegraf";
import { message } from "telegraf/filters";
import { AudioQueueItem, DownloadResult, MixedQueueItem } from "../types";
import { FileDownloadService } from "./FileDownloadService";
import { AudioMergeService } from "./AudioMergeService";
import { SessionManager } from "./SessionManager";
import { MixedInputService } from "./MixedInputService";
import { Logger } from "../utils/logger";

export class AudioBotService {
  private bot: Telegraf;
  private sessionManager = new SessionManager();
  private fileDownload = new FileDownloadService();
  private audioMerge = new AudioMergeService();
  private youtubeParser = new MixedInputService();
  private logger = new Logger("AudioBotService");
  private processingUsers = new Set<number>();
  private botStartTime = Date.now();

  constructor(token: string, apiRoot?: string) {
    this.bot = new Telegraf(token, { telegram: { apiRoot: apiRoot } });
    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    this.bot.start((ctx) =>
      ctx.reply(
        `🎵 Welcome!
Send audio files and YouTube links in any order to queue.
Use /merge to combine, /status to view, /clear to reset.`
      )
    );
    this.bot.help((ctx) =>
      ctx.reply(
        `📖 Commands:
/start - Welcome
/help - This message
/merge - Merge queued items
/status - Show queue status
/clear - Clear queue

Send up to 20 audio files or YouTube URLs before /merge.`
      )
    );

    // Add audio attachments
    this.bot.on(message("audio"), async (ctx) => {
      await this.addAudio(ctx);
    });
    // Ignore voice
    this.bot.on(message("voice"), (ctx) =>
      ctx.reply("🔇 Voice not supported; please send as audio file.")
    );
    // Parse YouTube URLs from text
    this.bot.on(message("text"), async (ctx, next) => {
      const txt = (ctx.message as any).text.trim();
      if (txt.startsWith("/")) return next();
      // parse lines
      const items = this.youtubeParser
        .parseInput(txt)
        .filter((i) => i.type === "youtube");
      if (!items.length) return;
      const userId = ctx.from!.id;
      let added = 0;
      for (const i of items) {
        const mi: MixedQueueItem = { ...i, timestamp: Date.now() };
        if (!this.sessionManager.addMixedItem(userId, mi)) break;
        added++;
      }
      const status = this.sessionManager.getMixedQueueStatus(userId);
      await ctx.reply(
        `🎧 Added ${added} YouTube link(s). Queue: ${status.count}/20.`
      );
    });

    this.bot.command("status", (ctx) => this.showStatus(ctx));
    this.bot.command("clear", (ctx) => this.clearQueue(ctx));
    this.bot.command("merge", (ctx) => this.processMerge(ctx));
  }

  private async addAudio(ctx: Context & { message: any }) {
    const userId = ctx.from!.id;
    const audio = ctx.message.audio;
    // ignore old
    if (ctx.message.date * 1000 < this.botStartTime - 300000) return;
    const item: MixedQueueItem = {
      type: "audio_file",
      content: audio.file_id,
      fileName: audio.file_name || `audio_${Date.now()}`,
      timestamp: Date.now(),
    };
    if (!this.sessionManager.addMixedItem(userId, item)) {
      return ctx.reply("❌ Queue full (20). Use /merge or /clear first.");
    }
    const status = this.sessionManager.getMixedQueueStatus(userId);
    await ctx.reply(
      `🎧 Audio added (${status.count}/20). Send more or /merge.`
    );
  }

  private showStatus(ctx: Context) {
    const userId = ctx.from!.id;
    const st = this.sessionManager.getMixedQueueStatus(userId);
    if (!st.count) return ctx.reply("📭 Queue empty.");
    const list = st.items
      .map(
        (i, idx) =>
          `${idx + 1}. ${i.type === "youtube" ? "YT" : "File"}: ${i.content}`
      )
      .join("\n");
    ctx.reply(`📥 Queue (${st.count}/20):\n${list}`);
  }

  private clearQueue(ctx: Context) {
    const userId = ctx.from!.id;
    const st = this.sessionManager.getMixedQueueStatus(userId);
    if (!st.count) return ctx.reply("❌ Nothing to clear.");
    this.sessionManager.clearMixedQueue(userId);
    ctx.reply("🗑 Queue cleared.");
  }

  private async processMerge(ctx: Context) {
    const userId = ctx.from!.id;
    if (this.processingUsers.has(userId)) {
      return ctx.reply("⏳ Merge in progress...");
    }
    const st = this.sessionManager.getMixedQueueStatus(userId);
    if (st.count < 2) {
      return ctx.reply("❌ Need at least 2 items in queue before /merge.");
    }
    this.processingUsers.add(userId);
    const downloads: DownloadResult[] = [];
    let mergeResult: any = null;
    await ctx.reply(`🔄 Merging ${st.count} items...`);
    try {
      // download all
      for (const [idx, it] of st.items.entries()) {
        if (it.type === "youtube") {
          const dl = await this.youtubeParser.processItems(
            [it],
            this.bot,
            userId
          );
          downloads.push(...dl);
        } else {
          const link = await this.bot.telegram.getFileLink(it.content);
          console.log("it -> ", it);
          console.log("link -> ", link);
          const downloadedFile = await this.fileDownload.downloadFile(
            link.href,
            userId
          );
          console.log("Downloaded to: ", downloadedFile.path);
          downloads.push(downloadedFile);
        }
        if ((idx + 1) % 5 === 0)
          await ctx.reply(`📥 Downloaded ${idx + 1}/${st.count}`);
      }
      await ctx.reply("🔀 Combining audio...");
      const paths = downloads.map((d) => d.path);
      mergeResult = await this.audioMerge.mergeAudios(paths, {
        threads: 2,
        bitrate: 192,
      });
      console.log("Merged output at: ", mergeResult);
      await ctx.replyWithAudio({
        source: mergeResult.path,
        filename: `merged_${Date.now()}.mp3`,
      });
      await ctx.reply("✅ Merge complete.");

      this.sessionManager.clearMixedQueue(userId);
    } catch (err) {
      this.logger.error("Merge failed", err);
      await ctx.reply("❌ Merge error. Try again.");
    } finally {
      // Clean up all temporary files
      const cleanupPromises = [];

      // Clean up downloaded files
      for (const d of downloads) {
        cleanupPromises.push(d.cleanup());
      }

      // Clean up merged output
      if (mergeResult?.cleanup) {
        cleanupPromises.push(mergeResult.cleanup());
      }

      try {
        await Promise.all(cleanupPromises);
        this.logger.log("All cleanup operations completed");
      } catch (cleanupError) {
        this.logger.error("Some cleanup operations failed:", cleanupError);
      }
      this.processingUsers.delete(userId);
    }
  }

  private setupErrorHandling() {
    this.bot.catch((err) => this.logger.error("Bot error", err));
  }

  async launch() {
    await this.bot.launch();
  }
  stop() {
    this.bot.stop();
    this.sessionManager.destroy();
  }
}
