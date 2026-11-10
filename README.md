# OSRS Task Generator

A small static site that rolls a random Old School RuneScape challenge for your next session. Pick an intensity (Casual, Standard, Hardcore, Extreme), pick the categories you fancy, and get a challenge with rules, a soft time target, and concrete success and failure conditions. Mark it completed, failed or skipped, then roll again.

It is aimed at experienced, near-maxed players. Nothing is tailored to an account, and there is no backend: everything runs in the browser from the JSON files in `data/`.

Unofficial fan project, not affiliated with Jagex.

## Run it locally

The page loads its data with `fetch`, so it must be served over HTTP (opening `index.html` from disk will show a "could not load" message).

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. There is no build step and there are no dependencies.

To host it, enable GitHub Pages for the repository (deploy from the default branch, root folder).

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The whole site. `app.js` holds both the generator and the UI. |
| `data/monsters.json` | Bosses, raids, slayer monsters, their rough kills per hour and drop rates, plus slayer masters. Hand-curated. |
| `data/skills.json` | Skilling activities with rough units per hour. Hand-curated. |
| `data/minigames.json` | Minigames and activities with rough completions per hour. Hand-curated. |
| `data/quests.json` | Quests available on Quest Speedrunning worlds with their trophy times, Nightmare Zone quest bosses, diary areas. Hand-curated. |
| `data/items.json` | Every item the other files mention. `id` and `value` are filled in by the refresh script. |
| `data/icons/` | Item inventory icons, downloaded once by the refresh script. |
| `data/meta.json` | When and how the item values were last fetched. |
| `scripts/update_data.py` | Refreshes `items.json` and `meta.json` from the OSRS Wiki. |
| `scripts/fixtures/` | Small recorded API responses for testing the refresh script without the network. |
| `scripts/check_generator.js` | Sanity checks for the generator (Node, no dependencies). |
| `.github/workflows/update-data.yml` | Weekly run of the refresh script. |
| `.github/workflows/check.yml` | Runs the generator checks and an offline test of the refresh script on every push and pull request. |
| `notes/ideas.md` | Ideas that were considered and parked. Not part of the site. |

## How challenges are generated

`app.js` builds the full pool once, when the page loads, by filling templates with the data files:

- **Combat**:
  - "N kills" of a boss, raid or slayer monster, with a tier-dependent rule set (trip limits, no deaths, no special attacks, gear value caps, Wilderness risk, or a single attack style where the boss supports more than one). Slayer monsters that are not worth killing are Casual-only.
  - "Beat your best": set a new in-game personal best within N kills.
  - "Loot race": collect a gp value of drops, read off a loot tracker, inside a time limit.
  - Single-weapon runs with an off-meta weapon, and "one-trip wonder" endurance runs (N kills from one inventory, as many attempts as the clock allows).
  - Hand-written multi-boss "boss tours" and Wilderness errands.
  - "N slayer tasks from a master" (the low-level masters are Casual-only).
- **Skilling** and **Minigames**: "do N of something", from a relaxed version at Casual to a hard time limit at Hardcore and Extreme. Production skills (Cooking, Firemaking, Fletching, Herblore, Crafting, Smithing, Magic, Construction) are "gain N XP by any method" instead, so the player picks the method. Farming uses fixed patch runs, since growth timers rule out bulk counts. There are no Prayer challenges. Some minigames add a twist (win every game, no food, and so on).
- **Pets and rare drops**:
  - "Get drop X within N attempts". N is what fits in the tier's time, and a drop is only offered in a tier if the chance of success lands in that tier's band (Casual 25% or better, Standard 15 to 55%, Hardcore 5 to 20%, Extreme 0.8 to 7%).
  - Where the chance is under 5% (pets, mostly), the challenge becomes a "grind starter": put in the N attempts inside a time limit, with the drop as a bonus.
  - "New log slot": fill any new collection log slot from a boss within N attempts.
- **Quests and diaries**: trophy times on Quest Speedrunning worlds, Nightmare Zone quest boss rematches, and "victory laps" of the Easy and Medium achievement diary lists (Casual and Standard only). Ordinary quests are not used, because a quest can only be replayed on a speedrunning world.

Personal-best and log-slot challenges depend on the player's own account, so a player who already holds a hard-to-beat record or a full log will skip them.

Counts are always rounded down to a friendly number and the time target is derived from the count, so a challenge can never exceed its tier's window or three hours. Tier windows are 15 to 45 minutes, 45 to 90 minutes, 1.5 to 2.25 hours and 2.25 to 3 hours.

Beyond tier and category, the player can:

- **Leave things out**: Wilderness, content that needs other players, Slayer-task-only monsters, raids, wave challenges (Inferno, Colosseum, Fight Cave) and speedrunning worlds.
- **Set a time limit** with a slider; only challenges whose target fits are offered.
- **Lock and reroll**: keep the target and change the rules, or keep the rules and change the target.
- **Roll the daily challenge**: one per tier per UTC day, the same for everyone. It is picked with a random number generator seeded from the date and tier, from a pool that excludes anything needing a Slayer task. It ignores the player's category and opt-out settings so that everyone gets the same one. Because the pick depends on the pool, changing the data files changes that day's daily.
- **Copy the challenge as text** for pasting into chat.
- **Use the stopwatch**, which is optional and survives a page reload.
- **Copy a link** to the exact challenge. The link ends in `#c-<code>`, where the code is a short hash of the challenge's ID; a daily link ends in `#daily-<date>-<tier>` (only real dates from 2026 up to today are accepted). Opening a link shows that challenge whatever the visitor's settings are, and results go into the visitor's own stats. Nothing is sent anywhere. A link stops working if the challenge it points to is later changed or removed (for example a kill-speed edit that changes the count); the page then says so and offers a fresh roll.

Rolling plays a short dice animation (skipped when the device asks for reduced motion), and challenges show an item icon where one makes sense: the drop being hunted, a boss's signature drop, or the item a skilling activity produces or uses. Everything else shows a category symbol.

Rolling picks a category first, then a "kind" inside it (for example one boss), then a challenge, so large groups do not drown small ones. The last 12 challenges shown are avoided, and the same challenge is never shown twice in a row.

The pool currently holds about 3,900 distinct challenges. Run the checks with:

```bash
node scripts/check_generator.js
```

It verifies that no tier and category combination is empty, that every challenge has a title, success and failure text, that every time target sits inside its tier window, that Casual challenges carry no death risk, that every luck challenge has an attempt cap, that the opt-outs and time limit are respected and never empty a tier, that lock-and-reroll keeps what it promises, that the daily challenge is stable and never needs a Slayer task, that share codes are unique and every referenced icon file exists, that Casual never counts a death or offers endgame content, that clue counts respect the stack cap, and it rolls 48,000 challenges the way the UI does.

Stats (completed, failed and skipped, with a success rate, per tier and per category), the current and best completion streak, the last 50 results, today's daily results and your settings are kept in `localStorage`. Every read and write is wrapped in `try/catch`; if storage is blocked the site still works and simply tells you the stats will not persist.

## Refreshing the data

```bash
python3 scripts/update_data.py
```

The script uses only the Python standard library. It:

1. Prints a "started" line before doing anything else.
2. Reads `data/items.json`. If every tradeable item already has an id and every item's icon has been checked, it skips `/mapping` entirely.
3. Makes **one** request to `/latest`, which returns prices for all items at once, and never uses the per-item `id` parameter.
4. Sets each item's `value` to the mean of the latest instant-buy and instant-sell price, rounded to 3 significant figures.
5. Downloads the inventory icon for any item it has not checked before into `data/icons/` (see below).
6. Writes `data/items.json` and `data/meta.json` (with the fetch date) atomically.

Other behaviour:

- Responses are cached in `.cache/wiki/` (git-ignored) together with their `ETag`. When a cached copy exists the request is sent with `If-None-Match`, and a `304` reuses the cache.
- If more than one request is needed it sleeps 3 seconds between them. A failed request is retried once after 15 seconds, and never for a 4xx error.
- On any failure (no network, bad JSON, an unexpected shape, fewer than half the items priced) it prints the reason, leaves `data/` untouched and exits with status 1.
- Items missing from the price feed keep their previous value and are listed in `meta.json`.

Icons are fetched once per item, ever. For items not yet checked, the script asks the wiki which image files exist in batches of 50 names per request, then downloads each existing icon with a 1 second pause. An item then carries `"icon": "<file>"`, or `"icon": false` if the wiki has no image under the expected name, and is never asked about again. The first run for the current 210 items took about 195 requests; a normal weekly run makes none for icons. If the wiki files an item's image under a different name (pets, mostly), give the item an `"icon_file"` with the wiki file name, for example `"Pet Snakeling.png"`. To retry an item, delete its `icon` field. To supply an icon by hand, put a PNG in `data/icons/` and set the field to its file name. If the icon step fails part-way, prices are still written and the remaining icons are retried next run.

Useful flags: `--skip-icons` (prices only), `--offline` (cache only, no requests), `--fixtures scripts/fixtures` (use the recorded sample responses), `--remap` (look every id up again; needed after you add an item by hand with `"id": null`).

To add an item, add a line to `data/items.json` with its exact wiki name, `"id": null`, `"tradeable": true`, `"value": null`, and run the script.

The kill speeds, drop rates, skilling rates and speedrun trophy times are **not** fetched. They are hand-maintained in the other JSON files.

### Weekly workflow

`.github/workflows/update-data.yml` runs the script every Monday at 05:17 UTC and commits `data/` if it changed. Its only permission is `contents: write`, which it needs to push that commit. Notes:

- GitHub only runs scheduled workflows from the default branch, and pauses them after 60 days without repository activity.
- The runner starts with an empty cache, so the weekly request is unconditional. That is still a single request per week.
- If the script fails, the job fails and nothing is committed.

## Wiki usage notes

The usage rules were read on 2026-11-09 from [RuneScape:Real-time Prices](https://oldschool.runescape.wiki/w/RuneScape:Real-time_Prices) on the OSRS Wiki and [Help:APIs](https://runescape.wiki/w/Help:APIs) on the RuneScape Wiki. What they say, and how this project follows it:

- **Set a descriptive User-Agent.** This is described as "the only thing we ask", and default agents such as `python-requests`, `Python-urllib` and `curl` are blocked. The script sends `osrs-task-generator-data-refresh/1.0 (+https://github.com/harveymahon/osrs-task-generator; weekly item-price refresh for a static fan site)`. If you fork this, change the URL to your own.
- **Do not loop over items with the `id` parameter.** The script fetches all prices in one `/latest` request.
- **No explicit rate limit**, but access can be limited for usage heavy enough to threaten stability (the page gives "multiple large queries per second for a sustained period" as an example). This project makes one or two requests a week.
- **The v2 API** (`prices.runescape.wiki/api/v2/osrs`) is the documented endpoint; v1 "may be removed in the future". The script uses v2.
- The site itself makes **no** requests to the wiki at runtime.

Things I could not verify from those pages:

- **Conditional requests are not documented.** The API does return `ETag` headers, and a request with `If-None-Match` returned `304 Not Modified` when tested on 2026-11-09, but this is observed behaviour, not a documented guarantee. If it stops working the script simply receives a normal `200`.
- **No guidance was found on downloading images.** Icons are fetched once each, a second apart, and existence is checked in batches first so that missing files cost no download attempt. The icons are Jagex artwork hosted by the wiki; the site credits both in its footer.
- **No guidance is given on sleeping between requests or on a preferred time of day.** The 3 second pause and the off-peak cron slot are my own conservative choices.
- The pages do not state a licence for the price data itself. Wiki content is CC BY-NC-SA 3.0; the site credits the wiki in its footer.

## Assumptions and things to double-check

Kill speeds, skilling rates and time estimates were written from memory for a near-maxed account and are deliberately on the slow side so that targets are reachable. Treat them as approximate.

- **Kills per hour, skilling rates and minigame lengths** are rough estimates.
- **Drop rates** were checked on 2026-11-09 against the drop tables on the wiki's monster pages (three batched page requests, made by hand). Six were wrong and were corrected: the three Wilderness boss rings (1/512), Monkey tail (1/1,500), Crystal tool seed (about 1/205) and the Noxious halberd pieces (1/200 for whichever piece is next). The remaining figures (the Gauntlet and Corrupted Gauntlet seeds and Youngllef, Bran, Blood shard, and the "any item" Barrows figure of about 1/15 per chest) were confirmed against wiki screenshots supplied by the repository owner on the same day. The Bran rate assumes loot is not sacrificed (sacrificing doubles it to 1/1,500). Rates are not re-checked by the refresh script.
- **Tradeability**: an item is marked `tradeable: false` when the price feed had no entry for it on 2026-11-09. That is right for pets and for parts such as Noxious halberd pieces, but an item that is tradeable and simply missing from the feed would be mislabelled (Ancient icon is the one to check).
- **XP targets** use a comfortable XP rate per skill written from memory, well below the best possible rate. A player already at 200m XP in a skill cannot do that skill's challenges.
- **Loot races** use a hand-written estimate of ordinary loot per hour for each boss (`lootPerHour`, rare uniques excluded), and the target is 80% of that. They are not derived from the bundled prices and will drift as prices move.
- **Single-weapon runs** (`weapons`) and **one-trip runs** (`tripKills`) rely on hand-written lists of what is workable at each boss.
- **Personal bests**: bosses marked `noPb` are left out because I believe the game keeps no timer for them; the list was written from memory.
- **"Profitable" slayer monsters** (the ones offered above Casual) are a hand-picked list.
- **Sailing** has five activities, with guessed rates.
- **Newer bosses** (Royal Titans, Yama, Doom of Mokhaiotl, the Hueycoatl, Moons of Peril) have guessed kill speeds.
- **Endgame content** (monsters marked `hard`: Theatre of Blood, Tombs of Amascut, Chambers Challenge Mode, the Colosseum, the Inferno, Phosani's Nightmare, Nex, the Corporeal Beast, the Corrupted Gauntlet, Yama, Doom of Mokhaiotl) is never offered at Casual, and no Casual rule counts a death against the player.
- **Clue scroll challenges** are capped at 5 of a tier, the most a scroll box stack can hold (from memory; the base cap is lower until Combat Achievement rewards raise it).
- **Two rolls per kill**: Zulrah and the Grotesque Guardians roll their main table twice (per the wiki pages checked on 2026-11-09), and hunt odds account for it via `rolls`.
- **Minnows** are counted at about 12,000 an hour, worked out from the 40-per-shark exchange rate; not checked against the wiki.
- **Marathon rule**: Extreme skilling and minigame challenges require staying logged in, with the idle logout as the referee, since a "no long breaks" rule could not be checked.
- **Attack-style challenges** rely on a hand-written list of which styles work at each boss (`styles` in `data/monsters.json`); the first style listed is the usual one and only the others are offered.
- **Quest speedruns** use the 15 quests and the trophy times listed on the wiki's [Quest Speedrunning](https://oldschool.runescape.wiki/w/Quest_Speedrunning) page as read on 2026-11-09 (one extra page request, made by hand). They are not refreshed by the script, so they will go stale if Jagex changes the times or adds quests. The attempt caps assume about 2 minutes of setup per run.
- **Nightmare Zone boss rushes** assume a customisable hard rumble can be limited to the listed bosses.
- **Diary laps** use one flat time per difficulty for every area.
- **Slayer-only bosses** (Cerberus, Kraken, Hydra and so on) appear only in Casual and Standard and are tagged "Needs a Slayer task", since the generator cannot know your current task.
- Farming is limited to patch runs (herb, tree, fruit tree and so on), where a patch that is still growing counts once visited. There are no Grand Exchange or trading challenges.
- **Icons**: the Barrows "any piece" and Dagannoth Rex "any unique" items use images supplied by the repository owner (files ending `-detail.png`, drawn smoothly rather than as pixel sprites). The Noxious halberd piece has no icon because no hunt for it currently fits a tier. Pet icons use hand-entered wiki file names (`icon_file` in `data/items.json`).
- "No death risk" at Casual means: no Wilderness content, and dying never fails the challenge.
