// Ready-made tracks. Each one is just a loop of centerline points plus a road width.

import { vec } from './geometry.ts';
import { type TrackDefinition, createOvalTrack } from './track.ts';

export const TRACKS: TrackDefinition[] = [
  createOvalTrack({ length: 800, height: 400, trackWidth: 80 }),
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
  {
    name: 'Maze',
    width: 55,
    points: [
      vec(150, 150),
      vec(700, 130),
      // chicane
      vec(820, 220),
      vec(940, 130),
      vec(1060, 220),
      vec(1180, 130),
      vec(1500, 140),
      // zigzag down the right side
      vec(1650, 240),
      vec(1620, 360),
      vec(1380, 380),
      vec(1310, 470),
      vec(1380, 560),
      vec(1620, 580),
      vec(1670, 700),
      vec(1580, 800),
      vec(1300, 820),
      // four hairpins in a row
      vec(1200, 900),
      vec(1200, 1000),
      vec(1170, 1070),
      vec(1080, 1070),
      vec(1050, 1000),
      vec(1050, 650),
      vec(1020, 580),
      vec(930, 580),
      vec(900, 650),
      vec(900, 1000),
      vec(870, 1070),
      vec(780, 1070),
      vec(750, 1000),
      vec(750, 650),
      vec(720, 580),
      vec(630, 580),
      vec(600, 650),
      vec(600, 1000),
      vec(520, 1090),
      vec(300, 1100),
      // S-bends up the left side
      vec(150, 1000),
      vec(250, 850),
      vec(130, 700),
      vec(250, 550),
      vec(130, 400),
      vec(120, 250),
    ],
  },
];
