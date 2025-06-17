// src/services/YouTubeService.ts
import ytdl from "@distube/ytdl-core";
import * as fs from "fs";
import tmp from "tmp-promise";
import { DownloadResult } from "../types";
import { Logger } from "../utils/logger";

export class YouTubeService {
  private logger = new Logger("YouTubeService");

  async downloadAudio(url: string): Promise<DownloadResult> {
    try {
      // Validate YouTube URL
      if (!ytdl.validateURL(url)) {
        throw new Error("Invalid YouTube URL");
      }

      const tempFile = await tmp.file({ postfix: ".mp4" });

      this.logger.log(`Downloading audio from YouTube: ${url}`);

      return new Promise((resolve, reject) => {
        const stream = ytdl(url, {
          quality: "highestaudio",
          filter: "audioonly",
        });

        const writeStream = fs.createWriteStream(tempFile.path);

        stream.pipe(writeStream);

        stream.on("error", (error) => {
          this.logger.error("YouTube download error:", error);
          tempFile.cleanup();
          reject(error);
        });

        writeStream.on("finish", () => {
          this.logger.log(`YouTube audio downloaded: ${tempFile.path}`);
          resolve({
            path: tempFile.path,
            cleanup: tempFile.cleanup,
          });
        });

        writeStream.on("error", (error) => {
          this.logger.error("Write stream error:", error);
          tempFile.cleanup();
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error("YouTube service error:", error);
      throw error;
    }
  }

  isYouTubeURL(url: string): boolean {
    return ytdl.validateURL(url);
  }
}
