#!/usr/bin/env node
/* Sanity-checks the challenge generator against the bundled dataset.
 * Usage: node scripts/check_generator.js   (exits non-zero on any problem) */
'use strict';
const fs = require('fs');
const path = require('path');
const gen = require('../app.js');

const dir = path.join(__dirname, '..', 'data');
const data = {};
for (const name of ['items', 'monsters', 'skills', 'minigames', 'quests', 'meta']) {
  data[name] = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
}
const problems = [];
const pool = gen.buildPool(data);
const tiers = Object.fromEntries(gen.TIERS.map((t) => [t.id, t]));

// 1. Every drop/consumable must reference a known item.
const known = new Set(data.items.items.map((i) => i.name));
for (const m of data.monsters.monsters) for (const d of m.drops) if (!known.has(d.item)) problems.push(`unknown item "${d.item}" on ${m.name}`);
for (const s of data.skills.skills) for (const a of s.activities) if (a.consumes && !known.has(a.consumes)) problems.push(`unknown item "${a.consumes}"`);

// 2. Structural checks on every challenge in the pool.
const ids = new Set();
for (const c of pool) {
  const t = tiers[c.tier];
  if (ids.has(c.id)) problems.push(`duplicate id ${c.id}`);
  ids.add(c.id);
  for (const f of ['title', 'description', 'success', 'failure']) {
    if (typeof c[f] !== 'string' || c[f].trim().length < 8) problems.push(`${c.id}: missing ${f}`);
    else if (/undefined|null|NaN|\{n\}|\{s\}/.test(c[f])) problems.push(`${c.id}: bad text in ${f}: ${c[f]}`);
  }
  for (const r of c.rules) if (/undefined|null|NaN/.test(r)) problems.push(`${c.id}: bad rule text: ${r}`);
  if (c.stake && /undefined|null|NaN/.test(c.stake)) problems.push(`${c.id}: bad stake text`);
  if (!t) { problems.push(`${c.id}: unknown tier`); continue; }
  if (!(c.targetMinutes >= t.min && c.targetMinutes <= t.max)) problems.push(`${c.id}: target ${c.targetMinutes} outside ${c.tier} window`);
  if (c.targetMinutes > gen.MAX_MINUTES) problems.push(`${c.id}: exceeds 3 hours`);
  if (c.tier === 'casual' && (c.tags.includes('Wilderness') || /\bdie\b|death ends/i.test(c.failure))) problems.push(`${c.id}: casual challenge with death risk`);
  if (c.category === 'luck' && !/within [\d,]+ /.test(c.description)) problems.push(`${c.id}: luck challenge without an attempt cap`);
}

// 3. Pool sizes per tier x category, and distinct challenges overall.
console.log(`Pool: ${pool.length} distinct challenges`);
const header = ['tier'.padEnd(10)].concat(gen.CATEGORIES.map((c) => c.id.padStart(10))).join('');
console.log(header);
for (const t of gen.TIERS) {
  let row = t.id.padEnd(10);
  for (const c of gen.CATEGORIES) {
    const n = pool.filter((x) => x.tier === t.id && x.category === c.id).length;
    if (n === 0) problems.push(`empty pool: ${t.id} / ${c.id}`);
    row += String(n).padStart(10);
  }
  console.log(row);
}
if (pool.length < 300) problems.push('pool smaller than "several hundred"');

// 4. Roll many times per tier x category, the way the UI does.
const ROLLS = 2000;
let rolls = 0, immediateRepeats = 0;
for (const t of gen.TIERS) {
  for (const cats of gen.CATEGORIES.map((c) => [c.id]).concat([gen.CATEGORIES.map((c) => c.id)])) {
    const recent = [];
    const seen = new Set();
    for (let i = 0; i < ROLLS; i++) {
      const c = gen.pickChallenge(pool, t.id, cats, recent);
      rolls++;
      if (!c) { problems.push(`roll returned nothing: ${t.id} / ${cats}`); break; }
      if (c.tier !== t.id || !cats.includes(c.category)) problems.push(`roll ignored settings: ${c.id}`);
      if (recent.length && recent[recent.length - 1] === c.id) immediateRepeats++;
      recent.push(c.id); if (recent.length > 12) recent.shift();
      seen.add(c.id);
    }
    if (cats.length === 1 && seen.size < 10) problems.push(`low variety (${seen.size}) for ${t.id} / ${cats}`);
  }
}
if (immediateRepeats) problems.push(`${immediateRepeats} immediate repeats`);
if (gen.pickChallenge(pool, 'casual', [], []) !== null) problems.push('empty category list should yield null');
console.log(`Rolled ${rolls} challenges; immediate repeats: ${immediateRepeats}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error('  - ' + p);
  process.exit(1);
}
console.log('All generator checks passed.');
