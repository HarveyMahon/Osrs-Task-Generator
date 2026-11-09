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
| `data/quests.json` | Quests with rough durations, Nightmare Zone quest bosses, speedrun quests, diary areas. Hand-curated. |
| `data/items.json` | Every item the other files mention. `id` and `value` are filled in by the refresh script. |
| `data/meta.json` | When and how the item values were last fetched. |
| `scripts/update_data.py` | Refreshes `items.json` and `meta.json` from the OSRS Wiki. |
| `scripts/fixtures/` | Small recorded API responses for testing the refresh script without the network. |
| `scripts/check_generator.js` | Sanity checks for the generator (Node, no dependencies). |
| `.github/workflows/update-data.yml` | Weekly run of the refresh script. |

## How challenges are generated

`app.js` builds the full pool once, when the page loads, by filling templates with the data files:

- **Combat**: "N kills" of a boss, raid or slayer monster, with a tier-dependent rule set (trip limits, no deaths, no special attacks, gear value caps, Wilderness risk), and "N slayer tasks from a master".
- **Skilling** and **Minigames**: "do N of something", from a relaxed version at Casual to a hard time limit at Hardcore and Extreme. Some minigames add a twist (win every game, no food, and so on).
- **Pets and rare drops**: "get drop X within N attempts". N is what fits in the tier's time, and a drop is only offered in a tier if the chance of success lands in that tier's band (Casual 25% or better, Standard 15 to 55%, Hardcore 5 to 20%, Extreme 0.8 to 7%).
- **Quests and diaries**: quests with or without a guide, speedrun-world trophies, Nightmare Zone quest boss rematches, and "victory laps" of achievement diary task lists.

Counts are always rounded down to a friendly number and the time target is derived from the count, so a challenge can never exceed its tier's window or three hours. Tier windows are 15 to 45 minutes, 45 to 90 minutes, 1.5 to 2.25 hours and 2.25 to 3 hours.

Rolling picks a category first, then a "kind" inside it (for example one boss), then a challenge, so large groups do not drown small ones. The last 12 challenges shown are avoided, and the same challenge is never shown twice in a row.

The pool currently holds about 3,200 distinct challenges. Run the checks with:

```bash
node scripts/check_generator.js
```

It verifies that no tier and category combination is empty, that every challenge has a title, success and failure text, that every time target sits inside its tier window, that Casual challenges carry no death risk, that every luck challenge has an attempt cap, and it rolls 48,000 challenges the way the UI does.

Stats (completed, failed and skipped, per tier and per category) and your settings are kept in `localStorage`. Every read and write is wrapped in `try/catch`; if storage is blocked the site still works and simply tells you the stats will not persist.

## Refreshing the data

```bash
python3 scripts/update_data.py
```

The script uses only the Python standard library. It:

1. Prints a "started" line before doing anything else.
2. Reads `data/items.json`. If every tradeable item already has an id it skips `/mapping` entirely.
3. Makes **one** request to `/latest`, which returns prices for all items at once, and never uses the per-item `id` parameter.
4. Sets each item's `value` to the mean of the latest instant-buy and instant-sell price, rounded to 3 significant figures.
5. Writes `data/items.json` and `data/meta.json` (with the fetch date) atomically.

Other behaviour:

- Responses are cached in `.cache/wiki/` (git-ignored) together with their `ETag`. When a cached copy exists the request is sent with `If-None-Match`, and a `304` reuses the cache.
- If more than one request is needed it sleeps 3 seconds between them. A failed request is retried once after 15 seconds, and never for a 4xx error.
- On any failure (no network, bad JSON, an unexpected shape, fewer than half the items priced) it prints the reason, leaves `data/` untouched and exits with status 1.
- Items missing from the price feed keep their previous value and are listed in `meta.json`.

Useful flags: `--offline` (cache only, no requests), `--fixtures scripts/fixtures` (use the recorded sample responses), `--remap` (look every id up again; needed after you add an item by hand with `"id": null`).

To add an item, add a line to `data/items.json` with its exact wiki name, `"id": null`, `"tradeable": true`, `"value": null`, and run the script.

The kill speeds, drop rates, skilling rates and quest times are **not** fetched. They are hand-maintained in the other JSON files.

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
- **No guidance is given on sleeping between requests or on a preferred time of day.** The 3 second pause and the off-peak cron slot are my own conservative choices.
- The pages do not state a licence for the price data itself. Wiki content is CC BY-NC-SA 3.0; the site credits the wiki in its footer.

## Assumptions and things to double-check

All gameplay numbers were written from memory for a near-maxed account and are deliberately on the slow side so that targets are reachable. They were **not** checked against the wiki page by page (that would have meant a few hundred requests). Treat them as approximate.

- **Kills per hour, skilling rates, minigame lengths and quest times** are rough estimates.
- **Drop rates** are the commonly quoted ones. Lower-confidence entries: Dragon warhammer (1/3,000), Glacial temotli (1/100), the Wilderness boss uniques after the 2023 rework, Araxxor uniques (1/600 each), Tormented Demon drops (1/500), and the "any piece" Barrows figure (about 1/15 per chest with all brothers killed).
- **Tradeability**: an item is marked `tradeable: false` when the price feed had no entry for it on 2026-11-09. That is right for pets and for parts such as Noxious halberd pieces, but an item that is tradeable and simply missing from the feed would be mislabelled (Ancient icon is the one to check).
- **Sailing** has only two activities, with guessed rates.
- **Quest speedruns** assume six quests are available on speedrunning worlds and that trophies are bronze, silver, gold and platinum.
- **Nightmare Zone boss rushes** assume a customisable hard rumble can be limited to the listed bosses.
- **Diary laps** use one flat time per difficulty for every area.
- **Slayer-only bosses** (Cerberus, Kraken, Hydra and so on) appear only in Casual and Standard and are tagged "Needs a Slayer task", since the generator cannot know your current task.
- **Quests cannot be repeated**, so quest challenges are tagged "Only if not yet completed: skip freely". Skips are counted separately from failures.
- There are no Farming challenges (growth timers do not fit a single session) and no Grand Exchange or trading challenges.
- "No death risk" at Casual means: no Wilderness content, and dying never fails the challenge.
