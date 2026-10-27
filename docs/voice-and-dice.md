# Voice chat and real dice

Back to the [README](../README.md).

## Voice chat (optional)

The table can talk over live voice, in the lobby while everyone is still
building characters and at any point during play. The server runs its own SFU
(mediasoup) in-process, so there is no third-party service, no account and no
audio leaving your machine.

Voice is **off by default**: set `VOICE_ENABLED=1` to turn it on. It needs two
more things, and both are easy to miss:

1. **HTTPS.** Browsers block microphone access on plain http, so voice needs a
   reverse proxy with a certificate. `localhost` is exempt, so a single-machine
   install works as-is. (The push-to-talk speech-to-text button has always had
   this requirement too.)
2. **One extra open port, UDP and TCP.** Default `44444`. The audio is not HTTP
   and cannot go through your reverse proxy: open the port on the firewall
   pointing straight at the host. It is a single port, not a range, however
   many tables are running.

```bash
VOICE_ENABLED=1
VOICE_RTC_PORT=44444
# The address a player's BROWSER can reach this host on. Required for Docker
# or any NAT; leave empty only for a localhost-only install.
VOICE_ANNOUNCED_IP=203.0.113.10
# Optional: announce a hostname instead of the raw IP. Wins when set.
VOICE_DOMAIN=voice.example.com
```

Whatever is announced must resolve directly to the host. If your site sits
behind a Cloudflare proxy, point voice at the origin IP, or give `VOICE_DOMAIN`
a DNS-only "grey cloud" record: a proxied hostname resolves to Cloudflare, which
does not carry UDP, and the call will connect and then stay silent. Full
details, including the trade this makes with origin-IP privacy, are in
[docs/configuration.md](configuration.md).

Because the server already knows where every token stands and whose turn it is,
voice can do things a separate call cannot:

- **Turn-taking** rides the floor the table already has (open, hold, spotlight,
  initiative). By default the panel just shows whose turn it is; a table that
  wants it can have players off the floor muted server-side. The GM is never
  muted, and anyone who cannot speak gets a Raise hand button.
- **Proximity**, off by default: distance on the battle map decides who hears
  whom, with whisper (5 ft) / normal / shout (120 ft), walls that muffle rather
  than block, and an option for downed characters to stop hearing the table.
  The GM always hears everyone.
- **Side rooms** the GM can open and move people between, for a private word or
  a split party. Moving somebody is instant, with no gap in their audio.

Each campaign turns voice and each rule on or off in its settings, and a server
owner can disable it entirely with `VOICE_ENABLED=0`. Full details in
[docs/configuration.md](configuration.md).

## Physical and Bluetooth dice

With the campaign's dice policy set to allow real dice, each player can opt in and
then choose, per die shape, where that die's numbers come from:

- **Type it in**: roll your physical die and enter the result; the GM turn parks
  until the table's dice are in.
- **Server roll**: the server rolls that die for you with a cryptographic RNG, so
  a mixed handful (your d20, its damage dice) still submits in one go.
- **Pixels Bluetooth dice**: pair a [Pixels](https://gamewithpixels.com/) die and
  its rolls fill in as they land, with a blink-to-identify button and automatic
  fallback to typing if it disconnects. Web Bluetooth requires a Chromium-based
  browser and HTTPS (localhost is exempt), the same requirement voice has.

When every die in a request is covered by a Pixel or the server, the roll submits
itself as the last die settles. Dice-source choices are stored in the browser they
were made in, per device, and the d100 pairs no single Pixel, so it stays typed or
server-rolled.
