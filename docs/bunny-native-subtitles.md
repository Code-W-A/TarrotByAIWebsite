# Bunny subtitles in Expo

The mobile detail request opts in with `nativeSubtitles=1`. Legacy detail, lists
and `client=web` do not acquire new fields or call Bunny for subtitles. A playable
Bunny detail can return a relative `video.subtitleHlsSrc`; Expo resolves it against
its API base URL and retains the original `hlsSrc` for one fallback attempt.

## Server configuration

- `BUNNY_STREAM_LIBRARY_ID`: the allowed Stream library, currently `651812`.
- `NEXT_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`: that library's delivery hostname.
- `BUNNY_STREAM_READ_ONLY_KEY`: existing library read-only API key, server only.
- `BUNNY_SUBTITLE_SIGNING_SECRET`: at least 32 random bytes, identical on all
  backend instances. Rotating it invalidates outstanding grants.

No Bunny account key or write key is needed. Do not put either server secret in
Expo, a `NEXT_PUBLIC_` variable, logs or version control.

## Delivery and limits

The existing access and locale decisions run before issuing a two-hour HMAC
grant bound to the app video ID, Bunny source, library and discovered captions.
The new `/api/premium/video-subtitles/[asset]` routes validate that grant without
Firestore reads. Only playlists and small WebVTT files pass through this API;
video/audio variants and media segments are served directly by Bunny.

Metadata, source playlists, timestamp origins and versioned captions are cached
in process memory (500 entries / 32 MiB maximum) for five minutes; concurrent requests share work.
Cold backend instances have separate caches. No new Firestore documents/reads
are introduced by subtitle discovery/delivery. New/removed captions are reflected
on a new detail request after metadata cache expiry; an open playback session
keeps its granted track list until reopened (maximum grant lifetime two hours).

For the current MPEG-TS VOD streams, the bridge maps subtitle time zero to the
earliest first audio/video PES timestamp. Existing WebVTT timestamp maps are
preserved. Discontinuous, encrypted or fragmented-MP4 timelines without a supplied
WebVTT timestamp map are rejected instead of inventing a timestamp offset.
Only HTTPS assets under the configured CDN/source directory are fetched; input
URLs and redirects are not accepted. Requests have timeouts and size limits.

Unavailable metadata does not fail video detail. The mobile client receives
`subtitlesUnavailable`, keeps ordinary playback and displays a short message.
An enhanced-source playback error falls back once to the original HLS URL.
The explicit Reload action permits another enhanced-source attempt.

## Local verification / release

Test real video #679 (`ryfNhsK4gLc09A6puS7r`) using its Romanian source, which has
English captions. The English dubbed source is a different file without captions.
Check visible text, seeking, Off and fullscreen on Android and iOS; a track count
alone is not visual validation. No reupload, repackage, translation or catalog
migration is needed. Existing captions are discovered automatically.

Deploy the configured backend before distributing the Expo JavaScript update.
This change adds no native dependency/plugin; OTA still requires the installed
app's runtime/channel to match. No deployment or OTA publication is part of local
implementation.

### Verification on 2026-10-25

- 28 backend tests passed (grant tampering/expiry, playlist rewriting, access,
  locale source binding, metadata cache/refresh, Unicode and timestamp handling).
- 25 Expo tests passed, including a regression case for iOS tracks without `id`.
- Connected Samsung SM-S948B: visible English captions, initial Off, enable/Off,
  seek to 7:45, fullscreen; stopping the local backend proved direct-video fallback
  and the unavailable-subtitles message without stopping ordinary playback.
- iPhone 18 Pro / iOS 27 simulator, locally built SDK 55 development client:
  visible English text, enable/Off, exact native position 7:45 after chapter seek,
  preserved selection and visible captions in fullscreen. Physical iOS hardware
  was not tested.
- No native source/dependency changes were needed. The local simulator build
  used `IPHONEOS_DEPLOYMENT_TARGET=16.0` only on the build command (old privacy
  bundle deployment targets fail with Xcode 27), plus `SENTRY_DISABLE_AUTO_UPLOAD=true`
  and `SKIP_BUNDLING=1` for the local Debug build. No upload/deployment was made.
- The repository-wide Expo typecheck still reports existing errors outside the
  new subtitle components (including old chapter styling/translation typings).
  Next lint cannot run non-interactively because this checkout has no ESLint config.

Local test services use Next on port 3000 and Metro on 8081. Expo SDK 55's
development virtual environment module merges dotenv files over shell variables,
so the ignored Expo `.env.development.local` sets only
`EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000` for this integration test. The
original `.env.local` API value was restored; production builds do not use the
development-only override. Remove that override to resume development against
the original API. A loopback-only IPv4 → IPv6 relay on 8081 was needed because
Metro's localhost listener bound to `::1`, while the simulator requested `127.0.0.1`.
