// src/logger.ts
const originalLog = console.log;
const originalError = console.error;

console.log = (...args) => {
  originalLog(`[${new Date().toISOString()}]`, ...args);
};

console.error = (...args) => {
  originalError(`[${new Date().toISOString()}]`, ...args);
};

export {}; // Make it a module
