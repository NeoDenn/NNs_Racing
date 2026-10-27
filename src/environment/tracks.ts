// Ready-made tracks. Each one is just a loop of centerline points plus a road width.

import { vec } from './geometry.ts';
import { type TrackDefinition, createOvalTrack } from './track.ts';

export const TRACKS: TrackDefinition[] = [
  createOvalTrack({ length: 800, height: 400, trackWidth: 80 }),
  {
    name: 'Classic',
    width: 80,
    points: [
      vec(150, 450),
      vec(180, 220),
      vec(380, 130),
      vec(560, 250),
      vec(740, 140),
      vec(980, 180),
      vec(1060, 420),
      vec(900, 640),
      vec(620, 590),
      vec(380, 690),
      vec(190, 640),
    ],
  },
  {
    name: 'Twisty',
    width: 60,
    points: [
      vec(150, 140),
      vec(440, 120),
      // chicane
      vec(560, 200),
      vec(680, 120),
      vec(800, 200),
      vec(920, 120),
      // S-bend on the right
      vec(1070, 140),
      vec(1150, 230),
      vec(1160, 280),
      vec(1040, 370),
      vec(1040, 420),
      vec(1150, 520),
      vec(1100, 660),
      vec(940, 720),
      // hairpin in the middle
      vec(790, 660),
      vec(760, 420),
      vec(680, 370),
      vec(600, 420),
      vec(580, 660),
      vec(460, 720),
      vec(260, 720),
      // S-bend on the left
      vec(120, 610),
      vec(200, 470),
      vec(110, 330),
    ],
  },
];
