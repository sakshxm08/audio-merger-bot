import axios from "axios";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import tmp from "tmp-promise";
import { DownloadResult } from "../types";
import { Logger } from "../utils/logger";

export class FileDownloadService {
  private logger = new Logger("FileDownloadService");

  async downloadFile(
    fileLink: string,
    userId: number
  ): Promise<DownloadResult> {
    const url = fileLink;

    // Check if it's a local file path (starts with file:// OR is a local path)
    if (url.startsWith("file://") || this.isLocalPath(url)) {
      return this.handleLocalFile(url);
    } else {
      return this.handleRemoteFile(url);
    }
  }

  private isLocalPath(url: string): boolean {
    // Check if URL points to local API server
    return (
      url.includes("127.0.0.1:8081") ||
      url.includes("localhost:8081") ||
      url.includes("telegram-bot-api:8081") ||
      !url.startsWith("http")
    ); // Assume non-HTTP URLs are local paths
  }

  private async handleLocalFile(url: string): Promise<DownloadResult> {
    // Add this debug logging
    this.logger.log(`Raw URL received: ${url}`);

    let localPath: string;

    if (url.startsWith("file://")) {
      const fileUrl = new URL(url);

      localPath = decodeURIComponent(fileUrl.pathname);

      this.logger.log(
        `[handleLocalFile] Parsed local path from file://: ${localPath}`
      );
    } else if (url.startsWith("http")) {
      const urlParts = url.split("/file/");
      if (urlParts.length > 1) {
        const filePathPart = urlParts[1];
        this.logger.log(`File path part extracted from URL: ${filePathPart}`);

        const pathAfterToken = filePathPart.substring(
          filePathPart.indexOf("/") + 1
        );
        this.logger.log(`Path after token stripped: ${pathAfterToken}`);

        localPath = path.join("/var/lib/telegram-bot-api", pathAfterToken);
      } else {
        throw new Error(`Invalid local API URL format: ${url}`);
      }
    } else {
      this.logger.log(`Assuming direct file path: ${url}`);

      // Normalize the path to avoid issues with relative/absolute confusion
      localPath = path.normalize(
        url.startsWith("/") ? url : path.join("/var/lib/telegram-bot-api", url)
      );
    }

    // Clean up any double slashes or incorrect path constructions
    localPath = path.normalize(localPath);

    this.logger.log(`Attempting to access local file: ${localPath}`);

    const extension = path.extname(localPath);
    const tempFile = await tmp.file({ postfix: extension });

    try {
      // Check if file exists and is accessible
      await fsp.access(localPath, fs.constants.R_OK);

      this.logger.log(`Copying file: ${localPath} to ${tempFile.path}`);
      await fsp.copyFile(localPath, tempFile.path);
      this.logger.log(`File copied successfully: ${tempFile.path}`);

      return {
        path: tempFile.path,
        cleanup: tempFile.cleanup,
      };
    } catch (accessError) {
      await tempFile.cleanup();
      this.logger.error(
        `Failed to access local file: ${localPath}`,
        accessError
      );

      // Try to list directory contents for debugging
      try {
        const dir = path.dirname(localPath);
        const files = await fsp.readdir(dir);
        this.logger.log(`Directory contents of ${dir}:`, files);
      } catch (dirError) {
        this.logger.error(
          `Cannot read directory ${path.dirname(localPath)}:`,
          dirError
        );
      }

      throw new Error(`Local file not found or not accessible: ${localPath}`);
    }
  }

  private async handleRemoteFile(url: string): Promise<DownloadResult> {
    const extension = path.extname(url);
    const tempFile = await tmp.file({ postfix: extension });

    this.logger.log(`Downloading file from: ${url}`);

    try {
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
            this.logger.log(`Download completed: ${tempFile.path}`);
            resolve(undefined);
          })
          .on("error", reject);
      });

      return {
        path: tempFile.path,
        cleanup: tempFile.cleanup,
      };
    } catch (error) {
      await tempFile.cleanup();
      throw error;
    }
  }
}
