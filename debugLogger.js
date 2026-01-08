import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logFile = path.join(__dirname, 'debug_log.txt');

export function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    fs.appendFile(logFile, logLine, (err) => {
        if (err) console.error('Failed to write to log file:', err);
    });
}
