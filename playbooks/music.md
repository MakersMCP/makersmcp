---
name: music
title: Music fitted to a film or a demo
index: analyze_music and fit_music: a track fitted to a film or a demo, the hit, a voice, what comes after
description: Fits a music track to a video's exact length with musicfit, lands its drop on a chosen moment, ducks it under a voice and sets its loudness. Use it when a track from the user, a library or a music model has to fit a launch film, a demo or any cut.
kit: musicfit
requires: [musicfit, fit_music]
optional: [launch-film, easyscreenshotkit, check_video]
order: 70
---
# Music fitted to a film or a demo

`fit_music` makes a music track exactly as long as a video by cutting or looping whole bars, lands its drop on a chosen moment (the hit), ends it on a beat, ducks it under a voice and sets its loudness. `analyze_music` reads the track's tempo, bars, drop and ending first. Both write sound only: no tool here lays the track under a video.

## Decide first

- The video's exact length, its frame rate and the moment for the drop: the next section says where each comes from.
- The track: any file ffmpeg reads, a video's sound too. No tool here makes music, so when the user has none, say so and ask for one. An instrumental a little longer than the video fits best: seams follow bars and can cut a sung line, and the tempo and pitch never change.
- Never call a track cleared for use: musicfit does not check rights.
- Never say the track is in the video before a file with it exists: no tool here puts it there.
<!-- with launch-film -->
- A launch film takes no music file: the `music` of its `film.json` is false or a volume for the look's own bed, and a file there is ignored without a word. Plan a film for the user's track with `plan_launch_film` and `music` false, after reading the track's tempo (A launch film's tempo, below).
<!-- end -->

## Where the numbers come from

<!-- with launch-film -->
- A launch film runs at {fact:launch-film.fps} frames a second. `film.timeline.json` beside its `film.mp4` gives its length as `seconds`, and its logo close, the usual hit, as the `start` of the clip whose `kind` is logo.
<!-- end -->
<!-- with check_video -->
  Without access to that file, `check_video` without `cues` gives the same in `CHECK.md`: the length and frame rate of any video, and a launch film's cuts with their times and kinds.
<!-- end -->
<!-- with easyscreenshotkit -->
- A demo from `record_demo_video` runs at its `fps`, {default:record_demo_video.fps} unless set. Its `steps.json` gives the length as `video.duration`, or as `video.frames` with an f, and each click's moment as `pressedAt`.
<!-- end -->
- Any other video: ask the user for its length and frame rate.

## Steps

1. Read the track with `analyze_music`. `FIT.md` comes back with its tempo, its drop and the other candidates, its ending and any warning.
<!-- local -->
   Give it its own `out_dir`: it would delete a fit in the folder it shares with `fit_music`.
```call
analyze_music {"track": "music/track.mp3", "out_dir": "launch/music-analysis"}
```
<!-- end -->
<!-- hosted -->
```call
analyze_music {"track": "https://example.com/track.mp3"}
```
<!-- end -->
2. Fit it with `fit_music`: `length` and `hit` as text, like "29.333" or "600f", and `fps` the video's. Give `drop` only when the drop `FIT.md` names is not the one the user means.
<!-- local -->
   Give `lufs` -16 when the track will be laid in with ffmpeg (step 4).
<!-- end -->
<!-- with launch-film -->
   For a launch film, `length` is its `seconds`, `hit` its logo `start` and `fps` {fact:launch-film.fps}.
<!-- local -->
```call
fit_music {"track": "music/track.mp3", "length": "29.333", "hit": "24", "fps": {fact:launch-film.fps}, "lufs": -16, "out_dir": "launch/music"}
```
<!-- end -->
<!-- hosted -->
```call
fit_music {"track": "https://example.com/track.mp3", "length": "29.333", "hit": "24", "fps": {fact:launch-film.fps}}
```
<!-- end -->
<!-- end -->
<!-- without launch-film -->
<!-- local -->
```call
fit_music {"track": "music/track.mp3", "length": "32", "hit": "27.5", "fps": 30, "lufs": -16, "out_dir": "music/fit"}
```
<!-- end -->
<!-- hosted -->
```call
fit_music {"track": "https://example.com/track.mp3", "length": "32", "hit": "27.5", "fps": 30}
```
<!-- end -->
<!-- end -->
3. Read `FIT.md`: its "Where to listen" table gives the start, each seam, the hit and the end. Show `seams.png`, and act on any warning.
4. Lay the track under the video, as the next section says.
<!-- with check_video -->
5. Check it with `check_video`, then hand it over.
<!-- end -->
<!-- without check_video -->
5. Hand it over.
<!-- end -->

## Laying it under the video

No tool here lays a track under a video.
<!-- local -->
When you can run commands, one ffmpeg command does it, with the paths the results gave:

```sh
ffmpeg -i <video> -i <fit folder>/fitted.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k <video's folder>/with-music.mp4
```

The picture stays as it is, and the track replaces the video's sound, a launch film's effects too. With a `voice`, give `mix.wav` instead. The AAC encoding can lift a track fitted at the default `lufs` of {default:fit_music.lufs} above the {fact:musicfit.true_peak} dBTP that `fit_music` held it to; -16 usually leaves room for it.

When you cannot run commands, hand the files over instead.
<!-- end -->
<!-- hosted -->
Nothing here runs a command, so hand over the links to the video and the track.
<!-- end -->
Tell the user to put `fitted.wav`, or `mix.wav` with a voice, under the whole video from its first frame, in the app they cut video with, without trimming or stretching it: it is already exactly as long.

<!-- with check_video -->
## Checking it

`check_video` with `cues` set to the fit's `cues.json` measures whether each cut lands on a beat. Its `expect` is {fact:launch-film.size_16_9}@{fact:launch-film.fps} for a launch film, {fact:launch-film.size_9_16}@{fact:launch-film.fps} for 9:16.
<!-- local -->
For `with-music.mp4`, give `cuts` the film's `film.timeline.json`, which `check_video` finds by itself only beside `film.mp4`, and an `out_dir` of its own, since check/ next to it holds the film's report. Without a file that has the track, check `film.mp4` with `cues` alone.
```call
check_video {"film": "launch/film-16x9/with-music.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "cues": "launch/music/cues.json", "cuts": "launch/film-16x9/film.timeline.json", "out_dir": "launch/film-16x9/check-music"}
```
<!-- end -->
<!-- hosted -->
Check the film itself: its cuts against the track's beats come out the same, while its loudness, peaks and silence are the film's own sound.
```call
check_video {"film": "job:<film_job_id>/film.mp4", "expect": "{fact:launch-film.size_16_9}@{fact:launch-film.fps}", "cues": "job:<fit_job_id>/cues.json"}
```
<!-- end -->
- A film planned by `plan_launch_film` with `music` false fails the silence check until a track is under it.
- A track with no steady beat has empty `beats`, which `check_video` refuses.
<!-- with easyscreenshotkit -->
- For a demo, give `cuts` the clicks' `pressedAt` in seconds, like "2.25,4.632,7.017": `steps.json` is no cuts file.
<!-- end -->
<!-- end -->

<!-- with launch-film -->
## A launch film's tempo

A launch film's clips last whole bars of its look's own music, so its cuts follow the look's tempo: launch {fact:launch-film.look_bpm.launch}, aurora {fact:launch-film.look_bpm.aurora}, gridline {fact:launch-film.look_bpm.gridline}, pop {fact:launch-film.look_bpm.pop} and journal {fact:launch-film.look_bpm.journal} BPM. Nothing here changes it. With the drop on the logo close, a track at that tempo, or half or double it, lands every cut on a beat; at any other tempo, a near one too, some cuts fall between beats. So before a plan, read the track and tell the user which look matches its tempo, if one does, since the look also sets the film's style (`launch_film_guide` with topic looks). Give `plan_launch_film` that `look` once they agree.
<!-- with check_video -->
For a film already made, say which cuts `check_video` found off the beat.
<!-- end -->
<!-- end -->

## Every parameter

`fit_music` also takes:
- `voice`, a recording on the video's timeline from its first frame, which the user brings. The music dips by `duck` dB (default {default:fit_music.duck}) wherever it speaks; `mix.wav` is the voice over the ducked music at `lufs`, and `fitted.wav` the ducked music alone.
- `lufs` (default {default:fit_music.lufs}), set with one gain. A limiter keeps the true peak at {fact:musicfit.true_peak} dBTP or under, so a peaky track can come out quieter, as `FIT.md` says.
- `end`: auto ends on the track's own last hit when it has one and there is room after the hit, else with a fade; natural or fade asks for one. `fade` is in seconds, rounded to whole beats, a bar by default.
- `bpm` and `meter` ("3" or "4"), to correct a tempo or a bar that `FIT.md` warns about.
- `length` from {fact:musicfit.length_min} to {fact:musicfit.length_max} seconds, and `hit` at least {fact:musicfit.hit_tail} s before its end, one a run. Without `hit` the track starts as it starts.
<!-- local -->
- `out_dir`, by default musicfit-<track's name> in {base_dir} for both tools.
<!-- end -->
- `wait_seconds`: both tools finish in seconds.

`analyze_music` takes `track`, `bpm` and `meter` the same way. It has no `fps`: its frames count at {fact:musicfit.analyze_fps} a second, so use its times in seconds.

## What it writes

<!-- local -->
Before it writes, each run deletes the five files below from its folder and leaves the rest, so `analyze_music` after a fit in the same folder deletes the fit. Give the analysis and each fit its own `out_dir`.
<!-- end -->
<!-- hosted -->
Each job has a folder of its own and lists links to its files. Pass a file on as job:<job_id>/<path>, like job:<job_id>/cues.json.
<!-- end -->
`fit_music` writes `fitted.wav`, the track at `length`, {fact:musicfit.sample_rate} Hz {fact:musicfit.channels}, at `lufs`; `mix.wav` with a `voice`; `seams.png`, the track, the result and each seam; `FIT.md`, which comes back in the result; and `cues.json`, with `beats`, `bars` and `hits` (the drop and the track's last hit) as frames at `fps` and in seconds under `times`. That of `analyze_music` lists the drop candidates under `source.dropCandidates`.

## When something goes wrong

A failed `fit_music` or `analyze_music` job gives its reason:
- "hit has to fall inside length" or "hit has to leave at least half a second after it": an earlier `hit`.
- "<length, hit or drop> takes a time such as 32, 32.5s, 960f or 1:05": one of those forms.
- "No drop found to land on hit": give `drop`, or leave `hit` out.
- "No way to fit this track to that length": try without `hit`, or with another `end`.
- "The track is silent", "The track has no whole bar of music" or "<file> has no audio stream": ask the user for another file.
<!-- local -->
- "<param>: there is nothing at <path>": a relative path is read from {base_dir}.
- "musicfit needs ffmpeg": the troubleshooting topic.
<!-- end -->

Warnings come with a done job, in `FIT.md` too:
- "The tempo could also be <N> BPM": when the seams sound like they skip, fit again with `bpm` set to it.
- "The bars may have three beats" or "The bars have three beats": when the cuts sound off, fit again with `meter`.
- "No steady beat found" or "The beat is weak": the parts join with one-second crossfades, so listen to every seam.
- "Only <N> s of the track comes before its drop": an earlier `hit`, or a later `drop`.
- "The voice runs <N> s past the end" or "No speech was found in the voice track": check the voice with the user.
- `FIT.md` says "no clear drop was found", or names the wrong drop: give `drop` a candidate `analyze_music` listed.

## Hand over

<!-- local -->
- The video with the track under it when you made one, or the video and the track to lay in, with their paths.
<!-- end -->
<!-- hosted -->
- The links to the video and to the track to lay in.
<!-- end -->
- From `FIT.md`: the length and level, the tempo, where the drop landed, and the moments to listen at.
<!-- with check_video -->
- What `check_video` measured: cuts on the beat, loudness, true peak.
<!-- end -->
- That nothing here checked whether the track may be used.
<!-- hosted -->
- That the links work for {limit:keep_days}, for anyone who has them.
<!-- end -->
