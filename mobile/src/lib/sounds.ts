import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

let ring: AudioPlayer | null = null;
let chime: AudioPlayer | null = null;

/** Incoming-call ringtone, looped until stopped. Plays even in silent mode, like a phone call. */
export function startRingtone() {
  try {
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: "duckOthers" });
    ring ??= createAudioPlayer(require("../../assets/sounds/ringtone.wav"));
    ring.loop = true;
    ring.volume = 1;
    void ring.seekTo(0);
    ring.play();
  } catch {
    // Sound is best-effort; the ringing screen is still shown.
  }
}

export function stopRingtone() {
  try {
    ring?.pause();
  } catch {
    /* ignore */
  }
}

/** Short chime for a new message (respects silent mode). */
export function playChime() {
  try {
    chime ??= createAudioPlayer(require("../../assets/sounds/message.wav"));
    chime.volume = 0.6;
    void chime.seekTo(0);
    chime.play();
  } catch {
    /* ignore */
  }
}
