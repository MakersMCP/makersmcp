---
name: checks
title: Checking a video before it goes out
index: check_video: what to expect of each video, cuts on the beat, reading CHECK.md and the sheet
description: Measures a video's size, frame rate, length, black, still and silent stretches, loudness, true peak, clipping and cuts on the beat with launch-film's check, and says what to ask of a launch film, a demo or a copy with music laid in, how to read the report and its contact sheet, and what the check does not measure. Use it before handing over any video, or when the user asks whether a video meets a platform's limits.
kit: launch-film
requires: [launch-film, check_video]
optional: [easyscreenshotkit, fit_music, analyze_music]
order: 67
---
# Checking a video before it goes out

`check_video` measures a video with ffmpeg and writes a report that passes or fails. Nobody here can watch the video or hear it, and a measurement cannot read words, so measure it with this tool, then have the contact sheet it makes looked at. It knows no platform: it checks the values it is given.

## Decide first

- `check_video` measures size, frame rate, length, black, still and silent stretches, loudness, true peak, clipping, and, with a track's cues, whether the cuts land on the beat. It does not measure file size, codec, bitrate or the space an app's buttons cover. When the user asks whether a video passes a platform's limits, check what it measures and say what it does not, without stating a platform's rule as fact.
- `expect` is the size and frame rate as WxH@fps, WxH alone or @fps alone. A launch film is {fact:launch-film.size_16_9}@{fact:launch-film.fps}, or {fact:launch-film.size_9_16}@{fact:launch-film.fps} for 9:16: its {fact:launch-film.fps} frames a second are its own, never a fault.
<!-- with easyscreenshotkit -->
  A demo from `record_demo_video` is {fact:easyscreenshotkit.demo.size} at the `fps` it was recorded with, {default:record_demo_video.fps} unless given.
<!-- end -->
- `seconds` is text: "30" passes within {fact:launch-film.check_seconds_tolerance} seconds of 30, and "20-40" anything inside. A launch film's exact length is the seconds field of its `film.timeline.json`.
- `lufs` is the integrated loudness to check, within {fact:launch-film.check_lufs_tolerance} LU. Give it only when the user needs a level. A launch film measures about {fact:launch-film.lufs} LUFS as it was rendered, and nothing here changes that. launch-film's own guide gives {fact:launch-film.lufs_social} as the level YouTube, X and most social apps play at.
- `allow` lists stretches meant to hold still, black or silent, in seconds, like 27-30,0-0.5.

## Steps

1. Check the video:
<!-- local -->
```call
check_video {"film": "launch/film-16x9/film.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "seconds": "{fact:launch-film.length_min}-{fact:launch-film.length_max}"}
```
<!-- end -->
<!-- hosted -->
```call
check_video {"film": "job:<job_id>/film.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "seconds": "{fact:launch-film.length_min}-{fact:launch-film.length_max}"}
```
<!-- end -->
2. Read `CHECK.md` in the result. Its heading says PASS or FAIL with the checks that failed, a table gives every check with what was asked and what was found, and its Cuts section says where the cuts came from.
3. A failed check is a normal result, with `passed` false. A failed job means the check could not run: the errors below say why.
<!-- local -->
4. Look at `sheet.png`, a frame from each shot once its entrance has played, with the cut's number and time, and at `wave.png`, the loudness over time with the cuts. On the sheet, look for words cut off, out of the frame or spelled wrong, text on text, a logo that is not whole, sharp and the brand's own, a cookie banner or a login page in place of the product's screen, and anything blank. When you cannot open a picture, give the user its path with what to look for, and never say you looked at it.
<!-- end -->
<!-- hosted -->
4. Give the user the links to `sheet.png`, a frame from each shot once its entrance has played, and `wave.png`, the loudness over time with the cuts, since nothing here shows you a picture, and say what to look for on the sheet: words cut off, out of the frame or spelled wrong, text on text, a logo that is not whole, sharp and the brand's own, a cookie banner or a login page in place of the product's screen, and anything blank.
<!-- end -->

## What each check means

`check_video` passes each check when:

| Check | Passes when |
| --- | --- |
| size, frame rate | they match `expect` |
| length | it matches `seconds` |
| black, still picture, silence | no long stretch: up to {fact:launch-film.check_start.black} s black, {fact:launch-film.check_start.still} s still or {fact:launch-film.check_start.silence} s silent at the start; up to {fact:launch-film.check_end.black} s black, {fact:launch-film.check_end.still} s still, as an end card, or {fact:launch-film.check_end.silence} s silent at the end; inside the film, under {fact:launch-film.check_hold.black} s black, {fact:launch-film.check_hold.still} s still or {fact:launch-film.check_hold.silence} s silent |
| loudness | it is within {fact:launch-film.check_lufs_tolerance} LU of `lufs` |
| true peak | it is {fact:launch-film.check_true_peak} dBTP or lower; up to 0 is a warning |
| clipping | the sound never reaches full scale or sits flat on its peak |
| cuts on beats | each hard cut is within {fact:launch-film.check_beat_frames} frame of a beat in `cues`; within {fact:launch-film.check_near_beat_frames} is a warning |

A longer stretch is a warning to look at, not a failure. Black or silent stretches that add up to {fact:launch-film.check_most} of the film or more fail it, while a film mostly still only warns. The stretches given in `allow` count as meant. A steady frame rate and square pixels are checked too, as warnings.

## Cuts

- `check_video` takes a launch film's cuts from the `film.timeline.json` next to it, found by the video's own name: film.mp4 takes film.timeline.json.
<!-- local -->
- A copy under another name, like one with music laid in, finds no timeline. Give `cuts` the film's `film.timeline.json`. A check saves in check/ next to the video, which every video in that folder shares, so give this one an `out_dir` of its own to keep the film's report:
```call
check_video {"film": "launch/film-16x9/with-music.mp4", "cuts": "launch/film-16x9/film.timeline.json", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "out_dir": "launch/film-16x9/check-music"}
```
<!-- end -->
<!-- hosted -->
- A video given as a link comes alone, with no timeline beside it: give `cuts` the film's `film.timeline.json` as job:<job_id>/film.timeline.json.
<!-- end -->
- Other videos take `cuts` as seconds, like 3.2,7.5, or a JSON file of seconds, of frames with their fps, or a launch-film timeline. Without them, the check finds the hard cuts in the picture and lists soft changes, like crossfades, without judging them; "no cut to judge" then asks for `cuts`.
<!-- with easyscreenshotkit -->
- A demo's `steps.json` is no cuts file: give the `pressedAt` of its clicks as seconds.
<!-- end -->

## Beats

<!-- with fit_music -->
- `cues` of `check_video` takes the `cues.json` of the track under the video: `fit_music` writes one for the fitted track, and `analyze_music` one for a track that plays as it is from the first frame. Its frames count at the fps written in it, so it need not be the video's.
<!-- end -->
<!-- without fit_music -->
<!-- with analyze_music -->
- `cues` of `check_video` takes a `cues.json` with the track's beats as frame numbers at the fps it names: `analyze_music` writes one for a track that plays as it is from the first frame, or the user brings one:
<!-- end -->
<!-- without analyze_music -->
- `cues` of `check_video` takes a `cues.json` with the track's beats as frame numbers at the fps it names, a file the user brings:
<!-- end -->
<!-- local -->
```call
check_video {"film": "launch/film-16x9/with-music.mp4", "cues": "music/cues.json", "cuts": "launch/film-16x9/film.timeline.json", "out_dir": "launch/film-16x9/check-music"}
```
<!-- end -->
<!-- hosted -->
```call
check_video {"film": "https://example.com/with-music.mp4", "cues": "https://example.com/cues.json", "cuts": "job:<job_id>/film.timeline.json"}
```
<!-- end -->
<!-- end -->
- A track with no steady beat has no beats, and the check refuses its cues.
- A launch film cuts on the bars of its own look's music, so a track at another tempo lands some cuts off its beat. That is how it was made, and nothing here retimes the film: tell the user.
<!-- with fit_music -->
- A cues length warning means the cues are for another length: fit the track to the video's exact length.
<!-- end -->
<!-- without fit_music -->
- A cues length warning means the track the cues are of is longer or shorter than the video by more than a second.
<!-- end -->

## A launch film's own numbers

Its sound is normalized to {fact:launch-film.lufs_target} LUFS under a {fact:launch-film.true_peak} dBTP ceiling before it is encoded, and the film comes out louder: about {fact:launch-film.lufs} LUFS here, with a true peak that sometimes passes {fact:launch-film.check_true_peak} dBTP. A loudness or true peak failure on a launch film is how it was rendered: tell the user the measurement, and never render it again for that, since a render gives the same. A launch film planned with `music` false fails the silence check until a track is under it.

## When the check cannot run

The job fails with the kit's reason, then `The check could not run: the kit wrote no CHECK.md.`:

- `expect "<x>" should look like 1920x1080@30`, `seconds "<x>" should be a length like 30, or a range like 28-32` and `allow "<x>" should be a stretch in seconds, like 27-30`: write the value in that form.
- `<file> could not be read as a video`: the file is not a video ffmpeg reads.
<!-- local -->
  It also comes when no ffprobe was found, as the ffprobe line of `check_setup` says, and the troubleshooting topic has the fix. A LAUNCH_FILM_FFPROBE or LAUNCH_FILM_FFMPEG that `check_setup` lists as no program file stops the call before it starts, with that same line.
<!-- end -->
- `<cues>: "fps" must be the frames a second the numbers count in`, `"beats" is missing`, `"beats" must be a list of frame numbers` or `"beats" is empty`: the cues file is not a track's cues, or the track has no steady beat.
- `<cuts> holds no cuts: give seconds, { "fps", "cuts" } in frames, or a launch-film timeline`: give one of those.
- `reading the sound: ffmpeg failed: <why>`: the sound track cannot be read.
<!-- local -->
- `film: there is nothing at <path>` and `cuts: there is nothing at <path>, and "<text>" is not text the kit takes.` come before the job starts: the path is read from {base_dir} unless it is absolute.
<!-- end -->

## Hand over

Give the verdict, each failed check with what was measured, the warnings worth a look, and what the check does not measure. Never call a video ready for a platform from this check alone, since it knows no platform's rules.
