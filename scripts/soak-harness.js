#!/usr/bin/env node
import fs from 'node:fs';

const shapes = ['box-carton', 'flat-mailer', 'bottle-profile', 'phone-slab', 'handbag-tote', 'irregular-shard', 'bicycle-chunk', 'skull-icon'];
const schedule = shapes.map((shapeId, index) => ({
  frame: index * 16,
  shapeId,
  scale: 0.9 + (index % 3) * 0.05,
  jitter: 2 + index,
}));

fs.mkdirSync('dist', { recursive: true });
const target = 'dist/soak-schedule.json';
fs.writeFileSync(target, JSON.stringify({ created: new Date().toISOString(), schedule }, null, 2));
console.log(`Soak schedule written to ${target}`);
