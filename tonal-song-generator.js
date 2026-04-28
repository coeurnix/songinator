const HarmonicFunction = Object.freeze({
  TONIC: "T",
  PREDOMINANT: "PD",
  DOMINANT: "D",
});

const CadenceGoal = Object.freeze({
  AUTHENTIC: "authentic",
  HALF: "half",
  DECEPTIVE: "deceptive",
  PLAGAL: "plagal",
  WEAK_OPEN: "weak/open",
});

const DEFAULT_KEYS = Object.freeze([
  "C major",
  "G major",
  "D major",
  "A major",
  "E major",
  "F major",
  "Bb major",
  "Eb major",
  "A minor",
  "E minor",
  "B minor",
  "F# minor",
  "D minor",
  "G minor",
  "C minor",
]);

const NOTE_TO_PC = Object.freeze({
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
});

const SHARP_NAMES = Object.freeze(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
const FLAT_NAMES = Object.freeze(["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]);
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);
const FLAT_MINOR_KEYS = new Set(["D", "G", "C", "F", "Bb", "Eb", "Ab"]);

const SECTION_DEFS = Object.freeze({
  intro: {
    role: "establish the tonal world without completing the whole arc",
    baseTension: [0.18, 0.3],
    chromatic: 0.05,
    rhythm: "slow/regular",
  },
  verse: {
    role: "establish key, tell the story, leave room for growth",
    baseTension: [0.22, 0.45],
    chromatic: 0.06,
    rhythm: "moderate, gently varied",
  },
  "pre-chorus": {
    role: "increase forward motion and prepare the chorus",
    baseTension: [0.45, 0.72],
    chromatic: 0.1,
    rhythm: "increasing pressure",
  },
  chorus: {
    role: "stable arrival, memorable harmonic loop, clear resolution",
    baseTension: [0.3, 0.55],
    chromatic: 0.05,
    rhythm: "regular and repeatable",
  },
  bridge: {
    role: "contrast, controlled adventure, then retransition",
    baseTension: [0.48, 0.78],
    chromatic: 0.35,
    rhythm: "varied",
  },
  outro: {
    role: "release tension and confirm tonic closure",
    baseTension: [0.28, 0.1],
    chromatic: 0.08,
    rhythm: "slower/cadential",
  },
});

const FORM_TEMPLATES = Object.freeze({
  simple_pop: [
    ["Intro", "intro", 4],
    ["Verse 1", "verse", 8],
    ["Chorus 1", "chorus", 8],
    ["Verse 2", "verse", 8],
    ["Chorus 2", "chorus", 8],
    ["Bridge", "bridge", 8],
    ["Final Chorus", "chorus", 8],
    ["Outro", "outro", 4],
  ],
  expanded_pop: [
    ["Intro", "intro", 4],
    ["Verse 1", "verse", 8],
    ["Pre-chorus 1", "pre-chorus", 4],
    ["Chorus 1", "chorus", 8],
    ["Verse 2", "verse", 8],
    ["Pre-chorus 2", "pre-chorus", 4],
    ["Chorus 2", "chorus", 8],
    ["Bridge", "bridge", 8],
    ["Final Chorus", "chorus", 8],
    ["Outro", "outro", 4],
  ],
  classical_simple_song: [
    ["A", "verse", 8],
    ["A'", "verse", 8],
    ["B", "bridge", 8],
    ["A''", "outro", 8],
  ],
});

const FUNCTION_FLOW_BONUS = Object.freeze({
  "T|T": 0.7,
  "T|PD": 1.4,
  "T|D": 0.65,
  "PD|PD": 0.8,
  "PD|D": 1.7,
  "PD|T": 0.55,
  "D|T": 1.9,
  "D|D": 0.85,
  "D|PD": -1.0,
});

const SECONDARY_DOMINANTS_MAJOR = Object.freeze({
  V: "V/V",
  ii: "V/ii",
  vi: "V/vi",
  IV: "V/IV",
});

const SECONDARY_DOMINANTS_MINOR = Object.freeze({
  V: "V/V",
  iv: "V/iv",
  VI: "V/VI",
  III: "V/III",
});

export function generateSong(options = {}) {
  const { key = "C major", form = "expanded_pop", seed = null } = options;
  return new TonalSongGenerator({ key, form, seed }).generate();
}

export function randomKey(seed = null) {
  const rng = new SeededRandom(seed ?? cryptoRandomSeed());
  return rng.choice(DEFAULT_KEYS);
}

export class TonalSongGenerator {
  constructor({ key = "C major", form = "expanded_pop", seed = null } = {}) {
    this.seed = seed;
    this.rng = new SeededRandom(seed ?? cryptoRandomSeed());
    this.keyInfo = parseKey(key);
    this.keyName = this.keyInfo.tonic;
    this.mode = this.keyInfo.mode;
    this.form = form;
    this.rnCache = new Map();
  }

  generate() {
    const plan = this.buildSongPlan();
    const sections = [];
    const memory = new Map();

    for (const sectionPlan of plan.sections) {
      const baseType = sectionPlan.section_type;
      let result;
      if (sectionPlan.repeat_of && memory.has(sectionPlan.repeat_of)) {
        result = this.varySection(memory.get(sectionPlan.repeat_of), sectionPlan);
      } else {
        result = this.generateNewSection(sectionPlan);
      }
      result = this.validateAndReviseSection(result);
      sections.push(result);
      if (!memory.has(baseType)) {
        memory.set(baseType, result);
      }
    }

    this.reviseSectionTransitions(sections);
    return new SongResult(
      {
        key: this.keyName,
        mode: this.mode,
        form: this.form,
        sections: plan.sections,
        seed: this.seed,
      },
      sections,
      this,
    );
  }

  buildSongPlan() {
    const template = FORM_TEMPLATES[this.form];
    if (!template) {
      throw new Error(`Unknown form ${this.form}. Choose one of: ${Object.keys(FORM_TEMPLATES).join(", ")}`);
    }

    const seenByType = new Set();
    const sections = template.map(([name, sectionType, length]) => {
      const repeatOf = seenByType.has(sectionType) && sectionType !== "bridge" ? sectionType : null;
      seenByType.add(sectionType);
      return this.makeSectionPlan(name, sectionType, length, repeatOf);
    });

    return {
      key: this.keyName,
      mode: this.mode,
      form: this.form,
      sections,
      seed: this.seed,
    };
  }

  makeSectionPlan(name, sectionType, lengthBars, repeatOf = null) {
    const defs = SECTION_DEFS[sectionType];
    const tensionProfile = linearProfile(lengthBars, defs.baseTension[0], defs.baseTension[1]);
    const phraseLengths = this.phraseLengths(sectionType, lengthBars);
    const phrasePlans = [];
    let start = 1;

    phraseLengths.forEach((phraseLen, index) => {
      const cadence = this.chooseCadence(sectionType, index, phraseLengths.length, name);
      const rhythm = this.harmonicRhythm(sectionType, phraseLen, index, cadence);
      const localTension = sliceProfile(tensionProfile, start, phraseLen, rhythm.length);
      const skeleton = this.functionalSkeleton(cadence, rhythm.length, sectionType);
      phrasePlans.push({
        phrase_index: index,
        start_bar: start,
        length_bars: phraseLen,
        cadence_goal: cadence,
        harmonic_rhythm: rhythm,
        functional_skeleton: skeleton,
        tension_profile: localTension,
        starting_stability: 1 - localTension[0],
        ending_target: this.cadenceEndingTarget(cadence),
      });
      start += phraseLen;
    });

    return {
      name,
      section_type: sectionType,
      length_bars: lengthBars,
      role: defs.role,
      tension_profile: tensionProfile,
      phrase_plans: phrasePlans,
      allowed_harmonic_vocabulary: [],
      chromatic_allowance: defs.chromatic,
      harmonic_rhythm_profile: defs.rhythm,
      repeat_of: repeatOf,
    };
  }

  phraseLengths(sectionType, lengthBars) {
    if (sectionType === "outro" && lengthBars === 4) {
      return [2, 2];
    }
    if (lengthBars <= 4) {
      return [lengthBars];
    }
    const lengths = [];
    let remaining = lengthBars;
    while (remaining > 0) {
      const phraseLen = Math.min(4, remaining);
      lengths.push(phraseLen);
      remaining -= phraseLen;
    }
    return lengths;
  }

  chooseCadence(sectionType, phraseIndex, phraseCount, name) {
    const last = phraseIndex === phraseCount - 1;
    const finalish = name.toLowerCase().includes("final") || sectionType === "outro";

    if (sectionType === "intro") {
      return this.weightedChoice([
        [CadenceGoal.HALF, 3],
        [CadenceGoal.WEAK_OPEN, 2],
        [CadenceGoal.PLAGAL, 1],
      ]);
    }
    if (sectionType === "verse") {
      return this.weightedChoice([
        [CadenceGoal.HALF, last ? 3 : 2],
        [CadenceGoal.WEAK_OPEN, last ? 1 : 2],
        [CadenceGoal.DECEPTIVE, 1.3],
        [CadenceGoal.AUTHENTIC, last ? 0.35 : 0.05],
      ]);
    }
    if (sectionType === "pre-chorus") {
      return CadenceGoal.HALF;
    }
    if (sectionType === "chorus") {
      if (last || finalish) {
        return CadenceGoal.AUTHENTIC;
      }
      return this.weightedChoice([
        [CadenceGoal.AUTHENTIC, 1.4],
        [CadenceGoal.PLAGAL, 0.8],
        [CadenceGoal.WEAK_OPEN, 0.7],
      ]);
    }
    if (sectionType === "bridge") {
      return last
        ? CadenceGoal.HALF
        : this.weightedChoice([
            [CadenceGoal.DECEPTIVE, 1.2],
            [CadenceGoal.WEAK_OPEN, 1],
            [CadenceGoal.PLAGAL, 0.5],
          ]);
    }
    if (sectionType === "outro") {
      return phraseIndex === 0 ? CadenceGoal.PLAGAL : CadenceGoal.AUTHENTIC;
    }
    return CadenceGoal.WEAK_OPEN;
  }

  harmonicRhythm(sectionType, bars, _phraseIndex, cadence) {
    if (bars === 2) {
      return [1, 1];
    }
    if (bars === 3) {
      return [1, 1, 1];
    }
    if (bars === 4) {
      if (sectionType === "pre-chorus" && this.rng.random() < 0.45) {
        return [1, 1, 0.5, 0.5, 1];
      }
      if (sectionType === "bridge" && this.rng.random() < 0.35) {
        return [1, 0.5, 0.5, 1, 1];
      }
      if (sectionType === "verse" && cadence !== CadenceGoal.AUTHENTIC && this.rng.random() < 0.22) {
        return [2, 1, 1];
      }
      return [1, 1, 1, 1];
    }
    return Array.from({ length: bars }, () => 1);
  }

  functionalSkeleton(cadence, nEvents, sectionType) {
    const T = HarmonicFunction.TONIC;
    const PD = HarmonicFunction.PREDOMINANT;
    const D = HarmonicFunction.DOMINANT;

    if (nEvents <= 1) {
      return [T];
    }
    if (nEvents === 2) {
      return {
        [CadenceGoal.AUTHENTIC]: [D, T],
        [CadenceGoal.HALF]: [PD, D],
        [CadenceGoal.DECEPTIVE]: [D, T],
        [CadenceGoal.PLAGAL]: [PD, T],
        [CadenceGoal.WEAK_OPEN]: [T, PD],
      }[cadence];
    }

    let middle;
    if (sectionType === "pre-chorus") {
      middle = Array.from({ length: Math.max(0, nEvents - 2) }, () => PD);
    } else if (sectionType === "bridge") {
      middle = this.weightedFunctionChain(nEvents - 2, { startAway: true });
    } else if (sectionType === "chorus") {
      middle = this.weightedFunctionChain(nEvents - 2, { stable: true });
    } else {
      middle = this.weightedFunctionChain(nEvents - 2);
    }

    let skeleton;
    if (cadence === CadenceGoal.AUTHENTIC) {
      skeleton = [T, ...middle, D, T];
    } else if (cadence === CadenceGoal.HALF) {
      skeleton = [T, ...middle, PD, D];
    } else if (cadence === CadenceGoal.DECEPTIVE) {
      skeleton = [T, ...middle, D, T];
    } else if (cadence === CadenceGoal.PLAGAL) {
      skeleton = [T, ...middle, PD, T];
    } else {
      skeleton = [T, ...middle, this.weightedChoice([[T, 1], [PD, 1.3]])];
    }

    while (skeleton.length > nEvents) {
      skeleton.splice(Math.max(1, Math.floor(skeleton.length / 2)), 1);
    }
    while (skeleton.length < nEvents) {
      skeleton.splice(-1, 0, skeleton.at(-1) === D ? PD : T);
    }
    return skeleton;
  }

  weightedFunctionChain(n, { stable = false, startAway = false } = {}) {
    const T = HarmonicFunction.TONIC;
    const PD = HarmonicFunction.PREDOMINANT;
    const D = HarmonicFunction.DOMINANT;
    const chain = [];
    let previous = startAway ? PD : T;

    for (let i = 0; i < n; i += 1) {
      let choices;
      if (stable) {
        choices = [[T, 1.5], [PD, 1.1], [D, 0.7]];
      } else if (startAway) {
        choices = [[T, 0.45], [PD, 1.25], [D, 1]];
      } else {
        choices = [[T, 1.2], [PD, 1.2], [D, 0.45]];
      }
      choices = choices.map(([fn, weight]) => [
        fn,
        Math.max(0.05, weight + (FUNCTION_FLOW_BONUS[`${previous}|${fn}`] ?? 0) * 0.25),
      ]);
      const fn = this.weightedChoice(choices);
      chain.push(fn);
      previous = fn;
    }
    return chain;
  }

  generateNewSection(sectionPlan) {
    const events = [];
    let prior = null;

    for (const phrase of sectionPlan.phrase_plans) {
      let phraseEvents = [];
      let barCursor = phrase.start_bar;

      phrase.harmonic_rhythm.forEach((duration, index) => {
        const fn = phrase.functional_skeleton[index];
        const targetTension = phrase.tension_profile[index];
        const cadencePosition = index === phrase.harmonic_rhythm.length - 1;
        const penultimate = index === phrase.harmonic_rhythm.length - 2;
        const forced = this.forcedCadenceCandidate(phrase.cadence_goal, cadencePosition, penultimate);
        const candidate = this.chooseChordCandidate({
          sectionPlan,
          phrase,
          fn,
          prior,
          localIndex: index,
          targetTension,
          forced,
          phraseEvents,
        });
        const rn = this.rn(candidate.figure);
        const event = {
          section: sectionPlan.name,
          phrase_index: phrase.phrase_index,
          bar: barCursor,
          duration,
          roman_figure: rn.figure,
          function: candidate.function,
          chord_symbol: this.chordSymbol(rn),
          chord_pitches: this.pitchNames(rn),
          rn,
          tension: candidate.tension,
          flags: [...candidate.flags],
          cadence_chord:
            cadencePosition ||
            (penultimate &&
              [CadenceGoal.AUTHENTIC, CadenceGoal.DECEPTIVE, CadenceGoal.PLAGAL].includes(phrase.cadence_goal)),
          explanation: this.candidateExplanation(candidate, phrase, index),
        };
        phraseEvents.push(event);
        events.push(event);
        prior = event;
        barCursor += duration;
      });

      phraseEvents = this.applyChromaticColor(sectionPlan, phrase, phraseEvents);
      replacePhraseEvents(events, phrase, phraseEvents);
      prior = events.at(-1) ?? prior;
    }

    return { plan: sectionPlan, events };
  }

  chooseChordCandidate({ sectionPlan, phrase, fn, prior, localIndex, targetTension, forced, phraseEvents }) {
    const candidates = forced ?? this.diatonicCandidates(fn, sectionPlan.section_type);
    const scored = [];

    for (const candidate of candidates) {
      let rn;
      try {
        rn = this.rn(candidate.figure);
      } catch {
        continue;
      }
      let score = Math.log(Math.max(candidate.baseWeight, 0.01));
      score += this.scoreFunctionFlow(prior?.function ?? null, candidate.function);
      score += this.scoreSmoothness(prior?.rn ?? null, rn);
      score += this.scoreTensionMatch(candidate, targetTension);
      score += this.scoreCadentialContext(candidate, phrase, localIndex);
      score += this.scoreRepetition(candidate, phraseEvents, sectionPlan.section_type);
      if (candidate.flags.includes("chromatic")) {
        score -= 1.2;
      }
      scored.push([candidate, score]);
    }

    if (!scored.length) {
      return candidate(this.mode === "major" ? "I" : "i", HarmonicFunction.TONIC);
    }

    scored.sort((a, b) => b[1] - a[1]);
    const top = scored.slice(0, Math.min(4, scored.length));
    const floor = top.at(-1)[1];
    return this.weightedChoice(top.map(([cand, score]) => [cand, Math.exp(Math.min(4, score - floor))]));
  }

  diatonicCandidates(fn, sectionType) {
    let vocab;
    if (this.mode === "major") {
      vocab = {
        [HarmonicFunction.TONIC]: [
          candidate("I", fn, 4.5, 0.18),
          candidate("vi", fn, 2.2, 0.3, ["tonic substitute"]),
          candidate("iii", fn, 0.8, 0.26, ["tonic substitute"]),
        ],
        [HarmonicFunction.PREDOMINANT]: [
          candidate("IV", fn, 3.2, 0.36),
          candidate("ii", fn, 2.8, 0.42),
          candidate("vi", fn, 0.9, 0.32, ["pivot tonic/predominant"]),
        ],
        [HarmonicFunction.DOMINANT]: [
          candidate("V", fn, 3.4, 0.62),
          candidate("V7", fn, 2.9, 0.72),
          candidate("viio", fn, 0.75, 0.78),
        ],
      };
    } else {
      vocab = {
        [HarmonicFunction.TONIC]: [
          candidate("i", fn, 4.5, 0.2),
          candidate("VI", fn, 2, 0.34, ["tonic substitute"]),
          candidate("III", fn, 1.2, 0.3, ["relative major color"]),
        ],
        [HarmonicFunction.PREDOMINANT]: [
          candidate("iv", fn, 3.2, 0.42),
          candidate("iio", fn, 2, 0.55),
          candidate("VI", fn, 1.4, 0.36, ["pivot tonic/predominant"]),
        ],
        [HarmonicFunction.DOMINANT]: [
          candidate("V", fn, 3.4, 0.66),
          candidate("V7", fn, 3, 0.76),
          candidate("viio", fn, 0.75, 0.8),
        ],
      };
    }

    const candidates = vocab[fn].map((item) => ({ ...item, flags: [...item.flags] }));
    if (sectionType === "chorus") {
      for (const item of candidates) {
        if (["I", "i", "IV", "V", "V7", "vi", "VI"].includes(item.figure)) {
          item.baseWeight *= 1.25;
        }
      }
    } else if (sectionType === "verse") {
      for (const item of candidates) {
        if (["V7", "viio", "iio"].includes(item.figure)) {
          item.baseWeight *= 0.72;
        }
      }
    } else if (sectionType === "bridge") {
      for (const item of candidates) {
        if (["iii", "III", "vi", "VI", "ii", "iv"].includes(item.figure)) {
          item.baseWeight *= 1.2;
        }
      }
    }
    return candidates;
  }

  forcedCadenceCandidate(cadence, final, penultimate) {
    const major = this.mode === "major";
    const tonic = major ? "I" : "i";
    const deceptive = major ? "vi" : "VI";
    const plagal = major ? "IV" : "iv";

    if (final) {
      if (cadence === CadenceGoal.AUTHENTIC) {
        return [candidate(tonic, HarmonicFunction.TONIC, 5, 0.18, ["authentic arrival"])];
      }
      if (cadence === CadenceGoal.HALF) {
        return [
          candidate("V", HarmonicFunction.DOMINANT, 3, 0.68, ["half cadence"]),
          candidate("V7", HarmonicFunction.DOMINANT, 3.4, 0.78, ["half cadence"]),
        ];
      }
      if (cadence === CadenceGoal.DECEPTIVE) {
        return [candidate(deceptive, HarmonicFunction.TONIC, 4, 0.38, ["deceptive arrival"])];
      }
      if (cadence === CadenceGoal.PLAGAL) {
        return [candidate(tonic, HarmonicFunction.TONIC, 4, 0.18, ["plagal arrival"])];
      }
      if (cadence === CadenceGoal.WEAK_OPEN) {
        const weak = major ? ["vi", "iii", "IV"] : ["VI", "III", "iv"];
        const fnMap = {
          vi: HarmonicFunction.TONIC,
          iii: HarmonicFunction.TONIC,
          VI: HarmonicFunction.TONIC,
          III: HarmonicFunction.TONIC,
          IV: HarmonicFunction.PREDOMINANT,
          iv: HarmonicFunction.PREDOMINANT,
        };
        return weak.map((figure) => candidate(figure, fnMap[figure], 1, 0.35, ["open ending"]));
      }
    }

    if (penultimate) {
      if ([CadenceGoal.AUTHENTIC, CadenceGoal.DECEPTIVE].includes(cadence)) {
        return [
          candidate("V", HarmonicFunction.DOMINANT, 2, 0.66, ["cadence preparation"]),
          candidate("V7", HarmonicFunction.DOMINANT, 3.2, 0.76, ["cadence preparation"]),
        ];
      }
      if (cadence === CadenceGoal.PLAGAL) {
        return [candidate(plagal, HarmonicFunction.PREDOMINANT, 3.2, 0.4, ["plagal preparation"])];
      }
    }
    return null;
  }

  applyChromaticColor(sectionPlan, phrase, events) {
    if (!events.length) {
      return events;
    }
    const allowance = sectionPlan.chromatic_allowance;
    if (sectionPlan.section_type === "bridge" && phrase.phrase_index === 0) {
      if (["I", "i"].includes(events[0].roman_figure) && this.rng.random() < 0.75) {
        const replacement = this.mode === "major" ? "vi" : "III";
        events[0] = this.replaceEvent(events[0], replacement, ["contrast opening"]);
      }
    }

    let chromaticCount = events.filter((event) => event.flags.includes("chromatic")).length;
    const maxChromatic = sectionPlan.section_type === "bridge" ? 2 : 1;
    const secondaryMap = this.mode === "major" ? SECONDARY_DOMINANTS_MAJOR : SECONDARY_DOMINANTS_MINOR;

    for (let i = 0; i < events.length - 1; i += 1) {
      if (chromaticCount >= maxChromatic) {
        break;
      }
      const target = events[i + 1].roman_figure;
      const secondary = secondaryMap[target];
      if (!secondary) {
        continue;
      }
      const nearCadence = i >= events.length - 3;
      let probability = allowance * (sectionPlan.section_type === "bridge" ? 1.6 : 0.75);
      if (nearCadence && phrase.cadence_goal === CadenceGoal.HALF && ["V", "V7"].includes(target)) {
        probability *= 1.3;
      }
      if (this.rng.random() < probability) {
        events[i] = this.replaceEvent(events[i], secondary, ["secondary dominant", "chromatic", `resolves to ${target}`]);
        chromaticCount += 1;
      }
    }

    if (this.mode === "major" && chromaticCount < maxChromatic) {
      for (let i = 0; i < events.length - 1; i += 1) {
        if (chromaticCount >= maxChromatic) {
          break;
        }
        const current = events[i];
        const next = events[i + 1];
        if (current.roman_figure === "IV" && ["I", "V", "V7"].includes(next.roman_figure)) {
          const probability = allowance * (["bridge", "outro"].includes(sectionPlan.section_type) ? 1.2 : 0.45);
          if (this.rng.random() < probability) {
            events[i] = this.replaceEvent(current, "iv", ["modal mixture", "borrowed iv", "chromatic"]);
            chromaticCount += 1;
          }
        } else if (current.roman_figure === "I" && next.roman_figure === "IV" && sectionPlan.section_type === "bridge") {
          if (this.rng.random() < allowance * 0.45) {
            events[i] = this.replaceEvent(current, "bVII", ["modal mixture", "borrowed bVII", "chromatic"]);
            chromaticCount += 1;
          }
        }
      }
    }

    return events;
  }

  replaceEvent(event, newFigure, flags) {
    const rn = this.rn(newFigure);
    const fn = this.inferFunction(newFigure);
    const tension = this.inferTension(newFigure, flags);
    const newFlags = unique([...event.flags, ...flags]);
    return {
      ...event,
      roman_figure: rn.figure,
      function: fn,
      chord_symbol: this.chordSymbol(rn),
      chord_pitches: this.pitchNames(rn),
      rn,
      tension,
      flags: newFlags,
      explanation: `${event.explanation}; replaced by ${rn.figure}`.replace(/^; /, ""),
    };
  }

  varySection(source, newPlan) {
    let events = source.events.map((event) => cloneEvent({ ...event, section: newPlan.name, flags: [...event.flags] }));
    const indices = events.map((_event, index) => index);
    this.rng.shuffle(indices);
    let changes = 0;
    const maxChanges = newPlan.section_type === "pre-chorus" ? 1 : 2;

    for (const index of indices) {
      if (changes >= maxChanges) {
        break;
      }
      const event = events[index];
      const isLastEvent = index === events.length - 1;
      if (isLastEvent && ["I", "i"].includes(event.roman_figure)) {
        continue;
      }
      const sub = this.functionalSubstitution(event.roman_figure, newPlan.section_type);
      if (sub && this.rng.random() < 0.55) {
        events[index] = this.replaceEvent(event, sub, ["functional substitution", "variation"]);
        changes += 1;
      } else if (event.roman_figure === "V" && this.rng.random() < 0.5) {
        events[index] = this.replaceEvent(event, "V7", ["cadential seventh", "variation"]);
        changes += 1;
      }
    }

    if (newPlan.section_type === "chorus") {
      events = this.forceSectionFinalCadence(events, CadenceGoal.AUTHENTIC);
    } else if (newPlan.section_type === "verse" && this.rng.random() < 0.45) {
      if (events.length >= 2 && ["V", "V7"].includes(events.at(-2).roman_figure) && ["I", "i"].includes(events.at(-1).roman_figure)) {
        events[events.length - 1] = this.replaceEvent(events.at(-1), this.mode === "major" ? "vi" : "VI", [
          "deceptive variation",
        ]);
      }
    }

    events = this.retimeEventsToPlan(events, newPlan);
    return this.validateAndReviseSection({ plan: newPlan, events });
  }

  functionalSubstitution(figure, sectionType) {
    const majorSubs = {
      I: ["vi", "iii"],
      vi: ["I"],
      iii: ["I"],
      ii: ["IV"],
      IV: ["ii"],
      V: ["V7"],
      V7: ["V"],
    };
    const minorSubs = {
      i: ["VI", "III"],
      VI: ["i", "iv"],
      III: ["i"],
      iv: ["iio", "VI"],
      iio: ["iv"],
      V: ["V7"],
      V7: ["V"],
    };
    let substitutions = (this.mode === "major" ? majorSubs : minorSubs)[figure];
    if (!substitutions) {
      return null;
    }
    if (sectionType === "chorus") {
      substitutions = substitutions.filter((item) => !["iii", "III", "iio"].includes(item));
      if (!substitutions.length) {
        substitutions = (this.mode === "major" ? majorSubs : minorSubs)[figure];
      }
    }
    return this.rng.choice(substitutions);
  }

  retimeEventsToPlan(events, newPlan) {
    const allSlots = [];
    for (const phrase of newPlan.phrase_plans) {
      let bar = phrase.start_bar;
      for (const duration of phrase.harmonic_rhythm) {
        allSlots.push([phrase.phrase_index, bar, duration]);
        bar += duration;
      }
    }
    while (events.length < allSlots.length) {
      const last = events.at(-1);
      events.push(cloneEvent({ ...last, flags: [...last.flags, "repeated for rhythm variation"] }));
    }
    events = events.slice(0, allSlots.length);
    return events.map((event, index) => {
      const [phraseIndex, bar, duration] = allSlots[index];
      return { ...event, section: newPlan.name, phrase_index: phraseIndex, bar, duration };
    });
  }

  validateAndReviseSection(result) {
    let events = [...result.events];
    for (let i = 0; i < events.length - 1; i += 1) {
      const event = events[i];
      const next = events[i + 1];
      if (event.function === HarmonicFunction.DOMINANT && next.function === HarmonicFunction.PREDOMINANT) {
        events[i + 1] = this.replaceEvent(next, this.mode === "major" ? "I" : "i", ["revision: dominant resolution"]);
      }
    }

    for (let i = 1; i < events.length - 1; i += 1) {
      if (events.slice(i - 1, i + 2).every((event) => event.flags.includes("chromatic"))) {
        const replacement = this.defaultForFunction(events[i].function);
        events[i] = this.replaceEvent(events[i], replacement, ["revision: reduce chromatic density"]);
        events[i].flags = events[i].flags.filter((flag) => flag !== "chromatic");
      }
    }

    for (const phrase of result.plan.phrase_plans) {
      const phraseIndices = events
        .map((event, index) => [event, index])
        .filter(([event]) => event.phrase_index === phrase.phrase_index)
        .map(([, index]) => index);
      if (!phraseIndices.length) {
        continue;
      }
      const lastIndex = phraseIndices.at(-1);
      const penultIndex = phraseIndices.length >= 2 ? phraseIndices.at(-2) : null;
      events = this.revisePhraseCadence(events, lastIndex, penultIndex, phrase.cadence_goal);
    }
    return { plan: result.plan, events };
  }

  revisePhraseCadence(events, lastIndex, penultIndex, cadence) {
    const tonic = this.mode === "major" ? "I" : "i";
    const deceptive = this.mode === "major" ? "vi" : "VI";
    const plagal = this.mode === "major" ? "IV" : "iv";
    if (cadence === CadenceGoal.AUTHENTIC) {
      if (penultIndex !== null && !["V", "V7", "viio"].includes(events[penultIndex].roman_figure)) {
        events[penultIndex] = this.replaceEvent(events[penultIndex], "V7", ["revision: authentic preparation"]);
      }
      if (events[lastIndex].roman_figure !== tonic) {
        events[lastIndex] = this.replaceEvent(events[lastIndex], tonic, ["revision: authentic arrival"]);
      }
    } else if (cadence === CadenceGoal.HALF) {
      if (!["V", "V7"].includes(events[lastIndex].roman_figure)) {
        events[lastIndex] = this.replaceEvent(events[lastIndex], "V7", ["revision: half cadence"]);
      }
    } else if (cadence === CadenceGoal.DECEPTIVE) {
      if (penultIndex !== null && !["V", "V7"].includes(events[penultIndex].roman_figure)) {
        events[penultIndex] = this.replaceEvent(events[penultIndex], "V7", ["revision: deceptive preparation"]);
      }
      if (events[lastIndex].roman_figure !== deceptive) {
        events[lastIndex] = this.replaceEvent(events[lastIndex], deceptive, ["revision: deceptive arrival"]);
      }
    } else if (cadence === CadenceGoal.PLAGAL) {
      if (penultIndex !== null && events[penultIndex].roman_figure !== plagal) {
        events[penultIndex] = this.replaceEvent(events[penultIndex], plagal, ["revision: plagal preparation"]);
      }
      if (events[lastIndex].roman_figure !== tonic) {
        events[lastIndex] = this.replaceEvent(events[lastIndex], tonic, ["revision: plagal arrival"]);
      }
    }
    return events;
  }

  reviseSectionTransitions(sections) {
    for (let i = 0; i < sections.length - 1; i += 1) {
      const current = sections[i];
      const next = sections[i + 1];
      if (!current.events.length || !next.events.length) {
        continue;
      }
      const last = current.events.at(-1);
      const first = next.events[0];
      if (current.plan.section_type === "pre-chorus" && next.plan.section_type === "chorus") {
        if (!["V", "V7"].includes(last.roman_figure)) {
          current.events[current.events.length - 1] = this.replaceEvent(last, "V7", ["transition revision: prepare chorus"]);
        }
        if (!["I", "i"].includes(first.roman_figure)) {
          next.events[0] = this.replaceEvent(first, this.mode === "major" ? "I" : "i", ["transition revision: chorus arrival"]);
        }
      }
      if (current.plan.section_type === "bridge" && next.plan.section_type === "chorus") {
        if (!["V", "V7"].includes(last.roman_figure)) {
          current.events[current.events.length - 1] = this.replaceEvent(last, "V7", ["transition revision: retransition"]);
        }
      }
      if (last.flags.includes("chromatic") && first.flags.includes("chromatic")) {
        next.events[0] = this.replaceEvent(first, this.mode === "major" ? "I" : "i", ["transition revision: reset tonality"]);
      }
    }
  }

  forceSectionFinalCadence(events, cadence) {
    if (events.length < 2) {
      return events;
    }
    if (cadence === CadenceGoal.AUTHENTIC) {
      events[events.length - 2] = this.replaceEvent(events.at(-2), "V7", ["strong final cadence"]);
      events[events.length - 1] = this.replaceEvent(events.at(-1), this.mode === "major" ? "I" : "i", [
        "strong final cadence",
      ]);
    }
    return events;
  }

  scoreFunctionFlow(priorFunction, current) {
    if (!priorFunction) {
      return 0;
    }
    return FUNCTION_FLOW_BONUS[`${priorFunction}|${current}`] ?? 0;
  }

  scoreSmoothness(previousRn, currentRn) {
    if (!previousRn) {
      return 0;
    }
    const prevPcs = new Set(previousRn.pcs);
    const curPcs = new Set(currentRn.pcs);
    const common = [...prevPcs].filter((pc) => curPcs.has(pc)).length;
    let score = common * 0.42;
    let diff = Math.abs(currentRn.rootPc - previousRn.rootPc) % 12;
    diff = Math.min(diff, 12 - diff);
    if ([5, 7].includes(diff)) {
      score += 0.65;
    } else if ([1, 2].includes(diff)) {
      score += 0.38;
    } else if (diff === 0) {
      score += 0.15;
    } else if (diff === 6) {
      score -= 0.45;
    } else {
      score -= 0.1;
    }
    return score;
  }

  scoreTensionMatch(cand, targetTension) {
    return -Math.abs(cand.tension - targetTension) * 1.2;
  }

  scoreCadentialContext(cand, phrase, localIndex) {
    const n = phrase.harmonic_rhythm.length;
    let score = 0;
    const final = localIndex === n - 1;
    const penult = localIndex === n - 2;
    const tooEarly = localIndex < Math.max(1, Math.floor(n / 2));
    const tonic = this.mode === "major" ? "I" : "i";

    if (tooEarly && cand.figure === tonic && phrase.cadence_goal === CadenceGoal.AUTHENTIC) {
      score -= 0.35;
    }
    if (penult && [CadenceGoal.AUTHENTIC, CadenceGoal.DECEPTIVE].includes(phrase.cadence_goal)) {
      if (["V", "V7", "viio"].includes(cand.figure)) {
        score += 1.25;
      }
    }
    if (final) {
      if (phrase.cadence_goal === CadenceGoal.AUTHENTIC && cand.figure === tonic) {
        score += 1.8;
      } else if (phrase.cadence_goal === CadenceGoal.HALF && ["V", "V7"].includes(cand.figure)) {
        score += 1.8;
      } else if (phrase.cadence_goal === CadenceGoal.DECEPTIVE && ["vi", "VI"].includes(cand.figure)) {
        score += 1.8;
      } else if (phrase.cadence_goal === CadenceGoal.PLAGAL && cand.figure === tonic) {
        score += 1.4;
      }
    }
    return score;
  }

  scoreRepetition(cand, phraseEvents, sectionType) {
    if (!phraseEvents.length) {
      return 0;
    }
    const last = phraseEvents.at(-1);
    if (cand.figure === last.roman_figure) {
      if (["pre-chorus", "outro"].includes(sectionType) && cand.function === HarmonicFunction.DOMINANT) {
        return 0.15;
      }
      return -0.55;
    }
    if (phraseEvents.length >= 2 && phraseEvents.slice(-2).every((event) => event.roman_figure === cand.figure)) {
      return -1.4;
    }
    return 0;
  }

  rn(figure) {
    if (!this.rnCache.has(figure)) {
      this.rnCache.set(figure, realizeRoman(figure, this.keyInfo));
    }
    return this.rnCache.get(figure);
  }

  chordSymbol(rn) {
    const root = noteName(rn.rootPc, this.keyInfo.preferFlats);
    if (rn.quality === "minor") {
      return `${root}m`;
    }
    if (rn.quality === "diminished") {
      return `${root}dim`;
    }
    if (rn.quality === "dominant7") {
      return `${root}7`;
    }
    return root;
  }

  pitchNames(rn) {
    return rn.pcs.map((pc, index) => `${noteName(pc, this.keyInfo.preferFlats)}${index === 0 ? 4 : 4}`);
  }

  inferFunction(figure) {
    if (figure.includes("/") || figure.startsWith("V") || figure.startsWith("vii")) {
      return HarmonicFunction.DOMINANT;
    }
    if (this.mode === "major") {
      if (["I", "vi", "iii"].includes(figure)) {
        return HarmonicFunction.TONIC;
      }
      if (["ii", "IV", "iv", "bVII", "bVI", "bIII"].includes(figure)) {
        return HarmonicFunction.PREDOMINANT;
      }
    } else {
      if (["i", "VI", "III"].includes(figure)) {
        return HarmonicFunction.TONIC;
      }
      if (["iio", "iv"].includes(figure)) {
        return HarmonicFunction.PREDOMINANT;
      }
    }
    return HarmonicFunction.PREDOMINANT;
  }

  inferTension(figure, flags = []) {
    let base = 0.25;
    const fn = this.inferFunction(figure);
    if (fn === HarmonicFunction.PREDOMINANT) {
      base = 0.42;
    } else if (fn === HarmonicFunction.DOMINANT) {
      base = 0.68;
    }
    if (figure.includes("7")) {
      base += 0.08;
    }
    if (
      flags.includes("chromatic") ||
      figure.includes("/") ||
      figure.startsWith("b") ||
      ["iv", "bVII", "bVI", "bIII"].includes(figure)
    ) {
      base += 0.12;
    }
    return Math.min(1, base);
  }

  defaultForFunction(fn) {
    if (this.mode === "major") {
      return {
        [HarmonicFunction.TONIC]: "I",
        [HarmonicFunction.PREDOMINANT]: "IV",
        [HarmonicFunction.DOMINANT]: "V",
      }[fn];
    }
    return {
      [HarmonicFunction.TONIC]: "i",
      [HarmonicFunction.PREDOMINANT]: "iv",
      [HarmonicFunction.DOMINANT]: "V",
    }[fn];
  }

  candidateExplanation(cand, phrase, localIndex) {
    const position = localIndex === phrase.harmonic_rhythm.length - 1 ? "ending" : "body";
    return `${cand.function} function in phrase ${position}; supports ${phrase.cadence_goal} goal`;
  }

  cadenceEndingTarget(cadence) {
    const major = this.mode === "major";
    return {
      [CadenceGoal.AUTHENTIC]: major ? "I" : "i",
      [CadenceGoal.HALF]: "V",
      [CadenceGoal.DECEPTIVE]: major ? "vi" : "VI",
      [CadenceGoal.PLAGAL]: major ? "I" : "i",
      [CadenceGoal.WEAK_OPEN]: null,
    }[cadence];
  }

  weightedChoice(weightedItems) {
    const total = weightedItems.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
    if (total <= 0) {
      return weightedItems[0][0];
    }
    const pick = this.rng.random() * total;
    let upto = 0;
    for (const [item, weight] of weightedItems) {
      upto += Math.max(0, weight);
      if (upto >= pick) {
        return item;
      }
    }
    return weightedItems.at(-1)[0];
  }
}

export class SongResult {
  constructor(plan, sections, generator) {
    this.plan = plan;
    this.sections = sections;
    this.generator = generator;
  }

  toSmplrJson({
    bpm = 92,
    beatsPerBar = 4,
    startMidi = 60,
    includeBass = true,
    defaultVelocity = 0.72,
  } = {}) {
    const bars = [];
    const flatNotes = [];
    const flatHarmony = [];
    let sectionStartBar = 0;
    let previousUpperVoicing = null;

    for (const section of this.sections) {
      const plan = section.plan;
      for (let localBar = 0; localBar < plan.length_bars; localBar += 1) {
        const phrase = phraseForLocalBar(plan, localBar + 1);
        const globalBarIndex = sectionStartBar + localBar;
        const tension = plan.tension_profile[Math.min(localBar, plan.tension_profile.length - 1)];
        bars.push({
          index: globalBarIndex,
          number: globalBarIndex + 1,
          startBeat: globalBarIndex * beatsPerBar,
          startTimeSeconds: round(beatsToSeconds(globalBarIndex * beatsPerBar, bpm), 4),
          durationBeats: beatsPerBar,
          section: {
            name: plan.name,
            type: plan.section_type,
            role: plan.role,
            repeatOf: plan.repeat_of,
            harmonicRhythmProfile: plan.harmonic_rhythm_profile,
            chromaticAllowance: round(plan.chromatic_allowance, 3),
          },
          phrase: {
            index: phrase?.phrase_index ?? null,
            number: phrase ? phrase.phrase_index + 1 : null,
            cadenceGoal: phrase?.cadence_goal ?? null,
            startingStability: phrase ? round(phrase.starting_stability, 3) : null,
            endingTarget: phrase?.ending_target ?? null,
          },
          tension: round(tension, 3),
          activeHarmony: [],
          harmonyEvents: [],
          notes: [],
        });
      }
      sectionStartBar += plan.length_bars;
    }

    sectionStartBar = 0;
    for (const section of this.sections) {
      for (const event of section.events) {
        const absoluteBar = sectionStartBar + event.bar - 1;
        const startBeat = absoluteBar * beatsPerBar;
        const durationBeats = event.duration * beatsPerBar;
        const upperVoicing = smoothUpperVoicing(event, previousUpperVoicing, startMidi);
        const bassMidi = bassMidiForEvent(event, startMidi - 24);
        const playedMidis = includeBass ? [bassMidi, ...upperVoicing] : [...upperVoicing];
        const voices = includeBass ? ["bass", ...upperVoicing.map((_midi, index) => `chord_${index + 1}`)] : upperVoicing.map((_midi, index) => `chord_${index + 1}`);
        const previousForIntervals = includeBass ? [null, ...(previousUpperVoicing ?? [])] : previousUpperVoicing ?? [];
        const noteEvents = [];

        playedMidis.forEach((midi, voiceIndex) => {
          const previousMidi = voiceIndex < previousForIntervals.length ? previousForIntervals[voiceIndex] : null;
          const normalizedVelocity = velocityForEvent(event, defaultVelocity);
          const notePayload = {
            id: `bar${Math.floor(absoluteBar) + 1}_${event.roman_figure}_${voices[voiceIndex]}`,
            voice: voices[voiceIndex],
            midi,
            note: midiToName(midi),
            relativeMidi: midi - startMidi,
            startBeat: round(startBeat, 4),
            startTimeSeconds: round(beatsToSeconds(startBeat, bpm), 4),
            durationBeats: round(durationBeats, 4),
            durationSeconds: round(beatsToSeconds(durationBeats, bpm), 4),
            velocity: Math.round(normalizedVelocity * 127),
            normalizedVelocity: round(normalizedVelocity, 3),
            intervalFromPreviousVoiceNote: previousMidi === null ? null : midi - previousMidi,
            chordTone: chordToneLabel(event, midi),
          };
          noteEvents.push(notePayload);
          flatNotes.push(notePayload);
        });

        const harmonyPayload = {
          section: event.section,
          phraseIndex: event.phrase_index,
          bar: round(absoluteBar, 4),
          barNumber: Math.floor(absoluteBar) + 1,
          startBeat: round(startBeat, 4),
          startTimeSeconds: round(beatsToSeconds(startBeat, bpm), 4),
          durationBeats: round(durationBeats, 4),
          durationSeconds: round(beatsToSeconds(durationBeats, bpm), 4),
          roman: event.roman_figure,
          function: event.function,
          chord: event.chord_symbol,
          chordPitchClasses: event.rn.pcs.map((pc) => noteName(pc, this.generator.keyInfo.preferFlats)),
          playedNotes: noteEvents.map((note) => note.note),
          playedMidis,
          upperVoicingMidis: upperVoicing,
          bassMidi: includeBass ? bassMidi : null,
          voicingAnalysis: {
            verticalIntervals: verticalIntervals(playedMidis),
            upperVerticalIntervals: verticalIntervals(upperVoicing),
            commonToneCountWithPrevious: commonToneCount(previousUpperVoicing, upperVoicing),
            totalUpperVoiceMovement:
              previousUpperVoicing === null
                ? null
                : previousUpperVoicing
                    .slice(0, upperVoicing.length)
                    .reduce((sum, previous, index) => sum + Math.abs(previous - upperVoicing[index]), 0),
          },
          tension: round(event.tension, 3),
          flags: [...event.flags],
          cadenceChord: event.cadence_chord,
          explanation: event.explanation,
          notes: noteEvents,
        };
        flatHarmony.push(harmonyPayload);

        const startBarIndex = Math.floor(absoluteBar + 1e-9);
        if (startBarIndex >= 0 && startBarIndex < bars.length) {
          bars[startBarIndex].harmonyEvents.push(harmonyPayload);
          bars[startBarIndex].notes.push(...noteEvents);
        }

        const firstActiveBar = Math.floor(absoluteBar + 1e-9);
        const lastActiveBar = Math.ceil(absoluteBar + event.duration - 1e-9) - 1;
        for (let barIndex = firstActiveBar; barIndex <= lastActiveBar; barIndex += 1) {
          if (barIndex >= 0 && barIndex < bars.length) {
            bars[barIndex].activeHarmony.push({
              roman: event.roman_figure,
              chord: event.chord_symbol,
              function: event.function,
              startedThisBar: barIndex === startBarIndex,
              sourceBar: round(absoluteBar, 4),
            });
          }
        }

        previousUpperVoicing = upperVoicing;
      }
      sectionStartBar += section.plan.length_bars;
    }

    return {
      schema: "tonal_song_generator.smplr.v1",
      generator: "tonal-song-generator.js",
      key: `${this.plan.key} ${this.plan.mode}`,
      tonic: this.plan.key,
      mode: this.plan.mode,
      form: this.plan.form,
      seed: this.plan.seed,
      bpm,
      beatsPerBar,
      startMidi,
      startNote: midiToName(startMidi),
      barCount: bars.length,
      bars,
      harmony: flatHarmony,
      notes: flatNotes,
    };
  }

  toJSON(options = {}) {
    return this.toSmplrJson(options);
  }

  toText() {
    const lines = [`Key: ${this.plan.key} ${this.plan.mode}`, `Form: ${this.plan.form}`, ""];
    for (const section of this.sections) {
      lines.push(`${section.plan.name} (${section.plan.section_type}, ${section.plan.length_bars} bars)`);
      lines.push(`  Role: ${section.plan.role}`);
      if (section.plan.repeat_of) {
        lines.push(`  Variation of: ${section.plan.repeat_of}`);
      }
      for (const phrase of section.plan.phrase_plans) {
        const phraseEvents = section.events.filter((event) => event.phrase_index === phrase.phrase_index);
        lines.push(`  Phrase ${phrase.phrase_index + 1}: ${phrase.cadence_goal} cadence`);
        lines.push(`    RN:     ${phraseEvents.map((event) => event.roman_figure).join(" - ")}`);
        lines.push(`    Chords: ${phraseEvents.map((event) => event.chord_symbol).join(" | ")}`);
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }
}

function candidate(figure, fn, baseWeight = 1, tension = 0.35, flags = [], resolvesTo = null) {
  return { figure, function: fn, baseWeight, tension, flags, resolvesTo };
}

function parseKey(keyText) {
  const text = String(keyText).trim().replace(/\s+/g, " ");
  const parts = text.split(" ");
  let mode = "major";
  let tonic = parts[0] || "C";
  if (parts.length >= 2 && ["major", "minor"].includes(parts.at(-1).toLowerCase())) {
    mode = parts.at(-1).toLowerCase();
    tonic = parts.slice(0, -1).join("");
  } else if (/^[a-g]/.test(tonic)) {
    mode = "minor";
    tonic = tonic[0].toUpperCase() + tonic.slice(1);
  }
  tonic = tonic.replace("♭", "b").replace("♯", "#");
  if (!(tonic in NOTE_TO_PC)) {
    throw new Error(`Unsupported key tonic: ${tonic}`);
  }
  const preferFlats = tonic.includes("b") || (mode === "major" ? FLAT_KEYS.has(tonic) : FLAT_MINOR_KEYS.has(tonic));
  return { tonic, tonicPc: NOTE_TO_PC[tonic], mode, preferFlats };
}

function realizeRoman(figure, keyInfo) {
  if (figure.includes("/")) {
    const [, targetFigure] = figure.split("/");
    const target = realizeRoman(targetFigure, keyInfo);
    const rootPc = mod12(target.rootPc + 7);
    return romanPayload(figure, rootPc, "major", [rootPc, rootPc + 4, rootPc + 7]);
  }

  const major = keyInfo.mode === "major";
  const table = major ? majorRomanTable() : minorRomanTable();
  const spec = table[figure];
  if (!spec) {
    throw new Error(`Unsupported Roman figure for JS generator: ${figure}`);
  }
  const rootPc = mod12(keyInfo.tonicPc + spec.root);
  const pcs = spec.intervals.map((interval) => mod12(rootPc + interval));
  return romanPayload(figure, rootPc, spec.quality, pcs);
}

function majorRomanTable() {
  return {
    I: { root: 0, quality: "major", intervals: [0, 4, 7] },
    ii: { root: 2, quality: "minor", intervals: [0, 3, 7] },
    iii: { root: 4, quality: "minor", intervals: [0, 3, 7] },
    IV: { root: 5, quality: "major", intervals: [0, 4, 7] },
    iv: { root: 5, quality: "minor", intervals: [0, 3, 7] },
    V: { root: 7, quality: "major", intervals: [0, 4, 7] },
    V7: { root: 7, quality: "dominant7", intervals: [0, 4, 7, 10] },
    vi: { root: 9, quality: "minor", intervals: [0, 3, 7] },
    viio: { root: 11, quality: "diminished", intervals: [0, 3, 6] },
    bVII: { root: 10, quality: "major", intervals: [0, 4, 7] },
    bVI: { root: 8, quality: "major", intervals: [0, 4, 7] },
    bIII: { root: 3, quality: "major", intervals: [0, 4, 7] },
  };
}

function minorRomanTable() {
  return {
    i: { root: 0, quality: "minor", intervals: [0, 3, 7] },
    iio: { root: 2, quality: "diminished", intervals: [0, 3, 6] },
    III: { root: 3, quality: "major", intervals: [0, 4, 7] },
    iv: { root: 5, quality: "minor", intervals: [0, 3, 7] },
    V: { root: 7, quality: "major", intervals: [0, 4, 7] },
    V7: { root: 7, quality: "dominant7", intervals: [0, 4, 7, 10] },
    VI: { root: 8, quality: "major", intervals: [0, 4, 7] },
    viio: { root: 11, quality: "diminished", intervals: [0, 3, 6] },
  };
}

function romanPayload(figure, rootPc, quality, pcs) {
  return {
    figure,
    rootPc,
    quality,
    pcs: unique(pcs.map(mod12)),
  };
}

function noteName(pc, preferFlats = false) {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${SHARP_NAMES[mod12(midi)]}${octave}`;
}

function closestMidiForPitchClass(pc, target) {
  const base = Math.round(target);
  const up = base + mod12(pc - base);
  const down = up - 12;
  return Math.abs(up - target) <= Math.abs(down - target) ? up : down;
}

function midiAtOrBelow(pc, target) {
  let midi = closestMidiForPitchClass(pc, target);
  while (midi > target) {
    midi -= 12;
  }
  while (midi < target - 18) {
    midi += 12;
  }
  return midi;
}

function smoothUpperVoicing(event, previous, centerMidi) {
  const pcs = event.rn.pcs;
  const rotations = pcs.map((_pc, index) => [...pcs.slice(index), ...pcs.slice(0, index)]);
  const candidates = [];

  for (const rotation of rotations) {
    for (const centerShift of [-12, 0, 12]) {
      const targetStart = centerMidi - 5 + centerShift;
      const voiced = [];
      rotation.forEach((pc, index) => {
        let midi = closestMidiForPitchClass(pc, targetStart + index * 4);
        while (voiced.length && midi <= voiced.at(-1)) {
          midi += 12;
        }
        voiced.push(midi);
      });
      if (Math.min(...voiced) >= 45 && Math.max(...voiced) <= 84) {
        candidates.push(voiced);
      }
    }
  }

  if (!candidates.length) {
    candidates.push(pcs.map((pc, index) => closestMidiForPitchClass(pc, centerMidi + index * 4)));
  }

  const score = (voicing) => {
    const intervals = verticalIntervals(voicing);
    const span = voicing.length > 1 ? voicing.at(-1) - voicing[0] : 0;
    const center = voicing.reduce((sum, midi) => sum + midi, 0) / voicing.length;
    let value = -Math.abs(center - centerMidi) * 0.16;
    value += -Math.abs(span - 14) * 0.08;
    for (const interval of intervals) {
      if (interval <= 2) {
        value -= 1.4;
      } else if ([3, 4, 5, 7].includes(interval)) {
        value += 0.35;
      } else if (interval > 12) {
        value -= 0.55;
      }
    }
    if (previous) {
      const comparable = Math.min(previous.length, voicing.length);
      let movement = 0;
      for (let i = 0; i < comparable; i += 1) {
        movement += Math.abs(voicing[i] - previous[i]);
      }
      value -= movement * 0.18;
      value += commonToneCount(previous, voicing) * 1.15;
      for (let i = 0; i < comparable; i += 1) {
        const move = Math.abs(voicing[i] - previous[i]);
        if (move === 0) {
          value += 0.75;
        } else if ([1, 2].includes(move)) {
          value += 0.55;
        } else if ([3, 4, 5].includes(move)) {
          value += 0.25;
        } else if (move >= 8) {
          value -= 0.7;
        }
      }
    }
    return value;
  };

  return candidates.reduce((best, current) => (score(current) > score(best) ? current : best), candidates[0]);
}

function bassMidiForEvent(event, centerMidi) {
  return midiAtOrBelow(event.rn.rootPc, centerMidi);
}

function chordToneLabel(event, midi) {
  const pc = mod12(midi);
  const index = event.rn.pcs.indexOf(pc);
  if (index === -1) {
    return null;
  }
  const labels = ["root", "third", "fifth", "seventh", "ninth"];
  return labels[index] ?? `tone_${index + 1}`;
}

function velocityForEvent(event, defaultVelocity) {
  let velocity = defaultVelocity + (event.tension - 0.4) * 0.18;
  if (event.cadence_chord) {
    velocity += 0.035;
  }
  if (event.flags.includes("authentic arrival") || event.flags.includes("strong final cadence")) {
    velocity += 0.04;
  }
  return Math.min(0.95, Math.max(0.35, velocity));
}

function phraseForLocalBar(plan, localBar) {
  return (
    plan.phrase_plans.find((phrase) => phrase.start_bar <= localBar && localBar < phrase.start_bar + phrase.length_bars) ??
    plan.phrase_plans.at(-1) ??
    null
  );
}

function replacePhraseEvents(allEvents, phrase, newEvents) {
  const indices = allEvents
    .map((event, index) => [event, index])
    .filter(([event]) => event.phrase_index === phrase.phrase_index)
    .map(([, index]) => index);
  if (indices.length !== newEvents.length) {
    return;
  }
  indices.forEach((index, localIndex) => {
    allEvents[index] = newEvents[localIndex];
  });
}

function cloneEvent(event) {
  return { ...event, flags: [...event.flags], rn: { ...event.rn, pcs: [...event.rn.pcs] } };
}

function verticalIntervals(midis) {
  const intervals = [];
  for (let i = 0; i < midis.length - 1; i += 1) {
    intervals.push(midis[i + 1] - midis[i]);
  }
  return intervals;
}

function commonToneCount(previous, current) {
  if (!previous) {
    return 0;
  }
  const prevSet = new Set(previous.map((midi) => mod12(midi)));
  return unique(current.map((midi) => mod12(midi))).filter((pc) => prevSet.has(pc)).length;
}

function linearProfile(length, start, end) {
  if (length <= 1) {
    return [end];
  }
  return Array.from({ length }, (_value, index) => start + ((end - start) * index) / (length - 1));
}

function sliceProfile(profile, startBar, bars, n) {
  if (n <= 0) {
    return [];
  }
  return Array.from({ length: n }, (_value, index) => {
    const position = Math.min(
      profile.length - 1,
      Math.max(0, Math.round(startBar - 1 + ((bars - 1) * index) / Math.max(1, n - 1))),
    );
    return profile[position];
  });
}

function beatsToSeconds(beats, bpm) {
  return (beats * 60) / bpm;
}

function round(value, places) {
  const multiplier = 10 ** places;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function unique(values) {
  return [...new Set(values)];
}

function mod12(value) {
  return ((Number(value) % 12) + 12) % 12;
}

function cryptoRandomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const data = new Uint32Array(1);
    globalThis.crypto.getRandomValues(data);
    return data[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

class SeededRandom {
  constructor(seed) {
    this.state = hashSeed(seed);
  }

  random() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  choice(items) {
    return items[Math.floor(this.random() * items.length)];
  }

  shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

function hashSeed(seed) {
  const text = String(seed ?? 0);
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
