import {
  DrumMachine,
  Reverb,
  SplendidGrandPiano,
} from "https://unpkg.com/smplr@0.17.1/dist/index.mjs";
import { generateSong, randomKey } from "./tonal-song-generator.js";

const els = {
  status: document.querySelector("#status"),
  background: document.querySelector("#harmony-bg"),
  keySelect: document.querySelector("#key-select"),
  formSelect: document.querySelector("#form-select"),
  seed: document.querySelector("#seed"),
  generate: document.querySelector("#generate"),
  fileInput: document.querySelector("#file-input"),
  play: document.querySelector("#play"),
  stop: document.querySelector("#stop"),
  bpm: document.querySelector("#bpm"),
  volume: document.querySelector("#volume"),
  reverb: document.querySelector("#reverb"),
  arpVolume: document.querySelector("#arp-volume"),
  drumVolume: document.querySelector("#drum-volume"),
  seek: document.querySelector("#seek"),
  songTitle: document.querySelector("#song-title"),
  clock: document.querySelector("#clock"),
  sections: document.querySelector("#sections"),
  currentSection: document.querySelector("#current-section"),
  currentRoman: document.querySelector("#current-roman"),
  currentChord: document.querySelector("#current-chord"),
  currentNotes: document.querySelector("#current-notes"),
  summary: document.querySelector("#summary"),
  chordGrid: document.querySelector("#chord-grid"),
};

const state = {
  context: null,
  piano: null,
  drums: null,
  drumGroups: new Set(),
  reverb: null,
  song: null,
  noteEvents: [],
  arpEvents: [],
  drumEvents: [],
  harmonyEvents: [],
  chordCells: [],
  isPlaying: false,
  startedAt: 0,
  cursorSeconds: 0,
  nextNoteIndex: 0,
  nextArpIndex: 0,
  nextDrumIndex: 0,
  schedulerTimer: null,
  uiTimer: null,
  visual: null,
};

const LOOKAHEAD_SECONDS = 1.0;
const SCHEDULE_INTERVAL_MS = 80;
const START_DELAY_SECONDS = 0.08;

init();

function init() {
  els.play.disabled = true;
  els.stop.disabled = true;
  els.bpm.value = 92;
  els.generate.addEventListener("click", generateInBrowser);
  els.fileInput.addEventListener("change", loadFile);
  els.play.addEventListener("click", playFromCurrentPosition);
  els.stop.addEventListener("click", () => stopPlayback({ reset: true }));
  els.bpm.addEventListener("change", applyTempo);
  els.volume.addEventListener("input", applyVolume);
  els.arpVolume.addEventListener("input", applyVolume);
  els.drumVolume.addEventListener("input", applyVolume);
  els.reverb.addEventListener("input", applyReverb);
  els.seek.addEventListener("input", seekPreview);
  els.seek.addEventListener("change", seekCommit);
  setupBackground();
  setRandomInitialSongControls();
  generateInBrowser();
}

function setRandomInitialSongControls() {
  const key = randomKey();
  const major = key.endsWith("major");
  els.keySelect.value = key;
  els.bpm.value = String(randomInteger(major ? 90 : 80, major ? 130 : 100));
  els.seed.value = "";
}

function setupBackground() {
  const canvas = els.background;
  const context = canvas.getContext("2d");
  const visual = {
    context,
    width: 0,
    height: 0,
    targetHue: 176,
    hue: 176,
    targetTension: 0.3,
    tension: 0.3,
    lastTime: 0,
  };
  state.visual = visual;

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    visual.width = window.innerWidth;
    visual.height = window.innerHeight;
    canvas.width = Math.floor(visual.width * scale);
    canvas.height = Math.floor(visual.height * scale);
    canvas.style.width = `${visual.width}px`;
    canvas.style.height = `${visual.height}px`;
    context.setTransform(scale, 0, 0, scale, 0, 0);
  };
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(drawBackground);
}

function generateInBrowser() {
  try {
    const seedText = els.seed.value.trim();
    const seed = seedText === "" ? Math.floor(Math.random() * 2_147_483_647) : Number(seedText);
    if (!Number.isInteger(seed)) {
      throw new Error("Seed must be an integer.");
    }
    els.seed.value = String(seed);
    setStatus("Generating");
    const result = generateSong({
      key: els.keySelect.value,
      form: els.formSelect.value,
      seed,
    });
    const song = result.toSmplrJson({
      bpm: Number(els.bpm.value) || 92,
      startMidi: 60,
      includeBass: true,
    });
    loadSong(song);
  } catch (error) {
    setStatus("Generation failed", "error");
    console.error(error);
  }
}

async function loadFile(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    loadSong(JSON.parse(text));
  } catch (error) {
    setStatus("Invalid JSON", "error");
    console.error(error);
  }
}

function loadSong(song) {
  validateSong(song);
  stopPlayback({ reset: true });
  state.song = normalizeSong(song);
  state.noteEvents = buildPianoPlaybackEvents(state.song);
  state.arpEvents = buildArpEvents(state.song);
  state.drumEvents = buildDrumEvents(state.song);
  state.harmonyEvents = [...state.song.harmony].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
  state.cursorSeconds = 0;
  state.nextNoteIndex = 0;
  state.nextArpIndex = 0;
  state.nextDrumIndex = 0;

  els.bpm.value = Math.round(state.song.bpm);
  els.seek.min = 0;
  els.seek.max = state.song.durationSeconds.toFixed(2);
  els.seek.value = 0;
  els.play.disabled = false;
  els.stop.disabled = false;

  renderSong();
  updateNowPlaying(0);
  updateClock(0);
  setStatus("Ready");
}

function validateSong(song) {
  if (!song || song.schema !== "tonal_song_generator.smplr.v1") {
    throw new Error("Expected tonal_song_generator.smplr.v1 JSON.");
  }
  if (!Array.isArray(song.notes) || !Array.isArray(song.harmony)) {
    throw new Error("Song JSON needs notes and harmony arrays.");
  }
}

function normalizeSong(song) {
  const bpm = Number(song.bpm) || 92;
  const beatsPerBar = Number(song.beatsPerBar) || 4;
  const secondsPerBeat = 60 / bpm;
  const notes = song.notes.map((note) => ({
    ...note,
    startTimeSeconds: secondsValue(note.startTimeSeconds, note.startBeat * secondsPerBeat),
    durationSeconds: secondsValue(note.durationSeconds, note.durationBeats * secondsPerBeat),
  }));
  const harmony = song.harmony.map((event) => ({
    ...event,
    startTimeSeconds: secondsValue(event.startTimeSeconds, event.startBeat * secondsPerBeat),
    durationSeconds: secondsValue(event.durationSeconds, event.durationBeats * secondsPerBeat),
    notes: (event.notes || []).map((note) => ({
      ...note,
      startTimeSeconds: secondsValue(note.startTimeSeconds, note.startBeat * secondsPerBeat),
      durationSeconds: secondsValue(note.durationSeconds, note.durationBeats * secondsPerBeat),
    })),
  }));
  const lastNoteEnd = notes.reduce((latest, note) => {
    return Math.max(latest, Number(note.startTimeSeconds) + Number(note.durationSeconds));
  }, 0);
  return {
    ...song,
    notes,
    harmony,
    bpm,
    beatsPerBar,
    durationSeconds: Math.max(lastNoteEnd, (song.barCount || 0) * beatsPerBar * secondsPerBeat),
  };
}

function secondsValue(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds : Number(fallback) || 0;
}

function buildPianoPlaybackEvents(song) {
  const secondsPerBeat = 60 / song.bpm;
  const events = [];
  for (const harmony of song.harmony) {
    const startBeat = Number(harmony.startBeat);
    const endBeat = startBeat + Number(harmony.durationBeats);
    let segmentStartBeat = startBeat;
    while (segmentStartBeat < endBeat - 0.0001) {
      const nextBarBeat = (Math.floor(segmentStartBeat / song.beatsPerBar) + 1) * song.beatsPerBar;
      const segmentEndBeat = Math.min(endBeat, nextBarBeat);
      const durationBeats = segmentEndBeat - segmentStartBeat;
      if (durationBeats > 0.05) {
        const voicing = leftHandVoicing(harmony);
        for (const note of voicing) {
          const human = humanize(`piano:${harmony.barNumber}:${note.voice}:${segmentStartBeat}`, {
            timingSeconds: 0.012,
            velocity: 4,
          });
          events.push({
            id: `piano_bar${harmony.barNumber}_${note.voice}_${segmentStartBeat}`,
            voice: note.voice,
            midi: note.midi,
            note: midiNumberToName(note.midi),
            layer: "piano",
            sourceHarmonyStartBeat: harmony.startBeat,
            startBeat: roundNumber(segmentStartBeat, 4),
            startTimeSeconds: roundNumber(Math.max(0, segmentStartBeat * secondsPerBeat + human.timingSeconds), 4),
            durationBeats: roundNumber(durationBeats, 4),
            durationSeconds: roundNumber(durationBeats * secondsPerBeat, 4),
            velocity: Math.max(1, Math.min(127, note.velocity + human.velocity)),
            normalizedVelocity: roundNumber(Math.max(1, Math.min(127, note.velocity + human.velocity)) / 127, 3),
          });
        }
      }
      segmentStartBeat = segmentEndBeat;
    }
  }
  return events.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

function leftHandVoicing(harmony) {
  const baseVelocity = Math.max(1, Math.min(127, Math.round((Number(harmony.tension) || 0.35) * 18 + 78)));
  const bass = Number(harmony.bassMidi ?? harmony.playedMidis?.[0] ?? 48);
  const upper = harmony.upperVoicingMidis?.length
    ? harmony.upperVoicingMidis
    : (harmony.playedMidis || []).filter((midi) => Number(midi) >= bass + 7);
  const chord = uniqueNumbers(upper.map((midi) => clampMidi(Number(midi), 52, 76)));
  return [
    { voice: "bass_octave", midi: bass, velocity: baseVelocity - 5 },
    { voice: "bass", midi: bass + 12, velocity: baseVelocity },
    ...chord.map((midi, index) => ({
      voice: `left_chord_${index + 1}`,
      midi,
      velocity: baseVelocity - 2,
    })),
  ];
}

function buildArpEvents(song) {
  const secondsPerBeat = 60 / song.bpm;
  const events = [];
  for (const bar of song.bars) {
    const harmony = harmonyAtBeat(song, bar.startBeat + 0.001);
    if (!harmony) {
      continue;
    }
    const sectionType = bar.section.type;
    const tension = Number(bar.tension) || Number(harmony.tension) || 0.35;
    const source = harmony.upperVoicingMidis?.length ? harmony.upperVoicingMidis : harmony.playedMidis;
    const tones = source
      .filter((midi) => Number(midi) >= 48)
      .map((midi) => clampMidi(Number(midi) + 12, 60, 88));
    if (!tones.length) {
      continue;
    }
    const pattern = arpPattern(sectionType, tension);
    pattern.offsets.forEach((offset, index) => {
      if (offset >= song.beatsPerBar) {
        return;
      }
      const direction = Math.floor(index / tones.length) % 2 === 0 ? 1 : -1;
      const toneIndex = direction === 1 ? index % tones.length : tones.length - 1 - (index % tones.length);
      const startBeat = bar.startBeat + offset;
      const human = humanize(`arp:${bar.number}:${index}:${tones[toneIndex]}`, {
        timingSeconds: 0.014,
        velocity: 5,
      });
      const velocity = Math.round((pattern.velocity + tension * 22) * sectionVelocityMultiplier(sectionType));
      events.push({
        layer: "arp",
        midi: tones[toneIndex],
        note: midiNumberToName(tones[toneIndex]),
        startBeat: roundNumber(startBeat, 4),
        startTimeSeconds: roundNumber(Math.max(0, startBeat * secondsPerBeat + human.timingSeconds), 4),
        durationBeats: pattern.durationBeats,
        durationSeconds: roundNumber(pattern.durationBeats * secondsPerBeat, 4),
        velocity: Math.max(1, Math.min(127, velocity + human.velocity)),
        harmonyBarNumber: harmony.barNumber,
      });
    });
  }
  return events.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

function arpPattern(sectionType, tension) {
  if (sectionType === "intro") {
    return { offsets: [0, 1, 2, 3], durationBeats: 0.55, velocity: 45 };
  }
  if (sectionType === "verse") {
    return tension > 0.42
      ? { offsets: [0, 0.75, 1.5, 2.25, 3], durationBeats: 0.38, velocity: 50 }
      : { offsets: [0, 1, 2, 3], durationBeats: 0.48, velocity: 46 };
  }
  if (sectionType === "pre-chorus") {
    return { offsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], durationBeats: 0.32, velocity: 56 };
  }
  if (sectionType === "chorus") {
    return { offsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], durationBeats: 0.36, velocity: 54 };
  }
  if (sectionType === "bridge") {
    return tension > 0.62
      ? { offsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.25, 3.5, 3.75], durationBeats: 0.24, velocity: 58 }
      : { offsets: [0, 0.75, 1.25, 2, 2.75, 3.25], durationBeats: 0.34, velocity: 54 };
  }
  return { offsets: [0, 1.5, 3], durationBeats: 0.55, velocity: 42 };
}

function buildDrumEvents(song) {
  const secondsPerBeat = 60 / song.bpm;
  const events = [];
  for (const bar of song.bars) {
    const sectionType = bar.section.type;
    const tension = Number(bar.tension) || 0.35;
    const pattern = drumPattern(sectionType, tension);
    for (const hit of pattern) {
      const startBeat = bar.startBeat + hit.offset;
      if (hit.offset < song.beatsPerBar) {
        events.push({
          layer: "drums",
          sample: hit.sample,
          startBeat: roundNumber(startBeat, 4),
          startTimeSeconds: roundNumber(
            Math.max(0, startBeat * secondsPerBeat + humanize(`drum:${bar.number}:${hit.sample}:${hit.offset}`, {
              timingSeconds: 0.007,
              velocity: 3,
            }).timingSeconds),
            4,
          ),
          velocity: Math.max(
            1,
            Math.min(
              127,
              Math.round(hit.velocity * (0.85 + tension * 0.35)) +
                humanize(`drumv:${bar.number}:${hit.sample}:${hit.offset}`, {
                  timingSeconds: 0,
                  velocity: 3,
                }).velocity,
            ),
          ),
        });
      }
    }
  }
  return events.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
}

function drumPattern(sectionType, tension) {
  if (sectionType === "intro") {
    return [
      hit("kick", 0, 76),
      hit("closed-hat", 1, 42),
      hit("snare", 2, 58),
      hit("closed-hat", 3, 44),
      ...(tension > 0.24 ? [hit("open-hat", 3.5, 38)] : []),
    ];
  }
  if (sectionType === "verse") {
    return [
      hit("kick", 0, 82),
      hit("closed-hat", 0.5, 36),
      hit("closed-hat", 1, 44),
      hit("kick", 1.5, 58),
      hit("snare", 2, 76),
      hit("closed-hat", 2.5, 38),
      hit("closed-hat", 3, 46),
      ...(tension > 0.38 ? [hit("kick", 3.5, 62)] : []),
    ];
  }
  if (sectionType === "pre-chorus") {
    return [
      hit("kick", 0, 84),
      hit("closed-hat", 0.5, 45),
      hit("snare", 1, 54),
      hit("closed-hat", 1.5, 48),
      hit("kick", 2, 72),
      hit("snare", 2, 82),
      hit("closed-hat", 2.5, 50),
      hit("closed-hat", 3, 50),
      hit("open-hat", 3.5, 58),
    ];
  }
  if (sectionType === "chorus") {
    return [
      hit("kick", 0, 92),
      hit("closed-hat", 0.5, 46),
      hit("snare", 1, 72),
      hit("closed-hat", 1.5, 48),
      hit("kick", 2, 84),
      hit("snare", 2, 88),
      hit("closed-hat", 2.5, 48),
      hit("kick", 3, 64),
      hit("open-hat", 3.5, 62),
    ];
  }
  if (sectionType === "bridge") {
    return [
      hit("kick", 0, 82),
      hit("closed-hat", 0.5, 44),
      hit("snare", 1.5, 72),
      hit("kick", 2, 66),
      hit("closed-hat", 2.5, 46),
      hit("snare", 3, 78),
      ...(tension > 0.58 ? [hit("clap", 3, 48), hit("open-hat", 3.75, 54)] : []),
    ];
  }
  return [
    hit("kick", 0, 74),
    hit("closed-hat", 1, 34),
    hit("snare", 2, 62),
    ...(tension > 0.2 ? [hit("open-hat", 3.5, 36)] : []),
  ];
}

function hit(sample, offset, velocity) {
  return { sample, offset, velocity };
}

function harmonyAtBeat(song, beat) {
  let current = null;
  for (const harmony of song.harmony) {
    if (harmony.startBeat <= beat + 0.0001) {
      current = harmony;
    } else {
      break;
    }
  }
  return current;
}

function midiNumberToName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function roundNumber(value, places) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function clampMidi(midi, min, max) {
  let current = midi;
  while (current < min) {
    current += 12;
  }
  while (current > max) {
    current -= 12;
  }
  return current;
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number))];
}

function humanize(key, { timingSeconds = 0.01, velocity = 4 } = {}) {
  const a = seededUnit(`${key}:time`);
  const b = seededUnit(`${key}:velocity`);
  return {
    timingSeconds: (a * 2 - 1) * timingSeconds,
    velocity: Math.round((b * 2 - 1) * velocity),
  };
}

function seededUnit(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function sectionVelocityMultiplier(sectionType) {
  return {
    intro: 0.82,
    verse: 0.9,
    "pre-chorus": 1.02,
    chorus: 1.05,
    bridge: 1,
    outro: 0.78,
  }[sectionType] ?? 0.92;
}

async function ensureInstrument() {
  if (state.piano && state.drums) {
    return;
  }
  setStatus("Loading instruments");
  state.context = new AudioContext();
  state.reverb = new Reverb(state.context);
  state.piano = new SplendidGrandPiano(state.context, {
    onLoadProgress: ({ loaded, total }) => {
      setStatus(`Piano ${loaded}/${total}`);
    },
  });
  state.drums = new DrumMachine(state.context, {
    instrument: "TR-808",
  });
  state.piano.output?.addEffect("reverb", state.reverb, Number(els.reverb.value));
  applyVolume();
  await Promise.all([state.piano.load, state.drums.load]);
  state.drumGroups = new Set(state.drums.getGroupNames?.() ?? []);
  setStatus("Ready");
}

async function playFromCurrentPosition() {
  if (!state.song || state.isPlaying) {
    return;
  }
  try {
    await ensureInstrument();
    await state.context.resume();
    state.isPlaying = true;
    state.nextNoteIndex = firstNoteIndexAt(state.cursorSeconds);
    state.nextArpIndex = firstArpIndexAt(state.cursorSeconds);
    state.nextDrumIndex = firstDrumIndexAt(state.cursorSeconds);
    state.startedAt = state.context.currentTime - state.cursorSeconds + START_DELAY_SECONDS;
    setStatus("Playing", "playing");
    scheduleOverlappingNotes(state.cursorSeconds);
    schedulerTick();
    state.schedulerTimer = window.setInterval(schedulerTick, SCHEDULE_INTERVAL_MS);
    state.uiTimer = window.setInterval(updatePlaybackUi, 80);
    updatePlaybackUi();
  } catch (error) {
    setStatus("Audio failed", "error");
    console.error(error);
  }
}

function schedulerTick() {
  if (!state.isPlaying || !state.piano || !state.drums || !state.song) {
    return;
  }
  const elapsed = playbackSeconds();
  const scheduleUntil = elapsed + LOOKAHEAD_SECONDS;
  state.nextNoteIndex = scheduleTimedEvents({
    events: state.noteEvents,
    index: state.nextNoteIndex,
    elapsed,
    scheduleUntil,
    play: (note) => {
      state.piano.start({
        note: Number.isFinite(Number(note.midi)) ? Number(note.midi) : note.note,
        velocity: smplrVelocity(note),
        time: state.startedAt + note.startTimeSeconds,
        duration: Math.max(0.08, note.durationSeconds * 0.92),
      });
    },
  });
  state.nextArpIndex = scheduleTimedEvents({
    events: state.arpEvents,
    index: state.nextArpIndex,
    elapsed,
    scheduleUntil,
    play: (note) => {
      state.piano.start({
        note: Number.isFinite(Number(note.midi)) ? Number(note.midi) : note.note,
        velocity: rightHandVelocity(note),
        time: state.startedAt + note.startTimeSeconds,
        duration: Math.max(0.05, note.durationSeconds * 0.86),
      });
    },
  });
  state.nextDrumIndex = scheduleTimedEvents({
    events: state.drumEvents,
    index: state.nextDrumIndex,
    elapsed,
    scheduleUntil,
    play: (drum) => {
      startDrum(drum);
    },
  });
  if (elapsed >= state.song.durationSeconds + 0.2) {
    stopPlayback({ reset: true });
  }
}

function scheduleTimedEvents({ events, index, elapsed, scheduleUntil, play }) {
  let nextIndex = index;
  while (nextIndex < events.length) {
    const event = events[nextIndex];
    if (event.startTimeSeconds > scheduleUntil) {
      break;
    }
    if (event.startTimeSeconds >= elapsed - 0.02) {
      play(event);
    }
    nextIndex += 1;
  }
  return nextIndex;
}

function startDrum(drum) {
  const sample = resolveDrumSample(drum.sample);
  const payload = {
    note: sample,
    velocity: scaledVelocity(drum.velocity, Number(els.drumVolume.value)),
    time: state.startedAt + drum.startTimeSeconds,
  };
  try {
    state.drums.start(payload);
  } catch {
    state.drums.start(sample);
  }
}

function resolveDrumSample(sample) {
  if (state.drumGroups.has(sample)) {
    return sample;
  }
  const aliases = {
    "closed-hat": ["closed-hat", "closed hat", "closed-hihat", "ch", "hihat", "hi-hat", "hat"],
    "open-hat": ["open-hat", "open hat", "open-hihat", "oh", "hihat-open", "hi-hat-open"],
    clap: ["clap", "handclap"],
    snare: ["snare", "sd"],
    kick: ["kick", "bd", "bass-drum"],
  }[sample] ?? [sample];
  return aliases.find((name) => state.drumGroups.has(name)) ?? sample;
}

function scheduleOverlappingNotes(seconds) {
  const now = state.context.currentTime + START_DELAY_SECONDS;
  for (const note of state.noteEvents) {
    const start = note.startTimeSeconds;
    const end = start + note.durationSeconds;
    if (start < seconds - 0.02 && end > seconds + 0.05) {
      state.piano.start({
        note: Number.isFinite(Number(note.midi)) ? Number(note.midi) : note.note,
        velocity: smplrVelocity(note),
        time: now,
        duration: Math.max(0.08, (end - seconds) * 0.94),
      });
    }
  }
}

function smplrVelocity(note) {
  const velocity = Number(note.velocity);
  if (Number.isFinite(velocity)) {
    return Math.max(1, Math.min(127, velocity));
  }
  const normalized = Number(note.normalizedVelocity);
  return Number.isFinite(normalized) ? Math.round(Math.max(0.01, Math.min(1, normalized)) * 127) : 90;
}

function scaledVelocity(velocity, layerVolume, { minimum = 1 } = {}) {
  const base = Math.max(1, Math.min(127, Number(velocity) || 80));
  const volume = Math.max(0, Math.min(127, Number(layerVolume) || 0));
  return Math.max(minimum, Math.min(127, Math.round(base * (volume / 100))));
}

function rightHandVelocity(note) {
  const slider = Math.max(0, Math.min(127, Number(els.arpVolume.value) || 0));
  const base = Math.max(1, Math.min(127, Number(note.velocity) || 72));
  const presenceFloor = 34 * (slider / 127);
  const boosted = base * (0.72 + slider / 127);
  return Math.max(1, Math.min(127, Math.round(presenceFloor + boosted)));
}

function stopPlayback({ reset }) {
  const stoppedAt = playbackSeconds();
  window.clearInterval(state.schedulerTimer);
  window.clearInterval(state.uiTimer);
  state.schedulerTimer = null;
  state.uiTimer = null;
  state.isPlaying = false;
  if (state.piano) {
    state.piano.stop();
  }
  if (state.drums?.stop) {
    state.drums.stop();
  }
  if (reset) {
    state.cursorSeconds = 0;
    state.nextNoteIndex = 0;
    state.nextArpIndex = 0;
    state.nextDrumIndex = 0;
    els.seek.value = 0;
  } else {
    state.cursorSeconds = Math.min(stoppedAt, state.song?.durationSeconds || 0);
  }
  updatePlaybackUi();
  setStatus(state.song ? "Ready" : "Idle");
}

function playbackSeconds() {
  if (!state.context || !state.isPlaying) {
    return state.cursorSeconds;
  }
  return Math.max(0, state.context.currentTime - state.startedAt);
}

function updatePlaybackUi() {
  if (!state.song) {
    return;
  }
  const seconds = Math.min(playbackSeconds(), state.song.durationSeconds);
  els.seek.value = seconds.toFixed(2);
  updateClock(seconds);
  updateNowPlaying(seconds);
}

function seekPreview() {
  const seconds = Number(els.seek.value);
  state.cursorSeconds = seconds;
  updateClock(seconds);
  updateNowPlaying(seconds);
}

function seekCommit() {
  const seconds = Number(els.seek.value);
  const wasPlaying = state.isPlaying;
  stopPlayback({ reset: false });
  state.cursorSeconds = seconds;
  state.nextNoteIndex = firstNoteIndexAt(seconds);
  state.nextArpIndex = firstArpIndexAt(seconds);
  state.nextDrumIndex = firstDrumIndexAt(seconds);
  if (wasPlaying) {
    playFromCurrentPosition();
  } else {
    updateClock(seconds);
    updateNowPlaying(seconds);
  }
}

function applyTempo() {
  if (!state.song) {
    return;
  }
  const nextBpm = Number(els.bpm.value);
  if (!Number.isFinite(nextBpm) || nextBpm <= 0) {
    els.bpm.value = Math.round(state.song.bpm);
    return;
  }
  const oldBpm = state.song.bpm;
  const ratio = oldBpm / nextBpm;
  const wasPlaying = state.isPlaying;
  const seconds = playbackSeconds() * ratio;
  stopPlayback({ reset: false });

  state.song.bpm = nextBpm;
  state.song.durationSeconds *= ratio;
  state.song.notes = state.song.notes.map((note) => ({
    ...note,
    startTimeSeconds: note.startTimeSeconds * ratio,
    durationSeconds: note.durationSeconds * ratio,
  }));
  state.song.harmony = state.song.harmony.map((harmony) => ({
    ...harmony,
    startTimeSeconds: harmony.startTimeSeconds * ratio,
    durationSeconds: harmony.durationSeconds * ratio,
    notes: harmony.notes.map((note) => ({
      ...note,
      startTimeSeconds: note.startTimeSeconds * ratio,
      durationSeconds: note.durationSeconds * ratio,
    })),
  }));
  state.noteEvents = buildPianoPlaybackEvents(state.song);
  state.arpEvents = buildArpEvents(state.song);
  state.drumEvents = buildDrumEvents(state.song);
  state.harmonyEvents = [...state.song.harmony].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  state.cursorSeconds = Math.min(seconds, state.song.durationSeconds);
  els.seek.max = state.song.durationSeconds.toFixed(2);
  renderSong();
  updatePlaybackUi();
  if (wasPlaying) {
    playFromCurrentPosition();
  }
}

function applyVolume() {
  if (state.piano) {
    state.piano.output?.setVolume(Number(els.volume.value));
  }
  if (state.drums) {
    state.drums.output?.setVolume(Number(els.drumVolume.value));
  }
}

function applyReverb() {
  if (state.piano && state.reverb) {
    state.piano.output?.addEffect("reverb", state.reverb, Number(els.reverb.value));
  }
}

function firstNoteIndexAt(seconds) {
  const index = state.noteEvents.findIndex((note) => note.startTimeSeconds >= seconds);
  return index === -1 ? state.noteEvents.length : index;
}

function firstArpIndexAt(seconds) {
  const index = state.arpEvents.findIndex((note) => note.startTimeSeconds >= seconds);
  return index === -1 ? state.arpEvents.length : index;
}

function firstDrumIndexAt(seconds) {
  const index = state.drumEvents.findIndex((drum) => drum.startTimeSeconds >= seconds);
  return index === -1 ? state.drumEvents.length : index;
}

function renderSong() {
  const song = state.song;
  els.songTitle.textContent = `${song.key} - ${song.form} - SplendidGrandPiano left/right + TR-808`;
  els.summary.textContent = `${song.barCount} bars, ${song.harmony.length} chords, ${state.noteEvents.length} piano hits, ${state.arpEvents.length} arp notes, ${state.drumEvents.length} drums`;
  renderSections(song);
  renderChordGrid(song);
}

function renderSections(song) {
  els.sections.innerHTML = "";
  const sectionsByName = [];
  for (const bar of song.bars) {
    const last = sectionsByName.at(-1);
    const name = bar.section.name;
    if (last && last.name === name) {
      last.count += 1;
    } else {
      sectionsByName.push({ name, count: 1 });
    }
  }
  for (const section of sectionsByName) {
    const chip = document.createElement("div");
    chip.className = "section-chip";
    chip.style.flex = `${section.count} 1 0`;
    chip.textContent = section.name;
    els.sections.append(chip);
  }
}

function renderChordGrid(song) {
  els.chordGrid.innerHTML = "";
  state.chordCells = song.harmony.map((event, index) => {
    const cell = document.createElement("button");
    cell.className = "chord-cell";
    cell.type = "button";
    cell.dataset.index = index;
    cell.innerHTML = `
      <div class="bar">Bar ${event.barNumber} - ${event.section}</div>
      <div class="roman">${escapeHtml(event.roman)}</div>
      <div class="chord">${escapeHtml(event.chord)}</div>
      <div class="notes">${escapeHtml(event.playedNotes.join(" "))}</div>
    `;
    cell.addEventListener("click", () => {
      els.seek.value = event.startTimeSeconds.toFixed(2);
      seekCommit();
    });
    els.chordGrid.append(cell);
    return cell;
  });
}

function updateNowPlaying(seconds) {
  const event = currentHarmony(seconds);
  updateBackgroundTarget(event);
  state.chordCells.forEach((cell, index) => {
    cell.classList.toggle("is-active", event && state.harmonyEvents[index] === event);
  });
  if (!event) {
    els.currentSection.textContent = "-";
    els.currentRoman.textContent = "-";
    els.currentChord.textContent = "-";
    els.currentNotes.textContent = "-";
    return;
  }
  els.currentSection.textContent = event.section;
  els.currentRoman.textContent = event.roman;
  els.currentChord.textContent = event.chord;
  els.currentNotes.textContent = event.playedNotes.join(" ");
}

function updateBackgroundTarget(event) {
  if (!state.visual || !event) {
    return;
  }
  const functionHue = {
    T: 174,
    PD: 38,
    D: 332,
  }[event.function] ?? 205;
  const rootShift = (event.playedMidis?.[0] ?? event.barNumber ?? 0) % 12;
  state.visual.targetHue = (functionHue + rootShift * 4) % 360;
  state.visual.targetTension = Math.max(0.08, Math.min(0.95, Number(event.tension) || 0.35));
}

function drawBackground(timestamp = 0) {
  const visual = state.visual;
  if (!visual) {
    return;
  }
  const { context, width, height } = visual;
  visual.lastTime = timestamp;
  visual.hue = lerpAngle(visual.hue, visual.targetHue, 0.035);
  visual.tension += (visual.targetTension - visual.tension) * 0.04;

  context.clearRect(0, 0, width, height);
  const hue = visual.hue;
  const tension = visual.tension;
  const wash = context.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, `hsl(${hue} 36% ${92 - tension * 8}%)`);
  wash.addColorStop(0.5, `hsl(${(hue + 58) % 360} 30% ${96 - tension * 10}%)`);
  wash.addColorStop(1, `hsl(${(hue + 116) % 360} 32% ${90 - tension * 6}%)`);
  context.fillStyle = wash;
  context.fillRect(0, 0, width, height);

  drawRibbon(context, width, height, timestamp * 0.00008, hue, tension, 0.18, 0.22);
  drawRibbon(context, width, height, timestamp * -0.00006 + 2.1, (hue + 70) % 360, tension, 0.32, 0.5);
  drawRibbon(context, width, height, timestamp * 0.00005 + 4.7, (hue + 150) % 360, tension, 0.24, 0.78);

  requestAnimationFrame(drawBackground);
}

function drawRibbon(context, width, height, phase, hue, tension, alpha, yCenterRatio) {
  const amplitude = height * (0.045 + tension * 0.055);
  const thickness = height * (0.06 + tension * 0.05);
  const yCenter = height * yCenterRatio;
  context.beginPath();
  context.moveTo(-40, yCenter);
  for (let x = -40; x <= width + 40; x += 28) {
    const y =
      yCenter +
      Math.sin(x * 0.007 + phase) * amplitude +
      Math.sin(x * 0.0027 - phase * 1.8) * amplitude * 0.7;
    context.lineTo(x, y);
  }
  for (let x = width + 40; x >= -40; x -= 28) {
    const y =
      yCenter +
      thickness +
      Math.sin(x * 0.007 + phase + 0.7) * amplitude +
      Math.sin(x * 0.0027 - phase * 1.8) * amplitude * 0.7;
    context.lineTo(x, y);
  }
  context.closePath();
  context.fillStyle = `hsl(${hue} 62% ${52 + tension * 12}% / ${alpha})`;
  context.fill();
}

function lerpAngle(current, target, amount) {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return (current + delta * amount + 360) % 360;
}

function currentHarmony(seconds) {
  if (!state.harmonyEvents.length) {
    return null;
  }
  let current = null;
  for (const event of state.harmonyEvents) {
    if (event.startTimeSeconds <= seconds + 0.03) {
      current = event;
    } else {
      break;
    }
  }
  return current;
}

function updateClock(seconds) {
  const duration = state.song?.durationSeconds || 0;
  els.clock.textContent = `${formatTime(seconds)} / ${formatTime(duration)}`;
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${minutes}:${wholeSeconds}`;
}

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = "status";
  if (kind === "playing") {
    els.status.classList.add("is-playing");
  }
  if (kind === "error") {
    els.status.classList.add("is-error");
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
