# TweetDeckV2

A fork of [OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) that brings back the
classic TweetDeck UI on `x.com/i/tweetdeck`, extended with support for X's
**algorithmic timelines** (the "For You" recommended feed, and eventually topic-based
timelines) as regular columns — not just chronological ones.

> [!NOTE]
> Since Twitter made likes private, the Likes tab aren't loading anymore.
> This can not be fixed since the API to retrieve the likes is gone. Same thing with Activity column.

![Screenshot](https://lune.dimden.dev/9713d947d56.png)

### Other languages

[한국어 README](docs/README_KO.md)
[日本語 README](docs/README_JA.md)

## What's different in this fork

Classic TweetDeck columns are all reverse-chronological: Home, List, Search, User,
Mentions — whatever source you pick, you get every post in order, no ranking. This
fork adds a way to pull in X's own recommendation-ranked feeds as a column too.

- **"For You" (algorithmic) column** — adds the same ranked feed X shows on its native
  "For You" tab as a normal, addable TweetDeck column, with infinite scroll / load-more
  support like any other column.
- **Topic timelines** (in progress) — support for adding curated topic feeds (Sports,
  Anime, News, etc.) as columns, the same way you can browse them in X's native
  "Timelines" panel.

See [FORYOU_FEATURE.md](FORYOU_FEATURE.md) for the technical write-up of how this is
implemented, current status, and what's left to finish the topic timelines feature.

## Installation

Note: Do not delete the extension files (unzipped archive for Chromium, zip file for Firefox) after installation.

### Chromium (Chrome, Edge, Opera, Brave, Etc.)

1. Download or clone this repository
2. Run `npm install` and `npm run build` to generate the packaged extension (or use the unzipped source folder directly)
3. Go to extensions page (`chrome://extensions`)
4. Enable developer mode (there should be a switch somewhere on that page)
5. Press "Load unpacked" button
6. Select the folder with the extension files
7. Go to https://x.com/i/tweetdeck and enjoy old TweetDeck

### Firefox

#### Nightly / Developer Edition

1. Build the Firefox zip with `npm run build`
2. Go to Firefox Configuration Editor (`about:config`)
3. Change the preference `xpinstall.signatures.required` to false
4. Go to addons page (`about:addons`)
5. Press "Install Add-on From File..." button
6. Select the zip file you built
7. Go to https://x.com/i/tweetdeck and enjoy old TweetDeck

#### Stable

**It's not recommended to use this extension on Stable version.**

1. Go to `about:debugging#/runtime/this-firefox`
2. Press "Load Temporary Add-on" and select the zip file you built
3. **Installing this way on Firefox will remove it after closing browser.**

### Safari

NOT SUPPORTED

## Updating

If TweetDeck's files were updated, you should receive updated files automatically without having to reinstall after refreshing tab (unless you set `localStorage.OTDalwaysUseLocalFiles = '1'`).
If extension files were updated, you have to reinstall extension to get new update.

## FAQ

#### Extension stopped working.

Before opening an issue, try to reinstall extension.

#### 'Link another account you own' doesn't work.

See https://github.com/dimdenGD/OldTweetDeck/issues/259#issuecomment-2281786253 for a workaround.

#### Some column isn't loading for me.

You're getting rate limited. They'll come back after some time.

#### Likes tab aren't loading for me.

This can not be fixed. Since Twitter made likes private, the API to retrieve likes is gone.

## Credits

This project builds on [OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) by
[dimdenGD](https://github.com/dimdenGD). All the heavy lifting of re-hosting the
legacy TweetDeck client and bridging its API calls to X's modern GraphQL endpoints
comes from that project — this fork extends it with algorithmic/recommended timeline
support.
