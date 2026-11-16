---
name: reframe
title: A video in each place's shape
index: reframe_video, plan_reframe and check_place_limits: each place's shape, length and size, the crop, the checks
description: Turns one finished video into the version each place takes with reframekit, 9:16 for TikTok, Reels and Shorts, 4:5 for the feeds, 1:1, and 16:9 for YouTube, X and LinkedIn, with a crop that follows what moves and each file cut and fitted to its place's published limits, and checks any MP4 against those limits. Use it when a video has to go to a place in another shape, or within a place's length or file size.
kit: reframekit
requires: [reframekit]
optional: [easybrandkit, easyscreenshotkit, easycaptionkit, check_video, fit_music, make_launch_film, plan_launch_film]
order: 72
---
# A video in each place's shape

`reframe_video` turns one finished video into the file each place takes: it finds the shots, gives each shot and shape a window that follows what moves, pads a shot a crop would cut, cuts each file at a shot change to its place's length, keeps it under its size limit, sets its loudness and checks it against the limits the place publishes. `plan_reframe` does the same without rendering, so the windows can be looked at first. `check_place_limits` measures any MP4 against those limits.

## Decide first

- The video: a finished video, any file ffmpeg reads. Nothing here edits it, adds a title or changes its sound but for its loudness.
- The places, as `for`, from the table below. When the user names none, make all of them and say which those are.
<!-- hosted -->
- The video's size here: at most 3840x2160 pixels (or 2160x3840), in 4:2:0 at 8 or 10 bits, as phones and cameras record it, and a size given in `for` at most 2560x1440 pixels (or 1440x2560). A larger video, or a ProRes or 4:4:4 master, fails before its kit starts: ask the user for an H.264 or HEVC copy first.
<!-- end -->
- The crop follows motion, not faces: nothing in it knows a person or a product. For anything that matters, plan first and look at the windows.
<!-- with make_launch_film, plan_launch_film -->
- A launch film: a 9:16 plan of `plan_launch_film` is laid out for a phone, which a crop of the 16:9 film is not. For TikTok, Reels and Shorts, render the film in 9:16 too when the user wants the best one, and reframe the 16:9 film for the feeds, square, X and LinkedIn. Its film.timeline.json beside its film.mp4 gives its clips as the shots.
<!-- with fit_music -->
  When `fit_music` laid the user's track under the film as video.mp4, give `reframe_video` video.mp4 in place of film.mp4, whose sound is then only its effects, and `cuts` the film's film.timeline.json, since no timeline is beside video.mp4 under its name.
<!-- end -->
<!-- end -->
<!-- with easyscreenshotkit -->
- A demo from `record_demo_video`: its steps.json beside its demo.mp4 gives its pages, the page's box and each click, and the window goes to each click and stays off the backdrop.
<!-- with fit_music -->
  When `fit_music` laid a track under the demo as video.mp4, give `reframe_video` video.mp4 and `steps` the demo's steps.json, which is not beside it under its name.
<!-- end -->
<!-- end -->
<!-- with easycaptionkit -->
- Captions go on after reframing, one file per place, so each keeps clear of its own app's buttons (the captions topic).
<!-- end -->
- Never call a file cleared for posting: reframekit checks the limits each place published when it was read, {fact:reframekit.limits_read}, and nothing of rights.

## The places

| Place | `for` | File | Size | Longest |
| --- | --- | --- | --- | --- |
| TikTok | tiktok | tiktok.mp4 | {fact:reframekit.size.tiktok} | {fact:reframekit.seconds.tiktok} s |
| Instagram Reels | reels | reels.mp4 | {fact:reframekit.size.reels} | {fact:reframekit.seconds.reels} s |
| YouTube Shorts | shorts | shorts.mp4 | {fact:reframekit.size.shorts} | {fact:reframekit.seconds.shorts} s |
| YouTube | youtube | youtube.mp4 | {fact:reframekit.size.youtube} | {fact:reframekit.seconds.youtube} s |
| X | x | x.mp4 | {fact:reframekit.size.x} | {fact:reframekit.seconds.x} s |
| LinkedIn | linkedin | linkedin.mp4 | {fact:reframekit.size.linkedin} | {fact:reframekit.seconds.linkedin} s |
| The 4:5 feeds | feed | feed.mp4 | {fact:reframekit.size.feed} | as Reels |
| Any feed, square | square | square.mp4 | {fact:reframekit.size.square} | none |

Each file comes with its cover, like tiktok-cover.jpg. A size like 1080x1350 makes a file of that name too. Places that need the same picture share one encode, so reels.mp4 can be a copy of tiktok.mp4. TikTok gives some accounts 10 minutes and a verified YouTube account takes 12 hours: give `trim` false for those.

## Steps

1. Plan with `plan_reframe` and the places:
<!-- local -->
```call
plan_reframe {"video": "launch/film-16x9/film.mp4", "for": ["feed", "square", "x", "linkedin"]}
```
   The folder is reframekit-<video's name> next to the video, which `reframe_video` uses too, unless the call gives another `out_dir`.
<!-- end -->
<!-- hosted -->
```call
plan_reframe {"video": "job:<job_id>/film.mp4", "for": ["feed", "square", "x", "linkedin"]}
```
<!-- end -->
<!-- local -->
2. Look at sheet.png, and sheet-2.png and on for more than {fact:reframekit.shots_a_sheet} shots: each shape's window on three frames of every shot, solid for a crop, dashed for a padded shot. Check that each holds the person, the product and the words; words cut at a window's edge are the usual miss. When you cannot open a picture, give the user its path with what to look for.
3. Fix a window that misses in crop.json, as the next section says, then render with `crop`, the same `video` and the plan's other arguments, without `mode`, `cuts` or `steps`, which crop.json holds:
```call
reframe_video {"video": "launch/film-16x9/film.mp4", "for": ["feed", "square", "x", "linkedin"], "crop": "launch/film-16x9/reframekit-film/crop.json"}
```
   With nothing to fix, render without `crop` and with the plan's own arguments, which plans the same windows again.
<!-- end -->
<!-- hosted -->
2. Give the user the link to sheet.png, and to sheet-2.png and on for more than {fact:reframekit.shots_a_sheet} shots, with what to look for: each shape's window on three frames of every shot, solid for a crop, dashed for a padded shot, holding the person, the product and the words. Nothing here shows you a picture.
3. A crop.json cannot be changed here, so a window cannot be moved. When the windows are right, render with the plan's own arguments, which plans the same windows again; when one misses, tell the user, and offer `mode` pad, which shows every shot whole:
```call
reframe_video {"video": "job:<job_id>/film.mp4", "for": ["feed", "square", "x", "linkedin"]}
```
<!-- end -->
4. Read FORMATS.md in the result: every file with its size, length, loudness and its place's checks, what was cut to length and why, the shots and what each window did, and each limit with its source. A file that fails a limit is named there.
<!-- with easycaptionkit -->
5. For captions, give `caption_video` one file of each shape with its places in `for`, the 9:16 one with tiktok, reels and shorts together, since `check_place_limits` holds every 9:16 place to Meta's margins for Reels. Then check the captioned file with `check_place_limits` and its captions.ass as `captions`.
<!-- end -->
<!-- with check_video -->
6. `check_video` measures what this check does not: black, still and silent stretches, and the cuts against a track's beats.
<!-- end -->

<!-- local -->
## Moving a window

crop.json holds every shot with its `n`, `start` and `end`, and for each shape its window under `windows`: its `mode`, its `w` and `h`, and its `path`, a list of points [seconds, x, y], the window's top left corner in the video's own pixels. One point holds the window still, and more glide through them. Set `mode` to pad to show a shot whole, or to follow to crop it; make `w` and `h` smaller in the same shape to zoom in. To crop part of a shot and pad the rest, split it into two shots of at least 0.4 s, each with its windows. `keeps` is the share of what moves inside the window. A crop.json rendered after an edit keeps counting as edited, so render it with `crop` from then on.

Given places of a shape crop.json has no windows of, a `crop` render plans that shape for its shots and keeps the rest; `plan_reframe` with `crop` shows those windows first.
<!-- end -->

## Every parameter

`reframe_video` and `plan_reframe` take the same:
- `video`, the file. A launch film's timeline or a demo's steps file beside it, under its name, gives its shots; `steps` gives a demo's steps file that is not beside it, and `cuts` every shot change by hand, as seconds like "3.2,7.5" or a JSON file, in place of all found. Give them all: a cut left out is no cut.
<!-- with fit_music -->
  The video.mp4 of `fit_music` has neither beside it, so for a launch film with the user's track under it give `cuts` the film's timeline:
<!-- local -->
```call
reframe_video {"video": "launch/film-16x9/music/video.mp4", "cuts": "launch/film-16x9/film.timeline.json", "for": ["feed", "square", "x", "linkedin"]}
```
<!-- end -->
<!-- hosted -->
```call
reframe_video {"video": "job:<fit_job_id>/video.mp4", "cuts": "job:<film_job_id>/film.timeline.json", "for": ["feed", "square", "x", "linkedin"]}
```
   video.mp4 is the fit's, film.timeline.json the film's.
<!-- end -->
<!-- end -->
- `for`, at most {fact:reframekit.places_max} places in one run.
- `mode`: follow (default), center, pad, or fit, which keeps the picture's own shape and only fits each place's limits, so places of any shape whose frame fits the picture share one file.
- `pad`: what a padded shot sits on, blur (default), black, white, a color like #0f172a, or brand with `brand`, a brand kit whose page background is used.
<!-- with easybrandkit -->
  `make_brand_kit` makes that kit.
<!-- end -->
- `seconds`: at most this long in every file, cut at a shot change, like "30" or "1:30". `trim` false never cuts a file to its place's length.
- `lufs`: the loudness, {default:reframe_video.lufs} LUFS unless given. `fps`: the files' frame rate, the video's unless given. `cover`: the moment of every cover, picked unless given.
<!-- local -->
- `crop`: a crop.json to render as it is. It takes no `cuts` or `steps`, and no `mode` but fit.
- `out_dir`: by default reframekit-<video's name> next to the video. A folder holds the run of one video: a run of the same video there replaces the files it makes again and keeps the other places', and a folder of another video's run, or one that holds anything but an earlier run, is refused.
<!-- end -->
<!-- local -->
- `wait_seconds`: a plan takes seconds to a minute; rendering every place of a long video takes minutes.
<!-- end -->
<!-- hosted -->
- `wait_seconds`: a job here has a share of one machine. A plan of a minute of 1920x1080 video takes about 20 seconds, and each file from about 2 minutes for each minute of video, as easy footage takes it, to about 5 with grain. With every place in `for` there are four files for a video up to 140 seconds long, five up to 3 minutes and six past that, since places of one size and length share a file; fewer places take fewer. A job stops after {limit:job_minutes}. A video that could not be made in the time its job has left even as easy footage fails before its kit starts, with what fits: for `reframe_video` ask for fewer places or give `seconds`, and for `plan_reframe`, which reads the whole video, give a shorter one. Footage with grain or noise, as from a phone camera, takes two to three times as long, so it can pass that check and still be stopped when the time runs out, with no files kept: for more than a minute of video with every place, offer fewer places or `seconds` first, or a run on the user's own machine.
<!-- end -->

## The check

`check_place_limits` measures finished files and changes nothing: shape, size, frame rate, length, file size, codecs, and whether the MP4 is whole, with its index first and no edit lists.
<!-- local -->
Give `target` a folder `reframe_video` made, its formats.json, or one MP4 with `for`, the places to check it against.
<!-- end -->
<!-- hosted -->
Give `target` the formats.json of a `reframe_video` job, whose files come with it, or one MP4 with `for`, the places to check it against.
<!-- end -->
With `captions`, the ASS, SRT or WebVTT file burned into the video, it checks their timing, and an ASS file's text against each 9:16 place's safe area. The estimate errs wide, so look at a frame before moving a caption that fails by a little.
<!-- local -->
```call
check_place_limits {"target": "launch/film-16x9/reframekit-film/formats.json"}
```
<!-- end -->
<!-- hosted -->
```call
check_place_limits {"target": "job:<job_id>/formats.json"}
check_place_limits {"target": "job:<job_id>/tiktok.mp4", "for": ["tiktok"]}
```
<!-- end -->
<!-- with easycaptionkit -->
<!-- local -->
```call
check_place_limits {"target": "launch/film-16x9/reframekit-film/easycaptionkit-tiktok/captioned.mp4", "for": ["tiktok"], "captions": "launch/film-16x9/reframekit-film/easycaptionkit-tiktok/captions.ass"}
```
<!-- end -->
<!-- hosted -->
```call
check_place_limits {"target": "job:<job_id>/captioned.mp4", "for": ["tiktok"], "captions": "job:<job_id>/captions.ass"}
```
<!-- end -->
<!-- end -->
It writes CHECK.md, which the result shows, and check.json. A failed check is a normal result with `passed` false: CHECK.md names each file, its place and what it missed.

## When something goes wrong

<!-- local -->
- "is not empty and holds no earlier reframekit run": give another `out_dir`, or the default one.
- "holds a run for <one video>, not for <another>": that folder is another video's; give another `out_dir`.
- "is not a file reframekit wrote": a file there of that name is someone's, or was changed since reframekit wrote it; give another `out_dir`.
- "Another reframekit run (process <pid>) is writing in <folder>": wait for that job, or give another folder.
- "<file> was edited by hand, and this run would plan over it.": render it with `crop`, or move it away to plan again.
- "crop already says each window's mode; leave out mode, or give mode fit to keep the picture's shape" and "crop already holds the shots; leave out cuts and steps": drop those arguments.
<!-- end -->
- "pad brand needs brand, an easybrandkit folder": give `brand`, or another `pad`.
- "gives no cut inside the video": the `cuts` are another video's, or frames given as seconds.
- A window on the wrong thing, a talking head padded beside a busy shelf, or words cut by a crop: motion stands in for the subject.
<!-- local -->
  Move the window, or set that shot's `mode` to follow or pad, in crop.json.
<!-- end -->
<!-- hosted -->
  Tell the user, since a window cannot be moved here; `mode` pad keeps every shot whole.
<!-- end -->
- A voice missing from the files: the video has more than one sound track and only the first is kept, as FORMATS.md says.
- A run that fails, is refused or is canceled leaves its folder as it was.
<!-- hosted -->
- "for <size>: a file reframekit makes here may have at most 2560x1440 pixels (or 1440x2560)": ask for a smaller size. "for takes at most 12 places in one run. Ask for the others in another job.": split the places over two jobs.
- "<param> is <size>: <tool> here takes a video of at most 3840x2160 pixels (or 2160x3840)" or "<tool> here takes a picture in 4:2:0 of 8 or 10 bits alone": ask the user for a smaller copy in H.264 or HEVC.
- "<param> runs <time> at <size>, and reframe_video here makes the files asked for of about <time> of a video that size": even easy footage could not be made in the time the job had left; ask for fewer places or give `seconds`. For `plan_reframe`, give a shorter video.
- "It ran longer than <time> and was stopped.": the footage took longer than easy footage, as grain does; ask for fewer places or `seconds`.
<!-- end -->
<!-- local -->
- "reframekit needs ffmpeg and ffprobe": the troubleshooting topic. It needs an ffmpeg built with --enable-gpl, as Ubuntu's is.
<!-- end -->

## Hand over

<!-- local -->
- Each file by place, with its path, its size and length, and its cover.
<!-- end -->
<!-- hosted -->
- Each file by place, with its own link, its size and length, and its cover's link.
<!-- end -->
- From FORMATS.md: what was cut to length, and any limit a file missed.
- Whether sheet.png was looked at, and that the crop follows motion, not faces.
- That the limits are what each place published on {fact:reframekit.limits_read}, and that nothing here checked whether the video may be posted.
