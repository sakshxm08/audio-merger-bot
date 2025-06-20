// Add IST timestamps using Intl.DateTimeFormat
const originalLog = console.log;
const originalError = console.error;

const getISTTimestamp = () => {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const formatted = `${parts[4].value}-${parts[2].value}-${parts[0].value} ${parts[6].value}:${parts[8].value}:${parts[10].value} IST`;
  return formatted;
};

console.log = (...args) => {
  originalLog(`[${getISTTimestamp()}]`, ...args);
};

console.error = (...args) => {
  originalError(`[${getISTTimestamp()}]`, ...args);
};

export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  log(message: string, ...args: any[]) {
    console.log(`[${this.context}] ${message}`, ...args);
  }

  error(message: string, error?: any) {
    console.error(`[${this.context}] ${message}`, error);
  }

  warn(message: string, ...args: any[]) {
    console.log(`[${this.context}] WARN: ${message}`, ...args);
  }

  info(message: string, ...args: any[]) {
    console.log(`[${this.context}] INFO: ${message}`, ...args);
  }
}
