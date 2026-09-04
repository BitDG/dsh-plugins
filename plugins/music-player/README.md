# @dship/music-player

An isolated MusicFree-compatible music companion for DeepSeek Harness. The package implements the minimal `platform`, `version`, `userVariables`, `search`, and `getMediaSource` protocol, exposes a public `sidebar.music` slot, and keeps generated source plugins behind review plus explicit installation.

Included sources:

Audiomack is the default source because its public search and same-origin proxied playback path is exercised by the release acceptance flow.

- Bilibili: treats the query as an UP creator name, selects the exact (or first ranked) creator result, and lists that creator's public submissions newest-to-oldest. Playback stays server-side so the required Referer is never exposed to arbitrary generated plugins.
- YouTube Music: public song search and stream resolution through the maintained MIT-licensed `youtubei.js` connector.
- Audiomack: public song search and expiring public stream resolution through Audiomack's web API.
- Maoer FM: searches free dramas and flattens their free episodes into playable results; paid drama rows are excluded.
- Udio: public community-song search and playback through the song URLs returned by Udio.
- Suno: the current public Explore feed, with local filtering by title, creator, prompt, and tags. Private and explicit rows are excluded, and playback prefers the progressive media URL used by the current web client.
- NetEase Cloud Music: search and playback restricted to rows reported as free. VIP tracks, trial URLs, and unavailable tracks are rejected.
- Ximalaya: public track search and anonymous playback through the current free-track quality endpoint. Paid, trailer, sample, and unavailable rows are rejected.
- SomaFM: commercial-free, listener-supported online radio through its public channel catalog and permanent stream URLs.
- Radio Browser: searchable public internet-radio stations from the free and open Radio Browser directory.
- White Noise: a curated Radio Browser view combining white-noise, sleep, meditation, and nature-sound stations.

The audio element remains mounted when the user switches back to tasks, RSS, settings, or another workspace view. Hiding the music surface therefore does not interrupt an already playing track; reopening Music restores the same track and native player state.

The source picker is a compact native dropdown. Search results preserve each platform's original response order while retaining `publishedAt` when the upstream exposes it. When a finite track ends, playback advances through the exact result list from which that track was selected.

The connectors do not log in, bypass paywalls or DRM, extract restricted content, or provide a download workflow. Availability remains subject to each upstream service and the user's region.

The NetEase protocol shape was checked against the actively maintained `go-musicfox/go-musicfox` client and its API package. Ximalaya's current endpoint behavior was checked against `sld272/Ximalaya-Downloader-Next` and then re-observed in the live public web player. Those projects are reference evidence only: this package contains an independent TypeScript implementation and does not copy their GPL/AGPL source.

## Safety boundary

Source plugins run in a short-lived child Node process with the permission model enabled, no exposed Node globals or module loader, exact network host allowlists, DNS private-address rejection, response-size limits, and a parent-enforced deadline. This is defense in depth for a bounded PoC, not a general-purpose hostile-code sandbox.

Trusted built-in connectors are deliberately separate from generated plugins. Their expiring same-origin media tickets proxy only approved public CDN host patterns, validate public DNS on every redirect, preserve byte ranges for seeking, forward only connector-owned headers, and require the normal Harness browser authentication before streaming.

YouTube.js requires evaluation of its reduced decipher script. The connector runs that script in a short-lived Node child with no network permission, no filesystem permission beyond loading the evaluator entrypoint, a minimal environment, a 64 MB heap ceiling, an output cap, and a parent-enforced deadline. It is never evaluated in the Harness host process.
