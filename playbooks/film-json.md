---
name: film-json
title: film.json, the plan of a launch film
index: film.json, the plan of a launch film: clips, scene types, the words on screen and their rules
description: Explains film.json, the plan launch-film renders: its top-level fields, the clip kinds and their length in bars, the scene types with the fields launch_film_guide leaves out, the icons, and the rules for the words on screen, with the loader's errors and their fixes. Use it to read a plan before it renders, and to change one where film.json can be written.
kit: launch-film
requires: [launch-film]
any: [make_launch_film, plan_launch_film]
optional: [easyscreenshotkit]
order: 66
---
# film.json, the plan of a launch film

`plan_launch_film` and `make_launch_film` write `film.json` into the film's folder, and `render_launch_film` renders it. It lists the clips in the order they play, each lasting whole bars of the look's music, and holds every word on screen exactly as it will show.
<!-- local -->
To change a film, change `film.json` with your file tools and call `render_launch_film` with it. The render does not draw frames/ again: look at the `sheet.png` of `check_video` instead.
```call
render_launch_film {"film": "launch/film-16x9/film.json", "wait_seconds": 0}
```
<!-- end -->
<!-- hosted -->
A film.json cannot be changed here: it renders as it was planned. Read it in the plan's result to check the words on screen against these rules, and tell the user when one is wrong.
<!-- end -->

## A small film

```json
{
  "brand": "brand/brand.json",
  "look": "launch",
  "aspect": "16:9",
  "clips": [
    { "kind": "scene", "bars": 2, "scene": { "type": "opener", "title": "Acme Notes", "text": "Notes that think with *you*" } },
    { "kind": "screen", "bars": 2, "image": "brand/screen-01.png", "mode": "pan" },
    { "kind": "scene", "bars": 4, "scene": { "type": "features", "items": [
      { "icon": "lightning", "title": "Instant search", "text": "Find any note in a blink" },
      { "icon": "shield-check", "title": "Private by design", "text": "Encrypted end to end" } ] } },
    { "kind": "logo", "bars": 2, "logo": "brand/logo-01.png", "site": "acme.com" }
  ]
}
```

A number the page states is a scene of its own, after the headline or the features:

```json
{ "kind": "scene", "bars": 2, "scene": { "type": "number", "value": "40,000+", "text": "product teams" } }
```

## The top level

- `brand`: the brand kit's `brand.json`, by a path from the folder of `film.json`; a plan writes brand/brand.json.
- `look`: launch, aurora, gridline, pop or journal. It sets the style and the tempo, and so how long a bar lasts: {fact:launch-film.bar_seconds.launch} seconds in launch, {fact:launch-film.bar_seconds.aurora} in aurora, {fact:launch-film.bar_seconds.gridline} in gridline, {fact:launch-film.bar_seconds.pop} in pop and {fact:launch-film.bar_seconds.journal} in journal.
- `aspect`: "16:9" or "9:16".
- `clips`: played in order.
- `music`: true plays the look's own bed, false leaves it out, and an object with a `volume` sets its level, {fact:launch-film.music_volume} unless given. A file named here is ignored without a word, and the bed plays.
- `sfx`: true or false, the sound effects.
- `lang`: the page's two letter language code, which the logo close is drawn in. A scene object can carry its own.
- `version` and `url` are the plan's own.

## A clip

Every clip has a `kind` and a length: `bars` of the look's music, or `seconds`. A clip with neither lasts {fact:launch-film.clip_bars_default} bars. Each clip lasts {fact:launch-film.clip_seconds_min} to {fact:launch-film.clip_seconds_max} seconds, and the film at most {fact:launch-film.film_seconds_max}. Whole bars keep the cuts on the beat of the film's music, and a clip in seconds moves every cut after it off the beat.
<!-- local -->
To reach a length exactly, give `seconds` to the last clip only.
<!-- end -->

| kind | What it shows | Fields |
| --- | --- | --- |
| scene | words in motion | `scene`, a scene object |
| screen | a screenshot in a browser window | `image`; `mode` pan, or zoom with `box` [x, y, w, h] in the picture's pixels; `side`, where the slow push in is anchored: center, left, right, top or bottom |
| shots | one to three store screenshots side by side, as they are | `images` |
| phone | a phone's own screen capture in a drawn phone, not a store screenshot, which often shows a phone already | `image` |
| scroll | a tall page scrolling in a window | `image` |
| logo | the logo close | `logo`, a logo file of the brand kit, or `icon`, an app icon; `site`, the line under it |

Pictures are PNG or JPEG files, named by a path from the folder of `film.json`, like brand/screen-01.png.
<!-- with easyscreenshotkit -->
<!-- local -->
The PNGs of `take_screenshots` work too, by such a path: a desktop one for a screen, a mobile one for a phone, a full one for a scroll.
<!-- end -->
<!-- end -->

## Scenes

A scene object has a `type` and its words. `launch_film_guide` with `topic` types lists every type with its main fields and how many `items` it takes:
```call
launch_film_guide {"topic": "types"}
```
These fields are optional, and the list leaves them out:

- `text`: on an opener, a second line in the accent color; on a number, the line under it; also on spotlight, donut, gauge and rating.
- `kicker`, a small label above the words: opener (not in pop), headline, bigword, wordstack, typewriter, number, and features when it has a `title`.
- `icon`: on an opener, drawn in aurora and pop.
- `title`: on strike, the answer after the struck phrases; elsewhere a heading over the scene, on spotlight, donut, gauge, rating, progress, proscons, code and every type with items but wordstack, term and search.
- `source` on a quote, who said it; `stamp` on a term, the card's label; `active` on steps, the chip to fill, counted from 1.

Each field has a length limit, which the render checks before it starts: an opener's `title` {fact:launch-film.scene_max.opener_title} characters, a point's {fact:launch-film.scene_max.point_title}, a headline's {fact:launch-film.scene_max.headline_title}, a bigword's {fact:launch-film.scene_max.bigword_title} and any other `title` {fact:launch-film.scene_max.title}; a number's `value` {fact:launch-film.scene_max.number_value}; a feature's `title` {fact:launch-film.scene_max.feature_title} and its `text` {fact:launch-film.scene_max.feature_text}; a typewriter's `text` {fact:launch-film.scene_max.typewriter_text}, a quote's {fact:launch-film.scene_max.quote_text} and any other `text` {fact:launch-film.scene_max.text}; a `kicker` {fact:launch-film.scene_max.kicker}. Asterisks do not count.

Words between asterisks take the accent color, as in `Notes that think with *you*`. Icons are Phosphor names, and no tool searches them. These work: lightning, shield-check, users-three, magnifying-glass, sparkle, chart-line-up, plugs-connected, device-mobile, cloud-arrow-up, calendar-check, chat-circle-dots, globe-hemisphere-west, code, paint-brush, credit-card, check-circle, rocket-launch, lightbulb, target, heart, bell-ringing, note-pencil, plant.

## The words on screen

- Every word comes from the page, as in `words.json` and `brand/BRAND.md`, or from the user, never an invented number, customer, quote or claim: the film states it as the brand's own.
- A scene has time to be read: about {fact:launch-film.read_letters_per_second} letters a second, plus {fact:launch-film.read_extra_seconds} seconds.
- One or two words a scene are marked, not more.
- No em or en dash is on screen, only commas and periods. The render does not check this.
- The film opens with an opener, closes with the logo, has a scene between any two screens, and lasts {fact:launch-film.length_min} to {fact:launch-film.length_max} seconds.
- The brand's name shows in the opener's `title`; the logo's `site` is the line under the logo, mostly the site's address. A plan takes the name from the site's name, its title or its host: check it first.
<!-- local -->
- Shorten the page's sentences freely, keeping what they say.
<!-- end -->

<!-- local -->
## When the render refuses it

`render_launch_film` and `make_launch_stills` read the whole file first and list every problem after `film.json has problems:`, before anything renders. A clip in this list counts from 0, so `clips[0]` is the first, while a render error's `clip <n>` counts from 1.

- `"look" must be one of launch, aurora, gridline, pop, journal` and `"aspect" must be "16:9" or "9:16"`: use one of those values.
- `the brand could not be read from <path>: <why>`: give `brand` as a path from the folder of `film.json`.
- `"clips" is empty`, or `clips[<i>].kind must be one of scene, screen, phone, scroll, shots, logo`.
- `clips[<i>] must last 2-12 seconds (it is <n>)`: change its `bars` or `seconds`.
- `clips[<i>].image "<path>" is not a file`, also for `images[<k>]`, `logo` and `icon`: the path is read from the folder of `film.json`.
- `clips[<i>].images must list 1-3 pictures` and `clips[<i>].box must be [x, y, w, h] in the picture's pixels for a zoom`.
- `clips[<i>].scene: "<field>" is missing`, `is longer than <n> characters`, or `a <type> scene takes <n> "items"`: as `launch_film_guide` types and the limits above say.
- `clips[<i>].scene: items[<k>].icon "<name>" is not an icon (near: <names>); search with: launch-film icons <word>`: take a name from the near list, since that search has no tool here.
- `the film would last <n> s; keep it under 90`: drop a clip or shorten some.
- `<file> is not valid JSON: <why>`: a comma or a quote is wrong at the place it names.
<!-- end -->
<!-- hosted -->
## When the render refuses it

A plan the kit made loads as it is. When a render still lists problems after `film.json has problems:`, tell the user what each line says: a plan cannot be changed here.
<!-- end -->
