import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export const LOG_FILE_NAME = 'typetype.log';
export const APP_VERSION = resolveAppVersion();

function resolveAppVersion(): string {
  const electronVersion = app?.getVersion?.();
  if (electronVersion) {
    return electronVersion;
  }

  try {
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getLogDirectory(): string {
  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableExecutableDir) {
    return portableExecutableDir;
  }

  if (app?.isPackaged) {
    return path.dirname(app.getPath('exe'));
  }

  return process.cwd();
}

export function getLogFilePath(): string {
  return path.join(getLogDirectory(), LOG_FILE_NAME);
}

export function installFileLogger(): string {
  const logDir = getLogDirectory();
  const logPath = getLogFilePath();
  fs.mkdirSync(logDir, { recursive: true });

  const writeLine = (level: string, parts: unknown[]) => {
    const rendered = parts.map((part) => {
      if (part instanceof Error) {
        return part.stack || part.message;
      }

      if (typeof part === 'string') {
        return part;
      }

      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    }).join(' ');

    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] [${level}] [v${APP_VERSION}] ${rendered}\n`,
      'utf8'
    );
  };

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...parts: unknown[]) => {
    writeLine('INFO', parts);
    originalLog(...parts);
  };

  console.warn = (...parts: unknown[]) => {
    writeLine('WARN', parts);
    originalWarn(...parts);
  };

  console.error = (...parts: unknown[]) => {
    writeLine('ERROR', parts);
    originalError(...parts);
  };

  writeLine('INFO', ['Logger initialized at', logPath]);
  return logPath;
}
