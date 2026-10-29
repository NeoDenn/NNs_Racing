// Reads and writes the save file. Used by the terminal (train.ts) and by the dev server for the page (vite.config.ts).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SaveFile } from '../src/training.ts';

export const SAVE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../saves/best-genome.json');

export function readSave(): SaveFile | null {
  if (!existsSync(SAVE_PATH)) return null;
  return JSON.parse(readFileSync(SAVE_PATH, 'utf8')) as SaveFile;
}

// Written to a temporary file and then renamed, so stopping with CTRL + C never leaves a half-written file
export function writeSave(save: SaveFile): void {
  mkdirSync(dirname(SAVE_PATH), { recursive: true });
  const tmp = SAVE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(save, null, 2));
  renameSync(tmp, SAVE_PATH);
}

export function deleteSave(): void {
  rmSync(SAVE_PATH, { force: true });
}
