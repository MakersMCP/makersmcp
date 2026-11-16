---
name: launch-kit
title: Everything a launch needs
index: the files a launch needs, made in order across the kits, with the place map and what to hand over
description: Runs the whole set of launch files for a product's site with the MakersMCP kits on the server, in the order that works and with what can run side by side, from the brand kit and screenshots to launch films and launch pictures, with fitted music and checks where the server lists those tools. Says which place takes which file at which size and what to hand over. Use it when the user asks for a launch kit, for launch assets, or for what can be made for a launch on a named place.
kit: makersmcp
requires: [launch-film]
any: [make_launch_film, plan_launch_film]
optional: [easybrandkit, easyfontkit, easyscreenshotkit, musicfit, reframekit, easycaptionkit, check_video, fit_music]
order: 20
---
# Everything a launch needs

A launch kit is the set of files a launch takes, all made from the product's own site with the kits on this server. Each piece has a topic of its own. This one gives the order, what runs side by side, which file goes into which call, and what to hand over.

## Decide first

- The site: the product's own address with https://, like https://linear.app. An App Store or Google Play listing works as the film's address too; a social profile is refused.
- The places it is for. The place map below says what each one takes. When the user names none, make the film and the pictures for every place, and say which places those are.
- The shape of the film: 16:9, 9:16 for phones, or both, which is two plans.
- The music: the film's own, or a track of the user's fitted under the rendered film.
<!-- with easybrandkit -->
- The claims: when copy for the launch needs the site's numbers, customers, quotes or prices, run `make_brand_kit` with `facts`. The film reads the page itself and does not use them.
<!-- end -->
- No tool here makes a 9:16 picture or an App Store preview video, and none uploads or posts anything. Say so when a place needs one.

When the user leaves these open, choose, go on, and list the choices in the hand over.

## The place map

The launch pictures come from `make_launch_stills`, one `for` value per place:

| Place | for | File | Size |
| --- | --- | --- | --- |
| Product Hunt gallery | ph | ph-1.png, then ph-2.png to ph-6.png from the film's clips, up to {fact:launch-film.ph_frames_max} | {fact:launch-film.still_size.ph} |
| Product Hunt thumbnail | ph | ph-thumbnail.png | {fact:launch-film.still_size.ph_thumbnail} |
| A shared link's preview | og | og.png | {fact:launch-film.still_size.og} |
| A post on X | x | x.png | {fact:launch-film.still_size.x} |
| Google Play feature graphic | play | play-feature.png | {fact:launch-film.still_size.play} |
| Chrome Web Store tiles | chrome | chrome-small.png and chrome-marquee.png | {fact:launch-film.still_size.chrome_small} and {fact:launch-film.still_size.chrome_marquee} |

<!-- with easyscreenshotkit -->
Store and gallery screenshots come from `take_screenshots`, one `sizes` entry per place:

| Place | Setting | File | Size |
| --- | --- | --- | --- |
| App Store, 6.9 inch iPhone | sizes iphone | <nn>-<page>-iphone.png | {fact:easyscreenshotkit.size.iphone} |
| Google Play phone | sizes mobile | <nn>-<page>-mobile.png | {fact:easyscreenshotkit.size.mobile} |
| Product Hunt gallery, the real screens | sizes 1270x760@2 | <nn>-<page>-1270x760.png | 2540x1520 |
| A web app's install dialog | pwa true | pwa/screenshots/wide-<nn>.png and narrow-<nn>.png | {fact:easyscreenshotkit.pwa.wide} and {fact:easyscreenshotkit.pwa.narrow} |
<!-- end -->

## The order

<!-- hosted -->
A step takes an earlier job's files as job:<job_id>/<path> only until the time that job's result gives, {limit:keep_time} after it ended, when its links stop too: start each step as soon as the one it needs ends, and when the user takes longer to decide, as on the brand or the plan, make that earlier step again first.
<!-- end -->

<!-- with easybrandkit, easyscreenshotkit, easyfontkit -->
1. Start the jobs that need only the site side by side, each with `wait_seconds` 0 and a folder of its own, then call `wait_for_job` on each until it ends:
<!-- end -->
<!-- with easybrandkit -->
   - `make_brand_kit`, with `facts` when the copy needs the site's claims.
<!-- end -->
<!-- with easyscreenshotkit -->
   - `take_screenshots` with the `sizes` the places need, and `pwa` true for an install dialog.
   - `record_demo_video` when the user wants a demo.
<!-- end -->
<!-- with easyfontkit -->
   - `make_font_kit` when the user needs the fonts.
<!-- end -->
<!-- with easybrandkit, easyscreenshotkit, easyfontkit -->
<!-- hosted -->
   Here at most {limit:jobs_at_once} run or wait at once, and a start past that is refused: start them in this order, and the next one when one ends.
<!-- end -->
<!-- end -->
<!-- with easybrandkit -->
<!-- local -->
```call
make_brand_kit {"url": "https://linear.app", "out_dir": "launch/brand", "wait_seconds": 0}
```
<!-- end -->
<!-- hosted -->
```call
make_brand_kit {"url": "https://linear.app", "wait_seconds": 0}
```
<!-- end -->
<!-- end -->
<!-- with easyscreenshotkit -->
<!-- local -->
```call
take_screenshots {"url": "https://linear.app", "sizes": ["iphone", "mobile", "1270x760@2"], "out_dir": "launch/screenshots", "wait_seconds": 0}
record_demo_video {"url": "https://linear.app", "out_dir": "launch/demo", "wait_seconds": 0}
```
<!-- end -->
<!-- hosted -->
```call
take_screenshots {"url": "https://linear.app", "sizes": ["iphone", "mobile", "1270x760@2"], "wait_seconds": 0}
record_demo_video {"url": "https://linear.app", "wait_seconds": 0}
```
<!-- end -->
<!-- end -->
<!-- with easybrandkit -->
2. Show the user `card.png` and check the brand's name, logo and colors in `BRAND.md` before building on them. The kit takes the name from the page, or from the host when the page gives no short one, and the film shows that name.
<!-- local -->
   When the brand is wrong, as with a cookie wall, a login page or no logo, tell the user what came back and ask for the product's own site when the address is not it, as the brand topic says, or for the logo and colors, before going on.
<!-- end -->
<!-- hosted -->
   When the brand is wrong, as with a cookie wall, a login page or no logo, tell the user what came back: no tool here takes a logo or colors the user gives in place of the site's own, so ask for the product's own site when the address is not it, as the brand topic says, or whether to go on with it. For an app, a plan whose `url` is its App Store or Google Play listing, with no `brand`, closes on the app's icon.
<!-- end -->
<!-- end -->
<!-- with easyscreenshotkit -->
2. Show `sheet.png`, and check that every page the places need is there.
<!-- end -->
3. Plan the film with `plan_launch_film`, so its words can be read before it renders. Give the `look` (`launch_film_guide` with topic looks says what each suits), `seconds` from {fact:launch-film.length_min} to {fact:launch-film.length_max} and the `aspect`, and `music` false when the user's track goes under the film. The plan never stretches a clip, so the film can end several seconds away from `seconds`, often short, most when the page has little to show; the render's film.timeline.json has its length. For the other shape, plan again with `words` set to the first plan's words.json and the other `aspect`, so both films say the same.
<!-- without easybrandkit -->
   The plan reads the brand itself: check the name, logo and colors in its brand/BRAND.md before the render.
<!-- local -->
```call
plan_launch_film {"url": "https://linear.app", "aspect": "16:9", "out_dir": "launch/film-16x9"}
plan_launch_film {"url": "https://linear.app", "words": "launch/film-16x9/words.json", "aspect": "9:16", "out_dir": "launch/film-9x16"}
```
<!-- end -->
<!-- hosted -->
```call
plan_launch_film {"url": "https://linear.app", "aspect": "16:9"}
plan_launch_film {"url": "https://linear.app", "words": "job:<job_id>/words.json", "aspect": "9:16"}
```
   words.json is the first plan's.
<!-- end -->
<!-- end -->
<!-- with easybrandkit -->
   Give `brand` the brand kit of step 1.
<!-- local -->
```call
plan_launch_film {"url": "https://linear.app", "brand": "launch/brand", "aspect": "16:9", "out_dir": "launch/film-16x9"}
plan_launch_film {"url": "https://linear.app", "brand": "launch/brand", "words": "launch/film-16x9/words.json", "aspect": "9:16", "out_dir": "launch/film-9x16"}
```
<!-- end -->
<!-- hosted -->
```call
plan_launch_film {"url": "https://linear.app", "brand": "job:<job_id>/brand.json", "aspect": "16:9"}
plan_launch_film {"url": "https://linear.app", "brand": "job:<job_id>/brand.json", "words": "job:<job_id>/words.json", "aspect": "9:16"}
```
   brand.json is the brand kit's job's, words.json the first plan's.
<!-- end -->
<!-- end -->
<!-- local -->
   Read the plan's film.json and words.json, and fix any wrong word or name in film.json as the film-json topic says. Without a way to write files, tell the user what is wrong instead.
<!-- end -->
<!-- hosted -->
   Read the plan in the result. A plan renders as it was planned here, so when a word or the name is wrong, tell the user before rendering.
<!-- end -->
4. Render each plan with `render_launch_film`.
<!-- with check_video -->
   Once each render is done, check its film with `check_video` and `expect` {fact:launch-film.size_16_9}@{fact:launch-film.fps}, or {fact:launch-film.size_9_16}@{fact:launch-film.fps} for 9:16. Its `CHECK.md` gives the film's length under its heading and each cut's time in its Cuts table, the logo close last.
<!-- end -->
<!-- local -->
```call
render_launch_film {"film": "launch/film-16x9/film.json"}
check_video {"film": "launch/film-16x9/film.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}"}
```
<!-- end -->
<!-- hosted -->
```call
render_launch_film {"film": "job:<job_id>/film.json"}
```
   film.json is the plan's job's.
<!-- with check_video -->
```call
check_video {"film": "job:<job_id>/film.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}"}
```
   film.mp4 is the render's.
<!-- end -->
<!-- end -->
5. Make the pictures with `make_launch_stills`, with `source` the film's film.json and `for` the places, so they match the film's look and words. They go to stills/ next to that film.json, with `stills/STILLS.md` saying which file is for which place.
<!-- local -->
```call
make_launch_stills {"source": "launch/film-16x9/film.json", "for": ["ph", "og", "x"]}
```
<!-- end -->
<!-- hosted -->
```call
make_launch_stills {"source": "job:<job_id>/film.json", "for": ["ph", "og", "x"]}
```
<!-- end -->
<!-- with fit_music -->
6. For the user's track, follow the music topic: `analyze_music`, then `fit_music` with `length` the film's length and `hit` the time of its logo close, both from its film.timeline.json, and `fps` {fact:launch-film.fps}. Given the film as `video`, it also writes video.mp4, the film with the track under it.
<!-- local -->
   Give `fit_music` an `out_dir` inside the film's folder, like its music/, so that folder holds the film's track.
```call
fit_music {"track": "music/track.mp3", "length": "24", "hit": "18.667", "fps": {fact:launch-film.fps}, "video": "launch/film-16x9/film.mp4", "video_sound": "keep", "out_dir": "launch/film-16x9/music"}
```
   Give it the film as `video`, with `video_sound` keep for a film planned with `music` false, whose sound is its effects: video.mp4 is then the film with the track under it. Check that file with `check_video`, `cues` set to the fitted track's cues.json and `cuts` to the film's film.timeline.json, which a file under another name does not find by itself.
<!-- end -->
<!-- hosted -->
```call
fit_music {"track": "https://example.com/track.mp3", "length": "24", "hit": "18.667", "fps": {fact:launch-film.fps}, "video": "job:<job_id>/film.mp4", "video_sound": "keep"}
```
   film.mp4 is the render's. video.mp4 is then the film with the track under it, `video_sound` keep holding the effects of a film planned with `music` false.
<!-- end -->
<!-- end -->
<!-- without fit_music -->
6. A track of the user's cannot be fitted here. Hand over the film with its own music, or the film planned with `music` false and the length the track must have.
<!-- end -->
<!-- with reframekit -->
7. For the 4:5 feeds, a square post, X or LinkedIn, make each place's version of the 16:9 film with `reframe_video`, and show its sheet.png: a 9:16 plan suits TikTok, Reels and Shorts better than a crop (the reframe topic).
<!-- local -->
```call
reframe_video {"video": "launch/film-16x9/film.mp4", "for": ["feed", "square", "x", "linkedin"]}
```
<!-- end -->
<!-- hosted -->
```call
reframe_video {"video": "job:<job_id>/film.mp4", "for": ["feed", "square", "x", "linkedin"]}
```
<!-- end -->
<!-- with fit_music -->
   When `fit_music` made video.mp4, reframe that file in place of film.mp4, whose sound is only the effects of a film planned with `music` false, so each place's file carries the user's track. video.mp4 has no timeline under its name, so give `cuts` the film's film.timeline.json, as the reframe topic shows.
<!-- end -->
<!-- end -->
8. Check the rest before the hand over.
<!-- with easyscreenshotkit -->
   - `check_pwa_screenshots` with `manifest` the pwa/manifest-screenshots.json of `take_screenshots`.
<!-- with check_video -->
   - `check_video` on the demo, with `expect` {fact:easyscreenshotkit.demo.size}@{default:record_demo_video.fps}.
<!-- end -->
<!-- end -->
<!-- with check_video -->
<!-- local -->
   - Look at every check's sheet.png and at every picture, for words cut off, text on text and a wrong logo. When you cannot open a picture, give the user its path with what to look for.
<!-- end -->
<!-- hosted -->
   - Give the user the links to the pictures, the checks' sheet.png among them, with what to look for: words cut off, text on text and a wrong logo. Nothing here shows you a picture.
<!-- end -->
<!-- end -->
<!-- without check_video -->
   - Give the user each picture and each film with what to look for: words cut off, text on text and a wrong logo. Nothing here checks a film or shows you a picture, so say the films were not checked.
<!-- end -->
<!-- with check_video -->
   - A film planned with `music` false fails the silence check of `check_video` until a track is under it; with `sfx` false too it is silent throughout, which passes with the warning "the sound is silent throughout" unless `lufs` is given. Its size, frame rate and cuts are still measured right.
<!-- end -->

<!-- local -->
## Folders

Give each piece its own folder under one launch folder, so no run replaces another:
<!-- with easybrandkit -->
- launch/brand, the brand kit
<!-- end -->
<!-- with easyscreenshotkit -->
- launch/screenshots and launch/demo
<!-- end -->
<!-- with easyfontkit -->
- launch/fonts
<!-- end -->
- launch/film-16x9 and launch/film-9x16, one for each plan
<!-- with musicfit -->
- launch/film-16x9/music, the fitted track, inside the film's folder
<!-- end -->
<!-- with reframekit -->
- launch/film-16x9/reframekit-film, each place's version of the film, which `reframe_video` makes next to it
<!-- end -->

A new plan in a folder that holds a render leaves that film.mp4, film.timeline.json, frames/ and stills/ beside the new film.json, which no longer match it, so give a second plan or a new look a new folder.
<!-- end -->

## Tempo

The film's cuts fall on the bars of its look's own music: launch at {fact:launch-film.look_bpm.launch} BPM, aurora {fact:launch-film.look_bpm.aurora}, gridline {fact:launch-film.look_bpm.gridline}, pop {fact:launch-film.look_bpm.pop} and journal {fact:launch-film.look_bpm.journal}. A track at another tempo lands some of those cuts off its beat, and nothing here retimes the film.
<!-- with musicfit -->
`analyze_music` gives the track's tempo before the plan. Only a look at that tempo, or at half or double it, keeps every cut on the beat, and a look a few BPM away does not: pick that look when the user agrees to its style, or tell the user that some cuts will miss the beat.
<!-- end -->

## Hand over

List every file by place: the file, its size, and what it is for. Say what you chose where the user left it open, like the places and the film's shape. Then say what was checked, with each verdict, and what is left to the user: laying a track under a film when that was not done, uploading to each place, and any place no tool here makes for.
<!-- hosted -->
Give each file its own link from its result, with the time it stops working: no link opens a folder.
<!-- end -->
