import * as fsp from "fs/promises";
import * as path from "path";
import "./logger";

// Cleanup function to remove files older than specified hours
async function cleanupOldFiles(
  directory: string,
  hoursOld: number = 24
): Promise<number> {
  try {
    const threshold = Date.now() - hoursOld * 60 * 60 * 1000;
    let removedCount = 0;

    async function walkDirectory(dir: string) {
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkDirectory(fullPath);
          } else if (entry.isFile()) {
            try {
              const stats = await fsp.stat(fullPath);
              if (stats.mtime.getTime() < threshold) {
                await fsp.unlink(fullPath);
                removedCount++;
                console.log(`Removed old file: ${fullPath}`);
              }
            } catch (error) {
              console.error(`Failed to process file ${fullPath}:`, error);
            }
          }
        }
      } catch (error) {
        console.error(`Failed to read directory ${dir}:`, error);
      }
    }

    await walkDirectory(directory);
    return removedCount;
  } catch (error) {
    console.error(`Cleanup failed for directory ${directory}:`, error);
    return 0;
  }
}

// Run cleanup immediately and periodically
async function startPeriodicCleanup(
  directory: string,
  intervalHours: number = 24
) {
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Run cleanup immediately on startup
  const removedCount = await cleanupOldFiles(directory, intervalHours);
  console.log(
    `Initial cleanup: Removed ${removedCount} old files from ${directory}`
  );

  // Set up periodic cleanup
  setInterval(async () => {
    try {
      const removedCount = await cleanupOldFiles(directory, intervalHours);
      if (removedCount > 0) {
        console.log(
          `Periodic cleanup: Removed ${removedCount} old files from ${directory}`
        );
      } else {
        console.log(
          `Periodic cleanup: No files older than ${intervalHours} hours found in ${directory}`
        );
      }
    } catch (error) {
      console.error("Periodic cleanup error:", error);
    }
  }, intervalMs);

  console.log(
    `Periodic cleanup started for ${directory} (every ${intervalHours} hours)`
  );
}

// Run the cleanup service if this file is executed directly
if (require.main === module) {
  const directory =
    process.env.CLEANUP_DIRECTORY || "/var/lib/telegram-bot-api";
  const intervalHours = Number(process.env.CLEANUP_INTERVAL_HOURS) || 24;

  startPeriodicCleanup(directory, intervalHours).catch((error) => {
    console.error("Cleanup service failed:", error);
    process.exit(1);
  });
}

export { cleanupOldFiles, startPeriodicCleanup };
