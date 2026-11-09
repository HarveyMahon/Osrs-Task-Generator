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
for (const s of data.skills.skills) for (const a of s.activities || []) if (a.consumes && !known.has(a.consumes)) problems.push(`unknown item "${a.consumes}"`);

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
const ALL = gen.CATEGORIES.map((c) => c.id);
const ROLLS = 2000;
let rolls = 0, immediateRepeats = 0;
for (const t of gen.TIERS) {
  for (const cats of ALL.map((c) => [c]).concat([ALL])) {
    const settings = { tier: t.id, categories: cats, exclude: [], maxMinutes: gen.MAX_MINUTES };
    const recent = [];
    const seen = new Set();
    for (let i = 0; i < ROLLS; i++) {
      const c = gen.pickChallenge(pool, settings, recent);
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
if (gen.pickChallenge(pool, { tier: 'casual', categories: [] }, []) !== null) problems.push('empty category list should yield null');
console.log(`Rolled ${rolls} challenges; immediate repeats: ${immediateRepeats}`);

// 5. Opt-outs, time limit, lock-and-reroll and the daily challenge.
const everyFlag = gen.EXCLUDES.map((x) => x.id);
for (const c of pool) {
  if (!c.subject || !c.variant || !Array.isArray(c.flags)) problems.push(`${c.id}: missing subject/variant/flags`);
  for (const f of c.flags) if (!everyFlag.includes(f)) problems.push(`${c.id}: unknown flag ${f}`);
}
for (const t of gen.TIERS) {
  for (const cat of ALL) {
    const strict = gen.filterPool(pool, { tier: t.id, categories: [cat], exclude: everyFlag });
    if (!strict.length) problems.push(`every opt-out ticked leaves nothing: ${t.id} / ${cat}`);
    if (strict.some((c) => c.flags.length)) problems.push(`opt-outs leaked: ${t.id} / ${cat}`);
  }
  const limit = t.min + 15;
  const timed = gen.filterPool(pool, { tier: t.id, categories: ALL, exclude: [], maxMinutes: limit });
  if (!timed.length || timed.some((c) => c.targetMinutes > limit)) problems.push(`time limit broken for ${t.id}`);
  const settings = { tier: t.id, categories: ALL, exclude: [] };
  let rerolled = 0;
  for (let i = 0; i < 300; i++) {
    const c = gen.pickChallenge(pool, settings, []);
    for (const keep of ['subject', 'variant']) {
      const r = gen.rerollKeeping(pool, settings, c, keep);
      if (!r) continue;
      rerolled++;
      if (r.id === c.id || r.tier !== c.tier || r.category !== c.category) problems.push(`bad reroll from ${c.id}`);
      if (keep === 'subject' && r.subject !== c.subject) problems.push(`reroll changed the target: ${c.id}`);
      if (keep === 'variant' && (r.variant !== c.variant || r.subject === c.subject)) problems.push(`reroll changed the rules: ${c.id}`);
    }
  }
  if (!rerolled) problems.push(`no rerolls possible in ${t.id}`);
  const days = new Set();
  for (let d = 1; d <= 28; d++) {
    const date = `2026-11-${String(d).padStart(2, '0')}`;
    const daily = gen.dailyChallenge(pool, t.id, date);
    if (!daily || daily.tier !== t.id) { problems.push(`no daily for ${t.id} on ${date}`); continue; }
    if (daily.flags.includes('task')) problems.push(`daily needs a Slayer task: ${daily.id}`);
    if (gen.dailyChallenge(pool, t.id, date).id !== daily.id) problems.push(`daily not stable: ${t.id} ${date}`);
    days.add(daily.id);
  }
  if (days.size < 20) problems.push(`daily repeats too often in ${t.id} (${days.size} distinct in 28 days)`);
}
// 6. Share codes are unique and round-trip; every referenced icon file exists.
const codes = new Map();
for (const c of pool) {
  if (codes.has(c.code)) problems.push(`share code collision: ${c.id} / ${codes.get(c.code)}`);
  codes.set(c.code, c.id);
  if (!/^[a-z0-9]+$/.test(c.code) || gen.findByCode(pool, c.code) !== c) problems.push(`bad share code for ${c.id}`);
  if (c.icon && !fs.existsSync(path.join(__dirname, '..', c.icon))) problems.push(`missing icon file ${c.icon}`);
}
const iconFiles = fs.existsSync(path.join(dir, 'icons')) ? fs.readdirSync(path.join(dir, 'icons')) : [];
const used = new Set(data.items.items.map((i) => i.icon).filter(Boolean));
for (const f of iconFiles) if (!used.has(f)) problems.push(`orphan icon file ${f}`);
console.log(`Share codes unique; ${pool.filter((c) => c.icon).length} challenges have an icon (${iconFiles.length} files).`);
console.log('Opt-out, time-limit, reroll and daily checks done.');

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error('  - ' + p);
  process.exit(1);
}
console.log('All generator checks passed.');
