// src/services/MixedInputService.ts
import { YouTubeService } from "./YoutubeService";
import { FileDownloadService } from "./FileDownloadService";
import { DownloadResult } from "../types";
import { Logger } from "../utils/logger";

export interface MixedInputItem {
  type: "youtube" | "audio_file";
  content: string; // URL for YouTube, file_id for audio
  fileName?: string;
}

export class MixedInputService {
  private youtubeService: YouTubeService;
  private fileDownloadService: FileDownloadService;
  private logger = new Logger("MixedInputService");

  constructor() {
    this.youtubeService = new YouTubeService();
    this.fileDownloadService = new FileDownloadService();
  }

  parseInput(input: string): MixedInputItem[] {
    const lines = input
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    const items: MixedInputItem[] = [];

    for (const line of lines) {
      if (this.youtubeService.isYouTubeURL(line)) {
        items.push({
          type: "youtube",
          content: line,
        });
      } else {
        // Assume it's an audio file reference
        items.push({
          type: "audio_file",
          content: line,
        });
      }
    }

    return items;
  }

  async processItems(
    items: MixedInputItem[],
    bot: any,
    userId: number
  ): Promise<DownloadResult[]> {
    const downloads: DownloadResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        if (item.type === "youtube") {
          this.logger.log(
            `Processing YouTube URL ${i + 1}/${items.length}: ${item.content}`
          );
          const download = await this.youtubeService.downloadAudio(
            item.content
          );
          downloads.push(download);
        } else if (item.type === "audio_file") {
          this.logger.log(
            `Processing audio file ${i + 1}/${items.length}: ${item.content}`
          );
          // Get file link from Telegram
          const fileLink = await bot.telegram.getFileLink(item.content);
          const download = await this.fileDownloadService.downloadFile(
            fileLink.href,
            userId
          );
          downloads.push(download);
        }
      } catch (error) {
        this.logger.error(`Failed to process item ${i + 1}:`, error);
        // Cleanup any successful downloads so far
        for (const download of downloads) {
          await download.cleanup();
        }
        throw error;
      }
    }

    return downloads;
  }
}
