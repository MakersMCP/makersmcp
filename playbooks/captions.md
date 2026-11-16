---
name: captions
title: Captions on a video
index: caption_video, make_subtitles, list_caption_styles: captions in the brand's fonts, subtitle files, app margins
description: Burns captions into a video with easycaptionkit from words with times the user already has, word by word or line by line, in the product's own fonts and colors and clear of each app's buttons, writes the SRT, VTT and ASS files to go with it, and lists the styles and every place's margins. Says where the words come from, what to look at before the video goes out and what to hand over. Use it when a video needs captions or subtitles, or the user asks for a video to read with the sound off.
kit: easycaptionkit
requires: [easycaptionkit]
optional: [easybrandkit, easyfontkit, easyscreenshotkit, reframekit, check_video, make_launch_film, plan_launch_film]
order: 74
---
# Captions on a video

`caption_video` burns captions into a video: Chrome draws them in the site's own fonts, and ffmpeg lays them over the video in one encode, its sound copied. They sit inside the space every place named leaves free of its buttons. `make_subtitles` writes the subtitle files alone and changes no video. `list_caption_styles` lists the styles and each place's margins.

## Decide first

- The words with their times. Nothing here listens to a video or transcribes speech, so the user brings one of these:
  - a speech-to-text JSON with word or line times: OpenAI's verbose_json, whisper.cpp, WhisperX, faster-whisper, ElevenLabs, Deepgram, AssemblyAI, NeMo, Parakeet, transformers' chunks, AWS Transcribe or Google Speech-to-Text;
  - an SRT or WebVTT file, like the captions a voice-over tool writes from its script, whose lines are spread over their words by length;
<!-- with easyscreenshotkit -->
  - the steps.json of a demo from `record_demo_video`, whose step notes become the captions, each shown while its step plays;
<!-- end -->
  - a plain JSON list of entries with `text`, `start` and `end`, or the words.json of an earlier run.
  An ASS file is no words file. Without words, say so and ask for a file; never write times by guess.
- The places, as `for`: tiktok, reels, shorts, youtube, x, linkedin or square. One file is safe on every place named. Left out, the places come from the video's shape.
<!-- hosted -->
- The video's size here: at most 2560x1440 pixels (or 1440x2560), in 4:2:0 at 8 or 10 bits, as phones and cameras record it. A larger one, or a ProRes or 4:4:4 master, fails before its kit starts: ask the user for an H.264 or HEVC copy of that size first.
<!-- end -->
- The look: `style` karaoke lights each word as it is spoken in a whole caption (default), line shows whole captions in one color, for YouTube, LinkedIn and longer watching, and word one word at a time, bigger, for short quick clips.
<!-- with easyfontkit -->
- The fonts: the font kit of `make_font_kit` for the same site, given to `caption_video` as `fonts`, draws the captions with the site's own font files.
<!-- end -->
<!-- with easybrandkit -->
- The color: the brand kit of `make_brand_kit`, given to `caption_video` as `brand`, lights the spoken word in its button, link or logo color.
<!-- end -->
<!-- with reframekit -->
- A video going to several places in other shapes: reframe it first with `reframe_video` (the reframe topic), then caption one file of each shape with its places in `for`, the 9:16 one with tiktok, reels and shorts together, whose margins `check_place_limits` holds every 9:16 place to.
<!-- end -->

## Steps

<!-- local -->
1. Caption the video:
```call
caption_video {"video": "launch/demo/demo.mp4", "words": "launch/demo/steps.json", "for": ["tiktok", "reels", "shorts"], "fonts": "launch/fonts", "brand": "launch/brand"}
```
   It saves in easycaptionkit-<video's name> next to the video unless given an `out_dir`, and keeps the earlier files there until a run ends well.
<!-- end -->
<!-- hosted -->
1. Caption the video, with the words as a link or a file an earlier job saved:
```call
caption_video {"video": "job:<job_id>/demo.mp4", "words": "job:<job_id>/steps.json", "for": ["tiktok", "reels", "shorts"], "fonts": "job:<job_id>/fonts.css", "brand": "job:<job_id>/brand.json"}
```
<!-- end -->
2. Read CAPTIONS.md in the result: which font drew the letters and how many fell back to another font, letters drawn as boxes since no font has them, where the captions sit and why, captions that read faster than people read, and the font's license as its font kit gives it.
<!-- local -->
3. Look at sheet.png, frames of captioned.mp4 for up to 24 captions: no caption may cover text or a face in the picture. Show safe-zones.png to the user, a frame under each app's buttons. When you cannot open a picture, give the user its path with what to look for.
<!-- end -->
<!-- hosted -->
3. Give the user the links to sheet.png, frames of captioned.mp4 for up to 24 captions, and safe-zones.png, a frame under each app's buttons, with what to look for: no caption over text or a face in the picture. Nothing here shows you a picture.
<!-- end -->
4. When one covers something, caption again with `position` middle or top. A long word that is drawn smaller needs a lower `max_chars` or `size`.
<!-- local -->
5. To fix a misheard word, edit its text in the words.json of the result's folder and caption again with that words.json as `words`, the same video and the same folder. From then on, a run into that folder from the first words file is refused, so the fix is never lost.
<!-- end -->
<!-- hosted -->
5. A words.json cannot be changed here: for a misheard word, ask the user for a corrected words file by link.
<!-- end -->
<!-- with reframekit -->
6. For a place's limits, check captioned.mp4 with `check_place_limits`, giving its captions.ass as `captions`: that checks the captions' timing and each 9:16 place's safe area.
<!-- end -->
<!-- with check_video -->
7. `check_video` measures the result's size, frame rate, length and sound. For a launch film, the result has captioned.timeline.json beside captioned.mp4, so the check finds the film's cuts.
<!-- end -->

## Subtitle files

`make_subtitles` writes captions.srt and captions.vtt, for a place or a player that takes a captions file, like YouTube or LinkedIn, and captions.ass with the font, the colors and the place, from the words alone. `video` gives it the frame and the length; without it, captions.ass is laid out for a phone when `for` names tiktok, reels or shorts, a square for square alone, and 16:9 for the rest.
<!-- local -->
```call
make_subtitles {"words": "talk/transcript.json", "video": "talk/talk.mp4", "for": ["youtube"]}
```
   It saves in easycaptionkit-subtitles-<words file's name> next to the words file.
<!-- end -->
<!-- hosted -->
```call
make_subtitles {"words": "https://example.com/transcript.json", "video": "https://example.com/talk.mp4", "for": ["youtube"]}
```
<!-- end -->
captions.srt and captions.vtt take lines of up to {default:make_subtitles.max_chars} characters unless `max_chars` gives another number, and captions.ass cuts its lines to what fits across its frame, so it can have more captions than they do.

## Styles and margins

`list_caption_styles` reads nothing and runs no browser: it gives the styles, the options and every place's margins in pixels, each with its source and the day it was read.
```call
list_caption_styles {}
```
Only ads have published margins, and apps move their buttons, so tell the user to check one post on a phone before posting many.

## Every parameter

`caption_video` and `make_subtitles` take:
- `words`, the file of words and times, and `for`, `style` and `position` as above.
- `fonts`, a font kit, `font`, a font family like Inter, and `brand`, a brand kit, whose heading font is asked for by name when neither is given.
- `highlight`: the spoken word's color, like #ffd23f, in the karaoke and word styles. A dark one lights the word on a patch of it.
- `lines` ({bounds:caption_video.lines}, {default:caption_video.lines} by default; the word style shows one), `max_chars` ({bounds:caption_video.max_chars}) and `size`, the letters in percent of a phone's width or the frame's short side ({bounds:caption_video.size}, {default:caption_video.size} by default).
- `box`: a dark box behind the words instead of an outline.
- `video`: for `caption_video` the video to caption, and for `make_subtitles` the video read for its size and length.
<!-- local -->
- `libass`, for `caption_video`: ffmpeg's libass draws the captions where Chrome cannot start, as in a container without its sandbox; it needs an ffmpeg built with libass and draws no color emoji.
- `out_dir`: easycaptionkit-<video's name> next to the video for `caption_video`. A run replaces the files an earlier run wrote there and leaves anything else.
<!-- end -->
<!-- local -->
- `wait_seconds`: a one minute video takes about half a minute; a long one several minutes.
<!-- end -->
<!-- hosted -->
- `wait_seconds`: a job here has a share of one machine, and a minute of 1920x1080 video takes from about 3 minutes, as easy footage does, to about 7 with grain, more for a larger video. A job stops after {limit:job_minutes}. A video that could not be captioned in the time its job has left even as easy footage fails before its kit starts, with the length that fits. Footage with grain or noise, as from a phone camera, takes two to three times as long, so it can pass that check and still be stopped when the time runs out, with no files kept: for a video of more than a few minutes, offer a shorter cut first, or a run on the user's own machine.
<!-- end -->

## What it writes

`caption_video` writes captioned.mp4, every frame of the video at its own time, or at a steady rate where it has too few frames for the captions, with its sound copied; captions.srt, captions.vtt and captions.ass; words.json, the words as read; captions.json, every caption with its time; sheet.png; safe-zones.png; and CAPTIONS.md, which comes back in the result.
<!-- with make_launch_film, plan_launch_film -->
For a launch film, it copies the film's timeline beside the result as captioned.timeline.json.
<!-- end -->
`make_subtitles` writes the three subtitle files, words.json, captions.json and CAPTIONS.md.

## When something goes wrong

A failed job gives its reason, and the folder is as it was:
- "Every word starts after the video ends": the words are another video's, or their times are in milliseconds. Ask for the right file.
<!-- local -->
- "holds words fixed by hand": the folder's words.json has fixes this run would lose. Give that words.json as `words`, or caption into another folder.
- "Pick another out_dir" at the end of a refusal: the folder holds a file of one of the kit's names that it did not write, or changed since; give another folder.
<!-- end -->
<!-- hosted -->
- "<param> is <size>: caption_video here takes a video of at most 2560x1440 pixels (or 1440x2560)" or "<tool> here takes a picture in 4:2:0 of 8 or 10 bits alone": ask the user for a smaller copy in H.264 or HEVC.
- "<param> runs <time> at <size>, and caption_video here burns captions into about <time> of a video that size": even easy footage could not be captioned in the time the job had left, so give a cut of at most that length.
- "It ran longer than <time> and was stopped.": the footage took longer than easy footage, as grain does; give a shorter cut.
<!-- end -->
- CAPTIONS.md says the brand font was asked for by name and this machine does not have it: give `fonts`, a font kit.
- CAPTIONS.md says some letters show as boxes: no font drew them. Never hand over a video with boxes in its captions; ask the user for a font kit whose font has those letters.
<!-- local -->
- "easycaptionkit needs Chrome", "easycaptionkit needs ffmpeg" or "easycaptionkit needs ffprobe": the troubleshooting topic. With no Chrome that starts, `libass` draws the captions without it.
<!-- end -->

## Hand over

<!-- local -->
- captioned.mp4 with its path, and captions.srt or captions.vtt for places that take a captions file.
<!-- end -->
<!-- hosted -->
- The links to captioned.mp4, and to captions.srt or captions.vtt for places that take a captions file.
<!-- end -->
- Which font drew the captions and its license as CAPTIONS.md gives it, with the closest free font when it is not open.
- Whether sheet.png and safe-zones.png were looked at, and that the margins are the apps' ad guides or estimates.
- That the captions say what the words file says, word for word: nothing here checked them against the speech.
