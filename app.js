/* OSRS Task Generator: challenge generation + UI. No dependencies, no build step.
 * The generator half (everything above "UI") is pure and also runs under Node
 * so scripts/check_generator.js can exercise it. */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- config
  var TIERS = [
    { id: 'casual', range: '15 to 45 minutes', label: 'Casual', blurb: 'Short and safe. No death risk.', min: 10, max: 45, durations: [20, 30, 45], luckMinutes: 40, luckBand: [0.25, 1] },
    { id: 'standard', range: '45 to 90 minutes', label: 'Standard', blurb: 'A proper session with a rule or two.', min: 46, max: 90, durations: [60, 75, 90], luckMinutes: 80, luckBand: [0.15, 0.55] },
    { id: 'hardcore', range: '1.5 to 2.25 hours', label: 'Hardcore', blurb: 'Long, restricted, and deaths matter.', min: 91, max: 135, durations: [105, 120, 135], luckMinutes: 120, luckBand: [0.05, 0.2] },
    { id: 'extreme', range: '2.25 to 3 hours', label: 'Extreme', blurb: 'Most of three hours. Bring snacks (IRL).', min: 136, max: 180, durations: [150, 165, 180], luckMinutes: 170, luckBand: [0.008, 0.07] }
  ];
  var CATEGORIES = [
    { id: 'combat', label: 'Combat', hint: 'bosses, slayer, PvM' },
    { id: 'skilling', label: 'Skilling', hint: 'training, gathering, production' },
    { id: 'minigames', label: 'Minigames & activities', hint: 'games, clues, side content' },
    { id: 'luck', label: 'Pets & rare drops', hint: 'luck hunts with an attempt cap' },
    { id: 'quests', label: 'Quests & diaries', hint: 'quest speedruns, boss rematches, diary laps' }
  ];
  var MAX_MINUTES = 180;
  var TIER_ORDER = { casual: 0, standard: 1, hardcore: 2, extreme: 3 };

  // --------------------------------------------------------------- helpers
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fmtGp(v) {
    if (v == null) return null;
    if (v >= 1e9) return trim(v / 1e9) + 'b gp';
    if (v >= 1e6) return trim(v / 1e6) + 'm gp';
    if (v >= 1e3) return trim(v / 1e3) + 'k gp';
    return v + ' gp';
  }
  function trim(x) { return (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString(); }
  function fmtMinutes(m) {
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }
  function round5(x) { return Math.max(5, Math.round(x / 5) * 5); }
  function niceFloor(x) {
    var step = x < 20 ? 1 : x < 100 ? 5 : x < 300 ? 10 : x < 1000 ? 50 : x < 5000 ? 100 : 500;
    return Math.floor(x / step + 1e-9) * step;
  }
  function plural(label, n) { return n === 1 ? label : label + 's'; }
  function fillTask(task, n) {
    return task.replace('{n}', fmtNum(n)).replace('{s}', n === 1 ? '' : 's');
  }
  function tierForMinutes(m) {
    for (var i = 0; i < TIERS.length; i++) if (m >= TIERS[i].min && m <= TIERS[i].max) return TIERS[i];
    return null;
  }
  /* How many units fit a time slot? Rounds DOWN to a friendly number, then
   * derives the target time from the count, and rejects anything that falls
   * outside the tier's window (so nothing can exceed the tier or 3 hours). */
  function makeCount(perHour, minutes, tier) {
    var n = niceFloor(perHour * minutes / 60);
    if (n < 1) return null;
    var t = round5(n * 60 / perHour);
    if (t < tier.min || t > tier.max || t > MAX_MINUTES) return null;
    return { n: n, t: t };
  }
  function eachCount(perHour, tier, fn) {
    var seen = {};
    tier.durations.forEach(function (d) {
      var c = makeCount(perHour, d, tier);
      if (c && !seen[c.n]) { seen[c.n] = true; fn(c); }
    });
  }
  var STOP_FAIL = 'You call it a day (log out for good or move on to something else) before the count is reached.';

  // ------------------------------------------------------------- templates
  function combatMods(mon, tier, t, gp) {
    var tags = mon.tags || [], mods = [];
    var has = function (x) { return tags.indexOf(x) !== -1; };
    var trips;
    if (mon.type === 'raid') {
      // No banking inside these, so trip limits make no sense.
      if (tier.id === 'casual') return [{ key: 'chill', name: 'Easy does it', eff: 1, rules: ['Any gear, any method. Failed attempts only cost you time.'], fail: STOP_FAIL }];
      if (tier.id === 'extreme') return [{ key: 'iron', name: 'Iron will', eff: 1, rules: ['No special attacks.', 'No deaths (yours, if you are in a team).'], fail: 'You die, or you use a special attack.' }];
      return [{ key: 'deathless', name: 'Clean sheet', eff: 1, rules: ['No deaths (yours, if you are in a team).'], fail: 'You die before the count is reached.' }];
    }
    if (mon.wilderness) {
      if (tier.id === 'standard') mods.push({ key: 'alive', name: 'Get out alive', eff: 1, rules: ['No deaths. PKers count.'], fail: 'You die, to the boss or to another player.' });
      if (tier.id === 'hardcore') {
        mods.push({ key: 'risk', name: 'Risky business', eff: 1, rules: ['Carry at least ' + gp('Bandos chestplate') + ' of unprotected risk the whole time (about one Bandos chestplate).', 'No deaths.'], fail: 'You die, or you are caught carrying less risk than agreed.', stake: 'About ' + gp('Bandos chestplate') + ' at risk in the Wilderness.' });
        mods.push({ key: 'nospec', name: 'No specs, no slip-ups', eff: 0.9, rules: ['No special attacks.', 'No deaths. PKers count.'], fail: 'You die, or you use a special attack.' });
      }
      if (tier.id === 'extreme') {
        mods.push({ key: 'bigrisk', name: 'High roller', eff: 1, rules: ['Carry at least ' + gp('Amulet of torture') + ' of unprotected risk the whole time (about one Amulet of torture).', 'No deaths.'], fail: 'You die, or you are caught carrying less risk than agreed.', stake: 'About ' + gp('Amulet of torture') + ' at risk in the Wilderness.' });
        mods.push({ key: 'iron', name: 'Iron will', eff: 0.85, rules: ['No special attacks.', 'No teleporting out to restock more than twice.', 'No deaths. PKers count.'], fail: 'You die, use a special attack, or restock a third time.' });
      }
      return mods;
    }
    if (tier.id === 'casual') {
      trips = Math.max(2, Math.ceil(t / 15));
      mods.push({ key: 'chill', name: 'Easy does it', eff: 1, rules: ['Any gear, any method. Deaths only cost you time.'], fail: STOP_FAIL });
      mods.push({ key: 'trips', name: 'Tidy trips', eff: 1, rules: ['Use at most ' + trips + ' bank trips. A death counts as a trip.'], fail: 'You need bank trip number ' + (trips + 1) + ' before the count is reached.' });
    } else if (tier.id === 'standard') {
      trips = Math.max(2, Math.ceil(t / 25));
      mods.push({ key: 'deathless', name: 'Clean sheet', eff: 1, rules: ['No deaths.'], fail: 'You die before the count is reached.' });
      mods.push({ key: 'lunch', name: 'Packed lunch', eff: 0.9, rules: ['Use at most ' + trips + ' bank trips.', 'No deaths.'], fail: 'You die, or you need bank trip number ' + (trips + 1) + '.' });
    } else if (tier.id === 'hardcore') {
      trips = Math.max(2, Math.ceil(t / 40));
      mods.push({ key: 'nospec', name: 'No specs, no slip-ups', eff: 0.9, rules: ['No special attacks.', 'No deaths.'], fail: 'You die, or you use a special attack.' });
      mods.push({ key: 'supply', name: 'Supply run', eff: 0.85, rules: ['Use at most ' + trips + ' bank trips.', 'No deaths.'], fail: 'You die, or you need bank trip number ' + (trips + 1) + '.' });
      if (has('budget')) mods.push({ key: 'budget', name: 'Budget build', eff: 0.6, rules: ['No equipped item may be worth more than an Abyssal whip (about ' + gp('Abyssal whip') + ').', 'No deaths.'], fail: 'You die, or you equip anything worth more than an Abyssal whip.', stake: 'Gear cap: about ' + gp('Abyssal whip') + ' per item.' });
    } else {
      trips = Math.max(2, Math.ceil(t / 60));
      mods.push({ key: 'iron', name: 'Iron will', eff: 0.85, rules: ['No special attacks.', 'Use at most ' + trips + ' bank trips.', 'No deaths.'], fail: 'You die, use a special attack, or need bank trip number ' + (trips + 1) + '.' });
      if (has('nofood')) mods.push({ key: 'nofood', name: 'No snacks', eff: 0.8, rules: ['No food or Saradomin brews in your inventory, ever. Prayer potions are fine.', 'No deaths.'], fail: 'You die, or you eat or drink anything that heals.' });
      if (has('budget')) mods.push({ key: 'rune', name: 'Rune-tier cosplay', eff: 0.4, rules: ['No equipped item may be worth more than a Rune platebody (about ' + gp('Rune platebody') + ').', 'No deaths.'], fail: 'You die, or you equip anything worth more than a Rune platebody.', stake: 'Gear cap: about ' + gp('Rune platebody') + ' per item.' });
    }
    return mods;
  }

  function buildCombat(data, gp, out) {
    var seen = {};
    data.monsters.monsters.forEach(function (mon) {
      if (mon.type === 'other') return;
      TIERS.forEach(function (tier) {
        if (mon.wilderness && tier.id === 'casual') return;
        if (mon.taskOnly && TIER_ORDER[tier.id] > 1) return;
        // Mods are chosen from the slot length, then the count is scaled by the mod's efficiency.
        tier.durations.forEach(function (d) {
          combatMods(mon, tier, d, gp).forEach(function (mod) {
            var c = makeCount(mon.perHour * mod.eff, d, tier);
            if (!c) return;
            var id = ['combat', 'count', mon.name, tier.id, mod.key, c.n].join('|');
            if (seen[id]) return;
            seen[id] = true;
            var labels = plural(mon.label, c.n);
            var tags = [];
            if (mon.wilderness) tags.push('Wilderness');
            if (mon.team) tags.push('Team content');
            if (mon.taskOnly) tags.push('Needs a Slayer task');
            out.push({
              id: id,
              category: 'combat', kind: 'count:' + mon.type, tier: tier.id,
              title: fmtNum(c.n) + ' ' + labels + ': ' + mod.name,
              description: 'Rack up ' + fmtNum(c.n) + ' ' + labels + '.',
              rules: mod.rules, targetMinutes: c.t, tags: tags, stake: mod.stake || null,
              success: 'Your kill count or loot tracker shows ' + fmtNum(c.n) + ' new ' + labels + ' since you started, with every rule kept.',
              failure: mod.fail
            });
          });
        });
      });
    });

    data.monsters.slayerMasters.forEach(function (sm) {
      TIERS.forEach(function (tier) {
        if (sm.wilderness && tier.id === 'casual') return;
        var v = {
          casual: { rules: ['Skipping is allowed, but a skipped task does not count.'], fail: STOP_FAIL },
          standard: { rules: ['Take what you are given: no skipping or cancelling.', 'No deaths.'], fail: 'You skip or cancel a task, or you die.' },
          hardcore: { rules: ['No skipping or cancelling.', 'No dwarf multicannon.', 'No deaths.'], fail: 'You skip or cancel a task, place a cannon, or die.' },
          extreme: { rules: ['No skipping or cancelling.', 'No dwarf multicannon and no special attacks.', 'No deaths.'], fail: 'You skip or cancel a task, place a cannon, use a special attack, or die.' }
        }[tier.id];
        eachCount(sm.tasksPerHour, tier, function (c) {
          out.push({
            id: ['combat', 'slayer', sm.name, tier.id, c.n].join('|'),
            category: 'combat', kind: 'slayer', tier: tier.id,
            title: fmtNum(c.n) + ' Slayer ' + plural('task', c.n) + ' from ' + sm.name,
            description: 'Get ' + fmtNum(c.n) + ' ' + plural('assignment', c.n) + ' from ' + sm.name + ' and finish ' + (c.n === 1 ? 'it' : 'them all, back to back') + '. Task sizes vary a lot, so the time is a rough guess.',
            rules: v.rules, targetMinutes: c.t, tags: sm.wilderness ? ['Wilderness'] : [], stake: null,
            success: 'You have completed ' + fmtNum(c.n) + ' ' + plural('task', c.n) + ' assigned by ' + sm.name + ' since starting, with every rule kept.',
            failure: v.fail
          });
        });
      });
    });
  }

  function buildLuck(data, gp, isPet, out) {
    data.monsters.monsters.forEach(function (mon) {
      if (mon.team) return;
      mon.drops.forEach(function (drop) {
        TIERS.forEach(function (tier) {
          if (mon.wilderness && tier.id === 'casual') return;
          if (mon.taskOnly && TIER_ORDER[tier.id] > 1) return;
          var c = makeCount(mon.perHour, tier.luckMinutes, tier);
          if (!c) return;
          var chance = 1 - Math.pow(1 - 1 / drop.rate, c.n);
          if (chance < tier.luckBand[0] || chance > tier.luckBand[1]) return;
          var labels = plural(mon.label, c.n);
          var pct = chance >= 0.1 ? Math.round(chance * 100) : Math.round(chance * 1000) / 10;
          var value = gp(drop.item);
          var tags = ['About ' + pct + '% chance'];
          if (mon.wilderness) tags.push('Wilderness');
          if (mon.taskOnly) tags.push('Needs a Slayer task');
          out.push({
            id: ['luck', mon.name, drop.item, tier.id].join('|'),
            category: 'luck', kind: 'hunt:' + mon.type, tier: tier.id,
            title: drop.item + ' hunt',
            description: 'Get "' + drop.item + '" from ' + mon.name + ' within ' + fmtNum(c.n) + ' ' + labels + '. The drop rate is roughly 1/' + fmtNum(drop.rate) + ', so your odds are about ' + pct + '%.',
            rules: ['Count attempts from zero, starting now.'].concat(isPet(drop.item) ? ['A duplicate-pet message ("you have a funny feeling like you would have been followed") counts.'] : []),
            targetMinutes: c.t, tags: tags,
            stake: value ? 'The prize is worth about ' + value + '.' : null,
            success: '"' + drop.item + '" drops on or before ' + mon.label + ' number ' + fmtNum(c.n) + '.',
            failure: 'You reach ' + fmtNum(c.n) + ' ' + labels + ' without "' + drop.item + '".' + (mon.wilderness ? ' Dying does not reset or pause the count.' : '')
          });
        });
      });
    });
  }

  /* Shared by skilling and minigames: "do N of something", with the tier
   * deciding how strict the clock and the side rules are. */
  function volumeVariants(tier, c, wilderness) {
    var cap = Math.min(MAX_MINUTES, round5(c.t * 1.15));
    var die = wilderness ? ' Dying also ends the challenge.' : '';
    if (tier.id === 'casual') return [{ key: 'steady', name: 'no rush', rules: ['No clock pressure. Breaks are fine.'], fail: STOP_FAIL }];
    if (tier.id === 'standard') return [
      { key: 'sitting', name: 'one sitting', rules: ['One sitting: banking and restocking are fine, unrelated activities are not.'], fail: 'You do anything unrelated (or log out for more than 5 minutes) before the count is reached.' + die },
      { key: 'clock', name: 'beat the clock', rules: ['Hard limit: ' + fmtMinutes(Math.min(MAX_MINUTES, round5(c.t * 1.25))) + ' from your first action.'], fail: 'The count is not reached within ' + fmtMinutes(Math.min(MAX_MINUTES, round5(c.t * 1.25))) + '.' + die }
    ];
    if (tier.id === 'hardcore') return [{ key: 'race', name: 'race pace', rules: ['Hard limit: ' + fmtMinutes(cap) + ' from your first action.', 'One sitting, no unrelated activities.'], fail: 'The count is not reached within ' + fmtMinutes(cap) + ', or you wander off to do something else.' + die }];
    return [{ key: 'marathon', name: 'marathon', rules: ['Hard limit: ' + fmtMinutes(cap) + ' from your first action.', 'No break longer than 2 minutes.'], fail: 'The count is not reached within ' + fmtMinutes(cap) + ', or you stop for more than 2 minutes.' + die }];
  }

  function buildSkilling(data, gp, valueOf, out) {
    data.skills.skills.forEach(function (sk) {
      sk.activities.forEach(function (act) {
        TIERS.forEach(function (tier) {
          if (act.wilderness && tier.id === 'casual') return;
          eachCount(act.perHour, tier, function (c) {
            var what = fillTask(act.task, c.n);
            var stake = null;
            if (act.consumes && valueOf(act.consumes) != null) {
              stake = 'Burns through about ' + fmtGp(valueOf(act.consumes) * (act.consumesPer || 1) * c.n) + ' of ' + act.consumes.toLowerCase() + '.';
            }
            if (act.wilderness) stake = (stake ? stake + ' ' : '') + 'Whatever you carry is at risk in the Wilderness.';
            volumeVariants(tier, c, act.wilderness).forEach(function (v) {
              out.push({
                id: ['skilling', sk.skill, act.task, tier.id, v.key, c.n].join('|'),
                category: 'skilling', kind: 'skill:' + sk.skill, tier: tier.id,
                title: sk.skill + ': ' + what.charAt(0).toLowerCase() + what.slice(1) + ' (' + v.name + ')',
                description: what + '.',
                rules: v.rules, targetMinutes: c.t, tags: act.wilderness ? ['Wilderness'] : [], stake: stake,
                success: 'You have done it: ' + what.charAt(0).toLowerCase() + what.slice(1) + ', counted from when you started.',
                failure: v.fail
              });
            });
          });
        });
      });
    });
  }

  function buildMinigames(data, out) {
    data.minigames.minigames.forEach(function (mg) {
      TIERS.forEach(function (tier) {
        eachCount(mg.perHour, tier, function (c) {
          var what = fillTask(mg.task, c.n);
          var twist = mg.twist && TIER_ORDER[tier.id] >= TIER_ORDER[mg.twist.minTier] ? mg.twist : null;
          volumeVariants(tier, c, false).forEach(function (v) {
            var rules = v.rules.slice(), fail = v.fail, key = v.key;
            if (twist) {
              // The twist replaces the plain "one sitting" flavour and stacks on the timed ones.
              if (v.key === 'sitting') { rules = [twist.rule]; fail = twist.fail; }
              else { rules.push(twist.rule); fail = twist.fail + ' Also failed if: ' + v.fail.charAt(0).toLowerCase() + v.fail.slice(1); }
              key += '+twist';
            }
            out.push({
              id: ['minigames', mg.name, tier.id, key, c.n].join('|'),
              category: 'minigames', kind: 'mg:' + mg.name, tier: tier.id,
              title: mg.name + ' × ' + fmtNum(c.n) + (twist ? ' (with a twist)' : ' (' + v.name + ')'),
              description: what + '.',
              rules: rules, targetMinutes: c.t, tags: mg.team ? ['Needs other players'] : [], stake: null,
              success: 'You have done it: ' + what.charAt(0).toLowerCase() + what.slice(1) + ', with every rule kept.',
              failure: fail
            });
          });
        });
      });
    });
  }

  function buildQuests(data, out) {
    var q = data.quests;
    // Quests can only be replayed on Quest Speedrunning worlds, so only the
    // quests offered there are used, with the wiki's trophy times.
    var trophyTiers = { casual: ['bronze', 'silver'], standard: ['bronze', 'silver', 'gold'], hardcore: ['silver', 'gold', 'platinum'], extreme: ['gold', 'platinum'] };
    var clock = function (sec) {
      var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = sec % 60;
      return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (r < 10 ? '0' : '') + r;
    };
    q.speedrunQuests.forEach(function (sq) {
      TIERS.forEach(function (tier) {
        trophyTiers[tier.id].forEach(function (trophy) {
          // A run costs at most the trophy time (slower runs get reset) plus ~2 minutes of setup.
          var perRun = sq[trophy] / 60 + 2;
          var cap = Math.min(40, Math.floor(tier.durations[1] / perRun));
          if (cap < 1) return;
          var t = round5(cap * perRun);
          if (t < tier.min || t > tier.max) return;
          var runs = cap + ' ' + plural('run', cap);
          out.push({
            id: ['quests', 'speedrun', sq.name, tier.id, trophy].join('|'), category: 'quests', kind: 'speedrun:' + sq.name, tier: tier.id,
            title: 'Speedrun: ' + sq.name + ' (' + trophy + ')',
            description: 'Hop to a Quest Speedrunning world and beat the ' + trophy + ' trophy time of ' + clock(sq[trophy]) + ' on ' + sq.name + ', within ' + runs + '.',
            rules: ['You get ' + runs + '. Starting a run uses one up, even if you reset it.'],
            targetMinutes: t, tags: ['Speedrunning world'], stake: null,
            success: 'One of your ' + runs + ' finishes ' + sq.name + ' in ' + clock(sq[trophy]) + ' or faster.',
            failure: 'Run number ' + cap + ' ends (or is reset) without beating ' + clock(sq[trophy]) + '.'
          });
        });
      });
    });

    var bosses = q.nmzBosses;
    bosses.forEach(function (b) {
      out.push({
        id: ['quests', 'nmz', b.name].join('|'), category: 'quests', kind: 'nmz', tier: 'casual',
        title: 'Dream rematch: ' + b.name,
        description: 'Start a hard customisable rumble in the Nightmare Zone with ' + b.name + ' (' + b.quest + ') enabled, and beat them again.',
        rules: ['No overhead protection prayers.', 'No absorption or overload potions.', 'Getting knocked out in the dream is safe; it just ends the attempt.'],
        targetMinutes: 15, tags: ['Needs ' + b.quest + ' completed'], stake: null,
        success: b.name + ' is defeated in a hard rumble with the rules kept.',
        failure: 'You wake up (knocked out or leaving by choice) before ' + b.name + ' is defeated, or you break a rule.'
      });
    });
    function rush(size, step, tierId, t, rules) {
      for (var i = 0; i < bosses.length; i += step) {
        var names = [];
        for (var j = 0; j < size; j++) names.push(bosses[(i + j) % bosses.length].name);
        out.push({
          id: ['quests', 'rush', tierId, i].join('|'), category: 'quests', kind: 'nmz-rush', tier: tierId,
          title: 'Quest boss rush (' + size + ' bosses)',
          description: 'Enable exactly these bosses in a hard customisable Nightmare Zone rumble and defeat every one of them at least once in a single dream: ' + names.join(', ') + '.',
          rules: rules, targetMinutes: t, tags: ['Needs the related quests completed'], stake: null,
          success: 'Every listed boss has been defeated at least once in one dream, with the rules kept.',
          failure: 'The dream ends (you die or leave) before every listed boss has fallen, or you break a rule.'
        });
      }
    }
    rush(5, 1, 'standard', 50, ['No absorption or overload potions.', 'No overhead protection prayers.']);
    rush(10, 2, 'hardcore', 95, ['No dream potions (absorption, overload, super ranging, super magic).']);
    rush(20, 5, 'extreme', 150, ['No dream potions.', 'No power-ups.']);

    var d = q.diaries;
    var combos = [[0], [1], [2], [3], [0, 1], [1, 2], [0, 1, 2]];
    d.areas.forEach(function (area) {
      var wild = area === 'Wilderness';
      combos.forEach(function (combo) {
        var mins = combo.reduce(function (a, i) { return a + d.tiers[i].minutes; }, 0);
        var tier = tierForMinutes(mins);
        if (!tier || (wild && tier.id === 'casual')) return;
        var names = combo.map(function (i) { return d.tiers[i].name; });
        var safe = tier.id === 'casual';
        out.push({
          id: ['quests', 'diary', area, names.join('+')].join('|'), category: 'quests', kind: 'diary', tier: tier.id,
          title: 'Diary victory lap: ' + area + ' ' + names.join(' + '),
          description: 'Open the ' + area + ' achievement diary and perform every task on the ' + names.join(' and ') + ' ' + plural('list', names.length) + ' again (or for the first time), in any order, using the journal as your checklist.',
          rules: ['One-off tasks that genuinely cannot be repeated count as done.'].concat(safe ? [] : ['No deaths.']),
          targetMinutes: mins, tags: wild ? ['Wilderness'] : [], stake: null,
          success: 'Every repeatable task on the ' + names.join(' and ') + ' ' + plural('list', names.length) + ' has been performed since you started.',
          failure: (safe ? 'You stop' : 'You die, or you stop') + ' before the last task is done.'
        });
      });
    });
  }

  // ------------------------------------------------------------------ pool
  function buildPool(data) {
    var values = {}, pets = {};
    (data.items.items || []).forEach(function (it) { values[it.name] = it.value; if (it.pet) pets[it.name] = true; });
    var valueOf = function (name) { return values[name] == null ? null : values[name]; };
    var gp = function (name) { return fmtGp(valueOf(name)); };
    var out = [];
    buildCombat(data, function (n) { return gp(n) || 'a few hundred k gp'; }, out);
    buildSkilling(data, gp, valueOf, out);
    buildMinigames(data, out);
    buildLuck(data, gp, function (n) { return !!pets[n]; }, out);
    buildQuests(data, out);
    return out;
  }

  /* Pick: category first (so big categories do not drown small ones), then a
   * "kind" within it (so one boss with many variants does not dominate), then
   * a challenge, avoiding anything in `recent` where an alternative exists. */
  function pickChallenge(pool, tierId, categoryIds, recent, rng) {
    rng = rng || Math.random;
    recent = recent || [];
    var pick = function (arr) { return arr[Math.floor(rng() * arr.length)]; };
    var eligible = pool.filter(function (c) { return c.tier === tierId && categoryIds.indexOf(c.category) !== -1; });
    if (!eligible.length) return null;
    var fresh = eligible.filter(function (c) { return recent.indexOf(c.id) === -1; });
    if (fresh.length) eligible = fresh;
    else if (eligible.length > 1) {
      var last = recent[recent.length - 1];
      eligible = eligible.filter(function (c) { return c.id !== last; });
    }
    var byCat = {};
    eligible.forEach(function (c) { (byCat[c.category] = byCat[c.category] || []).push(c); });
    var inCat = byCat[pick(Object.keys(byCat))];
    var byKind = {};
    inCat.forEach(function (c) { (byKind[c.kind] = byKind[c.kind] || []).push(c); });
    return pick(byKind[pick(Object.keys(byKind))]);
  }

  var api = { TIERS: TIERS, CATEGORIES: CATEGORIES, MAX_MINUTES: MAX_MINUTES, buildPool: buildPool, pickChallenge: pickChallenge, fmtMinutes: fmtMinutes, fmtGp: fmtGp };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  root.OsrsTasks = api;
  if (typeof document === 'undefined') return;

  // ==================================================================== UI
  var STORE_KEY = 'osrs-task-generator:v1';
  var DATA_FILES = ['items', 'monsters', 'skills', 'minigames', 'quests', 'meta'];
  var QUIPS = {
    combat: ['Sit, rat.', 'Bank your loot. Or do not. We are not your mum.', 'Remember: the boss has no idea you are on a challenge.', 'Protect from Missiles, pray for luck.'],
    skilling: ['Number go up.', 'Podcast recommended.', '92 is half of 99, and this is a fraction of that.', 'Your wrists called. They said "stretch".'],
    minigames: ['It is called a minigame, yet here we are.', 'Blame your team. Everyone does.', 'Points are temporary, bragging is forever.'],
    luck: ['Going dry builds character.', 'RNG owes you nothing, but ask nicely.', 'It is 50/50: you get it or you do not.', 'Spoon incoming. Probably. Maybe.'],
    quests: ['Spacebar is not a personality.', 'One small favour, they said.', 'Swordfish.', 'The lore was inside you all along.']
  };
  var OUTCOMES = {
    completed: ['Gz! Logged as completed.', 'Nice one. Another for the collection log of life.'],
    failed: ['Sit. Logged as failed.', 'Unlucky. Logged as failed. It happens to the best of us.'],
    skipped: ['Skipped. No judgement. (Some judgement.)']
  };

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sample(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // localStorage may be missing, full, or blocked: every access is guarded.
  function loadStore() {
    try {
      var raw = root.localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }
  function saveStore() {
    try { root.localStorage.setItem(STORE_KEY, JSON.stringify(store)); return true; } catch (e) { return false; }
  }
  function blankCounts() { return { completed: 0, failed: 0, skipped: 0 }; }
  function normaliseStore(s) {
    var stats = s.stats && typeof s.stats === 'object' ? s.stats : {};
    var clean = { tiers: {}, categories: {} };
    var fix = function (src, ids, dest) {
      ids.forEach(function (id) {
        var c = blankCounts(), from = src && src[id] ? src[id] : {};
        Object.keys(c).forEach(function (k) { var v = Number(from[k]); c[k] = isFinite(v) && v > 0 ? Math.floor(v) : 0; });
        dest[id] = c;
      });
    };
    fix(stats.tiers, TIERS.map(function (t) { return t.id; }), clean.tiers);
    fix(stats.categories, CATEGORIES.map(function (c) { return c.id; }), clean.categories);
    var settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
    return {
      stats: clean,
      settings: {
        tier: TIER_ORDER.hasOwnProperty(settings.tier) ? settings.tier : 'standard',
        categories: Array.isArray(settings.categories) ? settings.categories.filter(function (c) { return CATEGORIES.some(function (x) { return x.id === c; }); }) : CATEGORIES.map(function (c) { return c.id; })
      },
      current: typeof s.current === 'string' ? s.current : null
    };
  }

  var store = normaliseStore(loadStore());
  var pool = [];
  var current = null;      // challenge on screen
  var resolved = false;    // has it been marked completed/failed?
  var recent = [];         // ids shown recently, newest last
  var timer = { running: false, startedAt: 0, elapsed: 0, handle: null };

  function selectedTier() {
    var r = document.querySelector('input[name="tier"]:checked');
    return r ? r.value : 'standard';
  }
  function selectedCategories() {
    return Array.prototype.map.call(document.querySelectorAll('input[name="category"]:checked'), function (c) { return c.value; });
  }

  function renderControls() {
    var tierBox = $('tier-options');
    TIERS.forEach(function (t) {
      var label = el('label', 'choice tier-' + t.id);
      var input = el('input');
      input.type = 'radio'; input.name = 'tier'; input.value = t.id;
      input.checked = store.settings.tier === t.id;
      label.appendChild(input);
      var span = el('span', 'choice-body');
      span.appendChild(el('span', 'choice-title', t.label));
      span.appendChild(el('span', 'choice-hint', t.blurb + ' About ' + t.range + '.'));
      label.appendChild(span);
      tierBox.appendChild(label);
    });
    var catBox = $('category-options');
    CATEGORIES.forEach(function (c) {
      var label = el('label', 'choice');
      var input = el('input');
      input.type = 'checkbox'; input.name = 'category'; input.value = c.id;
      input.checked = store.settings.categories.indexOf(c.id) !== -1;
      label.appendChild(input);
      var span = el('span', 'choice-body');
      span.appendChild(el('span', 'choice-title', c.label));
      span.appendChild(el('span', 'choice-hint', c.hint));
      label.appendChild(span);
      catBox.appendChild(label);
    });
    $('controls').addEventListener('change', onSettingsChange);
  }

  function onSettingsChange() {
    store.settings.tier = selectedTier();
    store.settings.categories = selectedCategories();
    saveStore();
    updateGenerateState();
  }

  function updateGenerateState() {
    var cats = selectedCategories(), tier = selectedTier();
    var count = pool.filter(function (c) { return c.tier === tier && cats.indexOf(c.category) !== -1; }).length;
    var btn = $('generate');
    btn.disabled = !pool.length || count === 0;
    var note = $('pool-note');
    if (!pool.length) note.textContent = '';
    else if (!cats.length) note.textContent = 'Tick at least one category to roll a challenge.';
    else note.textContent = fmtNum(count) + ' possible challenges with these settings.';
  }

  function setTimerRunning(run) {
    if (run === timer.running) return;
    if (run) {
      timer.startedAt = Date.now() - timer.elapsed;
      timer.handle = setInterval(renderTimer, 1000);
    } else {
      timer.elapsed = Date.now() - timer.startedAt;
      clearInterval(timer.handle);
    }
    timer.running = run;
    renderTimer();
  }
  function resetTimer() {
    if (timer.running) clearInterval(timer.handle);
    timer.running = false; timer.elapsed = 0;
    renderTimer();
  }
  function renderTimer() {
    var ms = timer.running ? Date.now() - timer.startedAt : timer.elapsed;
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    $('timer-readout').textContent = h + ':' + pad(m) + ':' + pad(sec);
    $('timer-toggle').textContent = timer.running ? 'Pause' : (ms > 0 ? 'Resume' : 'Start timer');
    $('timer-toggle').setAttribute('aria-pressed', timer.running ? 'true' : 'false');
    var over = current && ms > current.targetMinutes * 60000;
    $('timer-note').textContent = over ? 'Past the target. That is fine: it is a target, not a rule.' : 'Optional. It never ends the challenge for you.';
  }

  function renderChallenge(c, announce) {
    current = c; resolved = false;
    $('empty-state').hidden = true;
    $('challenge').hidden = false;
    var tier = TIERS[TIER_ORDER[c.tier]];
    var cat = CATEGORIES.filter(function (x) { return x.id === c.category; })[0];
    var badges = $('challenge-badges');
    badges.textContent = '';
    badges.appendChild(el('li', 'badge badge-tier tier-' + tier.id, tier.label));
    badges.appendChild(el('li', 'badge', cat.label));
    c.tags.forEach(function (t) { badges.appendChild(el('li', 'badge badge-soft', t)); });
    $('challenge-title').textContent = c.title;
    $('challenge-description').textContent = c.description;
    var rules = $('challenge-rules');
    rules.textContent = '';
    c.rules.forEach(function (r) { rules.appendChild(el('li', null, r)); });
    $('challenge-time').textContent = 'About ' + fmtMinutes(c.targetMinutes);
    $('challenge-success').textContent = c.success;
    $('challenge-failure').textContent = c.failure;
    $('stake-row').hidden = !c.stake;
    $('challenge-stake').textContent = c.stake || '';
    $('challenge-quip').textContent = sample(QUIPS[c.category]);
    $('outcome').textContent = '';
    setActionsEnabled(true);
    $('generate').textContent = 'Roll a different one';
    resetTimer();
    store.current = c.id;
    saveStore();
    if (announce) {
      var title = $('challenge-title');
      title.focus();
    }
  }

  function setActionsEnabled(on) {
    ['mark-completed', 'mark-failed', 'mark-skipped'].forEach(function (id) { $(id).disabled = !on; });
  }

  function roll() {
    var c = pickChallenge(pool, selectedTier(), selectedCategories(), recent);
    if (!c) return;
    recent.push(c.id);
    if (recent.length > 12) recent.shift();
    renderChallenge(c, true);
  }

  function record(result) {
    if (!current || resolved) return;
    store.stats.tiers[current.tier][result]++;
    store.stats.categories[current.category][result]++;
    store.current = null;
    var saved = saveStore();
    renderStats();
    var message = sample(OUTCOMES[result]) + (saved ? '' : ' (Your browser is not letting us save stats, so this only lasts until you close the tab.)');
    if (result === 'skipped') {
      roll();
      $('outcome').textContent = message + ' Here is a fresh one.';
      return;
    }
    resolved = true;
    setTimerRunning(false);
    setActionsEnabled(false);
    $('outcome').textContent = message;
    $('generate').textContent = 'Roll again';
    $('generate').focus();
  }

  function renderStats() {
    var fill = function (bodyId, defs, src) {
      var body = $(bodyId);
      body.textContent = '';
      defs.forEach(function (d) {
        var tr = el('tr');
        var th = el('th', null, d.label); th.scope = 'row';
        tr.appendChild(th);
        ['completed', 'failed', 'skipped'].forEach(function (k) { tr.appendChild(el('td', null, fmtNum(src[d.id][k]))); });
        body.appendChild(tr);
      });
    };
    fill('stats-tiers', TIERS, store.stats.tiers);
    fill('stats-categories', CATEGORIES, store.stats.categories);
    var total = blankCounts();
    TIERS.forEach(function (t) { Object.keys(total).forEach(function (k) { total[k] += store.stats.tiers[t.id][k]; }); });
    $('stats-summary').textContent = total.completed + ' completed, ' + total.failed + ' failed, ' + total.skipped + ' skipped';
  }

  function resetStats() {
    if (!root.confirm('Reset all completion stats? This cannot be undone.')) return;
    store.stats = normaliseStore({}).stats;
    saveStore();
    renderStats();
  }

  function loadData() {
    return Promise.all(DATA_FILES.map(function (name) {
      return fetch('data/' + name + '.json').then(function (res) {
        if (!res.ok) throw new Error('data/' + name + '.json: HTTP ' + res.status);
        return res.json();
      }).then(function (json) { return [name, json]; });
    })).then(function (pairs) {
      var data = {};
      pairs.forEach(function (p) { data[p[0]] = p[1]; });
      return data;
    });
  }

  function init() {
    renderControls();
    renderStats();
    renderTimer();
    $('generate').addEventListener('click', roll);
    $('mark-completed').addEventListener('click', function () { record('completed'); });
    $('mark-failed').addEventListener('click', function () { record('failed'); });
    $('mark-skipped').addEventListener('click', function () { record('skipped'); });
    $('timer-toggle').addEventListener('click', function () { setTimerRunning(!timer.running); });
    $('timer-reset').addEventListener('click', resetTimer);
    $('reset-stats').addEventListener('click', resetStats);

    loadData().then(function (data) {
      pool = buildPool(data);
      $('data-date').textContent = data.meta && data.meta.fetched_date ? data.meta.fetched_date : 'unknown date';
      $('pool-size').textContent = fmtNum(pool.length);
      $('load-status').hidden = true;
      updateGenerateState();
      if (store.current) {
        var saved = pool.filter(function (c) { return c.id === store.current; })[0];
        if (saved) { recent.push(saved.id); renderChallenge(saved, false); }
      }
    }).catch(function (err) {
      var status = $('load-status');
      status.hidden = false;
      status.className = 'notice notice-error';
      status.textContent = 'Could not load the challenge data (' + err.message + '). If you opened index.html straight from disk, serve the folder over HTTP instead: see the README.';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
