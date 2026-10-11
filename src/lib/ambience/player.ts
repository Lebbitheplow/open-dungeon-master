import { cueById } from "@/lib/ambience/catalog";

// The table's sound, as a machine: two looping layers and a pool of
// one-shots, with every rule about how they fade in, hand over and sit under
// narration in one place that has no idea React exists.
//
// Why a layer is more than one <audio>: a cue may have several takes
// (battle.mp3, battle-2.mp3), and even one take should not hard-cut back to
// its own start. So a layer keeps the playing take and, a second and a half
// before it ends, starts the next one (or the same one again) and crosses
// between them. Changing cue is the same move with a different file, and
// muting, ducking and the sliders only move the target the fades aim at.
//
// Framework-free and element-agnostic: the hook hands in how to make an
// element and how to let it go (the output router wants to know about every
// one), and the tests hand in a fake. Time moves through tick(), which the
// hook drives from a timer and the tests drive by hand.

export type AmbienceLayerName = "bed" | "music";

// The slice of HTMLAudioElement the player touches.
export type AudioLike = {
  src: string;
  loop: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  preload: string;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type PlayerDeps = {
  create: (url: string) => AudioLike;
  release: (audio: AudioLike) => void;
  now: () => number;
};

export type Levels = {
  master: number;
  bed: number;
  music: number;
  muted: boolean;
  // Held down while narration is being read aloud.
  ducked: boolean;
};

export type LayerSnapshot = {
  cueId: string | null;
  // Which take is playing, 1-based, and how many the cue has here.
  take: number;
  takes: number;
  playing: boolean;
};

export type PlayerSnapshot = {
  bed: LayerSnapshot;
  music: LayerSnapshot;
  // The browser refused to start sound; the next unlock tries again.
  blocked: boolean;
};

export const CROSSFADE_MS = 1500;
// How far the room drops while the DM's narration is being read aloud. Not
// silence: the room should still be there behind the voice.
export const DUCK = 0.3;
const STING_POOL = 3;

type Voice = {
  audio: AudioLike;
  url: string;
  // The fade this voice is on: 0..1, with where it is going and when it
  // started, so a slider dragged mid-fade is obeyed on the next tick.
  fade: number;
  fadeFrom: number;
  fadeTo: number;
  fadeStart: number;
  onEnded: () => void;
};

type Layer = {
  name: AmbienceLayerName;
  cueId: string | null;
  urls: string[];
  index: number;
  current: Voice | null;
  // Voices fading out; let go when they reach silence.
  retiring: Voice[];
  // A play() the browser refused, to be retried on unlock.
  blocked: boolean;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class AmbiencePlayer {
  private deps: PlayerDeps;
  private layers: Record<AmbienceLayerName, Layer>;
  private tracks: Record<string, string[]> = {};
  // What the table asked for, kept apart from what is resolved: the scene
  // usually arrives before the library does, and must be tried again then.
  private wanted: Record<AmbienceLayerName, string | null> = { bed: null, music: null };
  private levels: Levels = { master: 0.6, bed: 1, music: 1, muted: false, ducked: false };
  private unlocked = false;
  private stings: AudioLike[] = [];
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    this.layers = {
      bed: { name: "bed", cueId: null, urls: [], index: 0, current: null, retiring: [], blocked: false },
      music: { name: "music", cueId: null, urls: [], index: 0, current: null, retiring: [], blocked: false },
    };
  }

  // ---- what the hook sets ----

  // Which cues this install can play and the takes each has. A cue that
  // loses its files mid-session goes quiet on the next scene call.
  setTracks(tracks: Record<string, string[]>) {
    this.tracks = tracks;
    this.setLayer("bed", this.wanted.bed);
    this.setLayer("music", this.wanted.music);
  }

  // What the table is hearing. A cue with no file here is silence, not an
  // error: the library is installed separately and may be partial.
  setScene(bed: string | null, music: string | null) {
    this.wanted = { bed, music };
    this.setLayer("bed", bed);
    this.setLayer("music", music);
  }

  setLevels(levels: Partial<Levels>) {
    this.levels = { ...this.levels, ...levels };
    this.applyVolumes();
  }

  // The browser refuses audio before a user gesture. Once it has had one,
  // anything that was refused is tried again.
  setUnlocked(unlocked: boolean) {
    if (this.unlocked === unlocked) {
      return;
    }
    this.unlocked = unlocked;
    if (unlocked) {
      for (const layer of Object.values(this.layers)) {
        if (layer.cueId && !layer.current) {
          this.start(layer, layer.index, true);
        } else if (layer.current && layer.blocked) {
          this.play(layer, layer.current);
        }
      }
    } else {
      for (const layer of Object.values(this.layers)) {
        this.stop(layer);
      }
    }
    this.changed();
  }

  // The next take of whatever this layer is playing, now rather than at the
  // end. With one take it simply starts over, crossfaded.
  skip(name: AmbienceLayerName) {
    const layer = this.layers[name];
    if (!layer.cueId || !layer.urls.length) {
      return;
    }
    this.start(layer, (layer.index + 1) % layer.urls.length, true);
    this.changed();
  }

  // A sting plays over whatever is running and is never queued: if two land
  // together the second one is simply the one you hear. A few elements are
  // reused rather than one made per sound, because each stays registered
  // with the output router for as long as it exists.
  sting(cueId: string) {
    const url = this.tracks[cueId]?.[0];
    if (!url || !this.unlocked || this.levels.muted) {
      return;
    }
    let audio = this.stings.find((entry) => entry.paused || entry.ended);
    if (!audio) {
      if (this.stings.length < STING_POOL) {
        audio = this.deps.create(url);
        this.stings.push(audio);
      } else {
        audio = this.stings[0];
        this.stings.push(...this.stings.splice(0, 1));
      }
    }
    audio.src = url;
    audio.volume = clamp(this.levels.master * (cueById(cueId)?.gain ?? 0.7));
    void audio.play().catch(() => {});
  }

  // ---- time ----

  // Advances every fade and hands a take over to the next one as it ends.
  // Called every few dozen milliseconds while the hook is mounted.
  tick() {
    if (this.disposed) {
      return;
    }
    const now = this.deps.now();
    for (const layer of Object.values(this.layers)) {
      const voice = layer.current;
      if (voice) {
        this.advance(voice, now);
        const left = Number.isFinite(voice.audio.duration) ? voice.audio.duration - voice.audio.currentTime : Infinity;
        // Near the end: start the next take under this one. Only once the
        // element reports a duration and is actually running, so a take
        // still buffering is not pushed out by a stale number.
        if (!voice.audio.paused && left <= CROSSFADE_MS / 1000 && voice.audio.currentTime > CROSSFADE_MS / 1000) {
          this.start(layer, (layer.index + 1) % layer.urls.length, false);
        }
      }
      for (const retiring of [...layer.retiring]) {
        this.advance(retiring, now);
        if (retiring.fade <= 0) {
          this.drop(layer, retiring);
        }
      }
    }
  }

  snapshot(): PlayerSnapshot {
    const info = (layer: Layer): LayerSnapshot => ({
      cueId: layer.cueId,
      take: layer.urls.length ? layer.index + 1 : 0,
      takes: layer.urls.length,
      playing: Boolean(layer.current && !layer.current.audio.paused),
    });
    return {
      bed: info(this.layers.bed),
      music: info(this.layers.music),
      blocked: this.layers.bed.blocked || this.layers.music.blocked,
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Stop everything this player started and let the output router forget
  // the elements, so a torn-down session never leaves a loop running behind
  // the lobby.
  dispose() {
    this.disposed = true;
    for (const layer of Object.values(this.layers)) {
      // No fade: there will be no more ticks to finish one.
      if (layer.current) {
        this.retire(layer, layer.current);
      }
      for (const voice of [...layer.retiring]) {
        this.drop(layer, voice);
      }
      layer.cueId = null;
      layer.urls = [];
    }
    for (const audio of this.stings) {
      audio.pause();
      audio.src = "";
      this.deps.release(audio);
    }
    this.stings = [];
    this.listeners.clear();
  }

  // ---- the layers ----

  private setLayer(name: AmbienceLayerName, cueId: string | null) {
    const layer = this.layers[name];
    const urls = cueId ? this.tracks[cueId] ?? [] : [];
    const resolved = urls.length ? cueId : null;
    if (resolved === layer.cueId) {
      return;
    }
    layer.cueId = resolved;
    layer.urls = urls;
    // A fresh cue starts on whichever take comes up, so two tables in the
    // same tavern are not in lockstep and a long session hears them all.
    layer.index = urls.length ? Math.floor(Math.random() * urls.length) : 0;
    if (!resolved) {
      this.stop(layer);
    } else if (this.unlocked) {
      this.start(layer, layer.index, true);
    }
    this.changed();
  }

  // Starts take `index` of the layer's cue, fading it in, and sends the
  // current voice off to fade out. `cut` is a change of cue or a skip; a
  // hand-over at the end of a take is the same thing with a shorter
  // overlap already built in by when it was called.
  private start(layer: Layer, index: number, cut: boolean) {
    if (!layer.cueId || !layer.urls.length) {
      return;
    }
    const url = layer.urls[index % layer.urls.length];
    layer.index = index % layer.urls.length;
    const outgoing = layer.current;
    if (outgoing) {
      this.retire(layer, outgoing);
    }
    const audio = this.deps.create(url);
    audio.loop = false;
    audio.preload = "auto";
    audio.volume = 0;
    const voice: Voice = {
      audio,
      url,
      fade: 0,
      fadeFrom: 0,
      fadeTo: 1,
      fadeStart: this.deps.now(),
      onEnded: () => {
        // The tick missed the tail (a throttled background tab): hand over
        // now, with a cut rather than silence.
        if (layer.current === voice) {
          this.start(layer, (layer.index + 1) % layer.urls.length, true);
          this.changed();
        }
      },
    };
    audio.addEventListener("ended", voice.onEnded);
    layer.current = voice;
    layer.blocked = false;
    if (!cut) {
      // A hand-over at the tail: the outgoing voice is already near its
      // end, and the incoming one fades up over the same stretch.
      voice.fadeStart = this.deps.now();
    }
    this.play(layer, voice);
  }

  private play(layer: Layer, voice: Voice) {
    voice.audio.play().then(
      () => {
        if (layer.current === voice) {
          layer.blocked = false;
          this.changed();
        }
      },
      () => {
        // Autoplay still blocked, or the file went missing. Keep the voice
        // so the next unlock can try again, and say so.
        if (layer.current === voice) {
          layer.blocked = true;
          this.changed();
        }
      },
    );
  }

  private retire(layer: Layer, voice: Voice) {
    voice.audio.removeEventListener("ended", voice.onEnded);
    voice.fadeFrom = voice.fade;
    voice.fadeTo = 0;
    voice.fadeStart = this.deps.now();
    layer.retiring.push(voice);
    layer.current = null;
  }

  private drop(layer: Layer, voice: Voice) {
    layer.retiring = layer.retiring.filter((entry) => entry !== voice);
    voice.audio.pause();
    voice.audio.src = "";
    this.deps.release(voice.audio);
  }

  private stop(layer: Layer) {
    if (layer.current) {
      this.retire(layer, layer.current);
    }
    layer.blocked = false;
  }

  // Moves a voice along its fade and sets the element's volume from it.
  private advance(voice: Voice, now: number) {
    const progress = clamp((now - voice.fadeStart) / CROSSFADE_MS);
    voice.fade = voice.fadeFrom + (voice.fadeTo - voice.fadeFrom) * progress;
    const layer = voice === this.layers.bed.current || this.layers.bed.retiring.includes(voice) ? this.layers.bed : this.layers.music;
    voice.audio.volume = clamp(voice.fade * this.target(layer));
  }

  // What one layer should be playing at, before any fade.
  private target(layer: Layer): number {
    if (this.levels.muted || !layer.cueId) {
      return 0;
    }
    const gain = cueById(layer.cueId)?.gain ?? 0.5;
    return clamp(this.levels.master * this.levels[layer.name] * gain * (this.levels.ducked ? DUCK : 1));
  }

  private applyVolumes() {
    const now = this.deps.now();
    for (const layer of Object.values(this.layers)) {
      if (layer.current) {
        this.advance(layer.current, now);
      }
      for (const voice of layer.retiring) {
        this.advance(voice, now);
      }
    }
  }

  private changed() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
