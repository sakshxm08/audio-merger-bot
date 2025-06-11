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

    // Check if it's a local file path (starts with file://)
    if (url.startsWith("file://")) {
      return this.handleLocalFile(url);
    } else {
      return this.handleRemoteFile(url);
    }
  }

  private async handleLocalFile(url: string): Promise<DownloadResult> {
    let localPath = url.replace("file://", "");

    // Remove any server IP prefix that might be incorrectly added
    if (localPath.startsWith("127.0.0.1/")) {
      localPath = localPath.replace("127.0.0.1/", "/");
    }

    const extension = path.extname(localPath);
    const tempFile = await tmp.file({ postfix: extension });

    try {
      await fsp.access(localPath);
      this.logger.log(`Copying file: ${localPath} to ${tempFile.path}`);
      await fsp.copyFile(localPath, tempFile.path);
      this.logger.log(`File copied successfully: ${tempFile.path}`);
    } catch (accessError) {
      await tempFile.cleanup();
      throw new Error(`Local file not found: ${localPath}`);
    }

    return {
      path: tempFile.path,
      cleanup: tempFile.cleanup,
    };
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
