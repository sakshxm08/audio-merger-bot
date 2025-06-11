import { AudioBotService } from "../services/AudioBotService";
import { FileDownloadService } from "../services/FileDownloadService";
import { AudioMergeService } from "../services/AudioMergeService";
import { SessionManager } from "../services/SessionManager";

export class AudioAPI {
  private fileDownloadService: FileDownloadService;
  private audioMergeService: AudioMergeService;
  private sessionManager: SessionManager;

  constructor() {
    this.fileDownloadService = new FileDownloadService();
    this.audioMergeService = new AudioMergeService();
    this.sessionManager = new SessionManager();
  }

  // API methods for your future backend
  async mergeAudioFiles(filePaths: string[]): Promise<string> {
    return this.audioMergeService.mergeAudios(filePaths);
  }

  async downloadAndMerge(fileUrls: string[], userId: number): Promise<string> {
    const downloads = await Promise.all(
      fileUrls.map((url) => this.fileDownloadService.downloadFile(url, userId))
    );

    try {
      const outputPath = await this.audioMergeService.mergeAudios(
        downloads.map((d) => d.path)
      );

      return outputPath;
    } finally {
      // Cleanup
      await Promise.all(downloads.map((d) => d.cleanup()));
    }
  }

  getUserSession(userId: number) {
    return this.sessionManager.getSession(userId);
  }

  addAudioToQueue(userId: number, fileId: string, fileName: string) {
    return this.sessionManager.addAudioFile(userId, {
      fileId,
      fileName,
      userId,
      timestamp: Date.now(),
    });
  }
}
