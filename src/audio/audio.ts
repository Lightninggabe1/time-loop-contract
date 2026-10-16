// WebAudio sound: the band on the stage (public-domain 1919–1925 recordings),
// a synthesised crowd murmur, and CC0 Kenney effects. Rooms away from the
// ballroom hear the band muffled through the walls.
const BASE = "./assets/audio/";
const TRACKS = ["music_charleston", "music_roseroom"];
const SONG = "music_sheba";

export type Sfx =
  | "punch" | "punch2" | "glass" | "glass2" | "bell" | "metal"
  | "noted" | "seen" | "switch" | "clink" | "open" | "close" | "click" | "fanfare";
const SFX_FILE: Record<Sfx, string> = {
  punch: "sfx_impactPunch_heavy_000", punch2: "sfx_impactPunch_heavy_002", glass: "sfx_impactGlass_heavy_000", glass2: "sfx_impactGlass_heavy_002",
  bell: "sfx_impactBell_heavy_001", metal: "sfx_impactMetal_heavy_000", noted: "ui_confirmation_002", seen: "ui_error_004", switch: "ui_switch_003",
  clink: "ui_glass_002", open: "ui_open_002", close: "ui_close_002", click: "ui_click_002", fanfare: "ui_maximize_003",
};

export class Audio {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private music: { src: AudioBufferSourceNode; name: string } | null = null;
  private musicGain!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private crowdGain!: GainNode;
  private master!: GainNode;
  private trackIndex = 0;
  private wantMusic: "band" | "song" | "none" = "band";
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem("tlc.muted") === "1";
    } catch {
      /* ignore */
    }
    const unlock = () => {
      this.start();
      removeEventListener("pointerdown", unlock);
      removeEventListener("keydown", unlock);
      removeEventListener("touchstart", unlock);
    };
    addEventListener("pointerdown", unlock);
    addEventListener("keydown", unlock);
    addEventListener("touchstart", unlock);
  }

  private async start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = "lowpass";
    this.musicFilter.frequency.value = 16000;
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicFilter.connect(this.musicGain).connect(this.master);
    this.crowd();
    // decode effects and the first track in the background
    Object.values(SFX_FILE).forEach((f) => this.load(f));
    await this.load(TRACKS[0]);
    this.updateMusic();
    TRACKS.slice(1).concat(SONG).forEach((f) => this.load(f));
  }

  private async load(name: string) {
    if (this.buffers.has(name) || !this.ctx) return this.buffers.get(name);
    try {
      const data = await (await fetch(`${BASE}${name}.m4a`)).arrayBuffer();
      const buf = await this.ctx.decodeAudioData(data);
      this.buffers.set(name, buf);
      return buf;
    } catch (e) {
      console.warn("audio load failed", name, e);
      return undefined;
    }
  }

  /** Synthesised party murmur: band-passed noise with slow swells + random clinks. */
  private crowd() {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; // pink-ish
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 520;
    bp.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.25;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.35;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
    lfo.start();
    const clink = () => {
      if (this.ctx && this.crowdGain.gain.value > 0.15 && Math.random() < 0.6) this.play("clink", 0.06 + Math.random() * 0.06, 0.8 + Math.random() * 0.5);
      setTimeout(clink, 2500 + Math.random() * 6000);
    };
    setTimeout(clink, 3000);
  }

  play(s: Sfx, volume = 0.6, rate = 1) {
    const ctx = this.ctx;
    const buf = this.buffers.get(SFX_FILE[s]);
    if (!ctx || !buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  /** Midnight: twelve strikes. */
  midnight() {
    for (let i = 0; i < 12; i++) setTimeout(() => this.play("bell", 0.5, 0.82), i * 650);
  }

  setMusic(mode: "band" | "song" | "none") {
    if (mode === this.wantMusic) return;
    this.wantMusic = mode;
    this.updateMusic();
  }

  private updateMusic() {
    const ctx = this.ctx;
    if (!ctx) return;
    const want = this.wantMusic === "none" ? null : this.wantMusic === "song" ? SONG : TRACKS[this.trackIndex % TRACKS.length];
    if (this.music?.name === want) return;
    if (this.music) {
      this.music.src.onended = null;
      this.music.src.stop();
      this.music = null;
    }
    if (!want) return;
    const buf = this.buffers.get(want);
    if (!buf) {
      this.load(want).then(() => this.updateMusic());
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.musicFilter);
    src.onended = () => {
      this.music = null;
      if (this.wantMusic === "band") this.trackIndex++;
      this.updateMusic();
    };
    src.start();
    this.music = { src, name: want };
  }

  /** Room acoustics: full band in the ballroom, muffled elsewhere; quieter in a blackout. */
  setRoom(room: string | null, distToStage: number, dark: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const inBall = room === "ballroom";
    const cutoff = inBall ? 15000 : room === "balcony" ? 1800 : 650;
    const vol = (inBall ? Math.max(0.28, 0.6 - distToStage * 0.012) : room === "balcony" ? 0.3 : 0.22) * (dark ? 0.0 : 1);
    this.musicFilter.frequency.setTargetAtTime(cutoff, t, 0.25);
    this.musicGain.gain.setTargetAtTime(vol, t, 0.3);
    this.crowdGain.gain.setTargetAtTime(inBall ? 0.38 : room === "balcony" ? 0.12 : 0.1, t, 0.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem("tlc.muted", this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
