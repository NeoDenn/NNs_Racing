// Training in the terminal, without the browser: runs until CTRL + C.
// After every generation the best genome is saved to saves/best-genome.json, and the next run (here or on the page)
// starts from it.
//
//   npm run train                  continues on the saved track (or the default one)
//   npm run train -- Maze          continues on the Maze track

import { DEFAULT_TRACK, MAX_GENERATION_TIME, Trainer, findTrack } from '../src/training.ts';
import { SAVE_PATH, readSave, writeSave } from './saveFile.ts';

const save = readSave();
declare const process: { argv: string[] };

const track = findTrack(process.argv[2] ?? save?.track ?? DEFAULT_TRACK);
const trainer = new Trainer(track, save ?? undefined);

console.log(save ? `Continuing from generation ${save.generation} (${SAVE_PATH})` : 'No save file, starting from scratch');
console.log(`Track ${track.name}, ${MAX_GENERATION_TIME}s per generation. CTRL + C to stop\n`);

const LOG_EVERY = 10; // generations per log line (the save is still written after every generation)

const laps = (checkpoints: number) => (checkpoints / track.checkpoints.length).toFixed(2);
let batchStart = performance.now();
let batchGenerations = 0;

for (;;) {
  const stats = trainer.step();
  if (!stats) continue;

  writeSave(trainer.toSave()!);
  if (++batchGenerations < LOG_EVERY) continue;

  const seconds = ((performance.now() - batchStart) / 1000).toFixed(1);
  console.log(
    `generation ${stats.generation}   species ${stats.species}   best ${laps(stats.best.rawFitness)} laps   ` +
      `best ever ${laps(stats.bestEver.rawFitness)} laps   (${seconds}s for ${LOG_EVERY} generations)`,
  );
  batchStart = performance.now();
  batchGenerations = 0;
}
