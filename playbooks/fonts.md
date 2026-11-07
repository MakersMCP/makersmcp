---
name: fonts
title: The fonts of a website
index: make_font_kit: the fonts a page draws with, their files and licenses, the closest free fonts
description: Finds the fonts one page of a website really draws its headings, body text, buttons and code with, using easyfontkit, saves every font file the page loads, says how each one is licensed and names the closest free font for each one that is not free. Use it when the user asks what font a site uses or whether it is free, wants to match a site's type, or needs the font files for a page, a video or an image.
kit: easyfontkit
requires: [easyfontkit]
optional: [easybrandkit]
order: 40
---
# The fonts of a website

`make_font_kit` opens one page in Chrome, asks Chrome which fonts really drew its headings, body text, buttons and code, saves every font file the page loads, reads each file's own license fields and names the closest free font for each one that is not free. One call makes the kit. Then read `FONTS.md`, check that it read the right page, and tell the user each font with its license. The kit states the licenses, and the user decides what to use.

## Decide first

- The page, as `url`. Only that page is read, and fonts can differ between a home page, its docs and its app, so give the page whose look the user needs, like https://linear.app/docs. A font used only on another page needs a run on that page. When the user names no page, start with the home page.
- `files` false reads the font files without saving them. By default every file is saved, whatever its license.
<!-- with easybrandkit -->
- For logos and colors, use `make_brand_kit` (the brand topic). It names the heading and body fonts, but saves no font file and reads no license.
<!-- end -->
<!-- hosted -->
- The page has to be public: the server cannot open an address on the user's own computer or network.
<!-- end -->

## Steps

1. Make the kit. It takes {fact:easyfontkit.run_seconds} seconds and usually comes back within the default `wait_seconds`. When a `job_id` comes back instead, call `wait_for_job` with it, never `make_font_kit` again: that starts a second job.

```call
make_font_kit {"url": "https://linear.app"}
```

<!-- local -->
```call
make_font_kit {"url": "https://linear.app/docs", "out_dir": "fonts/docs"}
```
<!-- end -->

2. Read `FONTS.md` in the result. The line under its heading names the address read: the one asked, even when that page answered with an error, which the kit does not say, or the one a redirect led to, like a login page. An error page, a login page or a cookie wall gives its own fonts, often a system font like Times New Roman, and the kit reports them as the site's: when every role is a system font, check that the page opens before you hand the fonts over.
3. Tell the user each role's font, its weights and its license, with the closest free font beside each commercial or unknown one. The kit holds every font's files whatever its license, and the user decides which to use.

## Every parameter

- `url`: the page, like https://linear.app/pricing.
- `files`: {default:make_font_kit.files} by default, which saves every font file in files/. With false, `fonts.css` loads none of the site's own files, and the result notes "Run with files false: the font files were read but not saved."
- `timeout_seconds`: {default:make_font_kit.timeout_seconds} by default. When a role shows a system font where the site's own was expected, its fonts may load late: run again with {fact:easyfontkit.late_timeout}.
<!-- local -->
- `out_dir`: the folder, absolute or relative to {base_dir}. The default is named after the host without www or the port, like easyfontkit-linear.app, so all pages of one site share it: give each page its own.
<!-- end -->
- `wait_seconds`: how long one call waits before it returns a `job_id` (the jobs-and-files topic).

## What it writes

- `FONTS.md`, also in the result: a table of the roles (headings, body text, buttons, code) with each one's font, weights, license and closest free font; then a section for each family with what it is used for, where it was served from, its maker, designer and copyright when the file names them, its license in the file's own words, its saved files, and up to {fact:easyfontkit.free_matches} closest free fonts with why each was chosen. Fonts the page loads but draws none of these roles with, like icon fonts, come after them.
- `fonts.css`: an @font-face rule for each saved file, and a variable for each role, `--font-heading`, `--font-body`, `--font-button` and `--font-code`, with -free twins like `--font-heading-free` for the closest free fonts. A free font that is not the site's own loads from Google Fonts or Fontsource. Keep `fonts.css` next to the files/ folder.
- `fonts.json`: the same for tools.
- files/: every font file the page loaded, as the browser received it, like `files/lato-400.ttf` or `files/fraunces-variable.woff2`.

## What the licenses mean

- Open: usable under its license anywhere, like the SIL Open Font License, the Apache License or the Ubuntu Font Licence. A font from Google Fonts, Fontsource or Bunny Fonts counts as open.
- Commercial: its maker sells it, its file restricts it, or a paid service like Adobe Fonts or Monotype Fonts serves it under the site's own subscription. The site's license covers that site, not other work. Name the maker when `FONTS.md` does.
- Unknown: neither the file nor where it came from says.
- System font: the visitor's own font, sent with no file, so each computer may draw it with another one.

The closest free font is a hand-picked lookalike of a known paid font, or the free font closest in x-height, cap height and lowercase width, and `FONTS.md` says which. It keeps line lengths and spacing close, yet it is another design: call it the nearest free font, never the same one.

## When something goes wrong

Each error as the result shows it, then the fix.

<!-- local -->
- "No Chrome, Chromium, Edge or Brave found. Install one, or point CHROME_PATH at its binary.": ask the user to install Chrome, or to set CHROME_PATH in this server's entry in the MCP client's settings and start the client again.
<!-- end -->
- "<url> answered with a bot check ("<title>") instead of its page, so no kit was made. Open the site in a normal browser and try again later.": ask the user for the font names, or try again later.
- "<url> showed no text and loaded no fonts, so nothing was read. The site may turn away headless browsers; check the page in a normal browser.": check the address with the user.
- "Could not open <url>: <reason>": the address does not answer. Check it with the user.
- "<url> was not a usable font file: <reason>.", a note in a finished result: that file could not be read, so its family has no license from a file. The reason is "not a font file", "too short to be a font", "the server answered <status>" or the like.
- "Some of the <roles> was drawn with <fallback>, a fallback, because <family> loaded too late for it. That text is counted as <family>, the font the site asks for.": a note, nothing to fix.
- A page that answers with an error still comes back done, with the error page's fonts and no word about it, and `FONTS.md` names the address asked as if it were the page: when every role is a system font like Times New Roman, check that the page opens before you hand the fonts over. A login page shows as the address it led to.
<!-- local -->
- "<folder> is not empty and holds no earlier font kit. Pick another folder with out_dir.": the folder holds other files, and the kit never mixes into them. Give another `out_dir`.
- A run deletes the font kit an earlier run left in its folder before it opens the page, so a failed run, or a run on an error page, loses a good kit too; only a refused address or folder leaves it. Run the good page again to bring its kit back.
<!-- end -->

## Hand over

Tell the user which page was read, each role's font with its weights and its license, the closest free font beside each commercial or unknown one, and where the files are: the folder, or the links. Let them decide which fonts to use.
<!-- hosted -->
The links work for {limit:keep_days} for anyone who has them, so give them only to the user.
<!-- end -->
