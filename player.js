// Playback: paces sentences word by word to a sink. The sink is the seam where
// a Tatum hook, Braille display, or sign animation will plug in later:
//   sink.word(w)       one word (one sign) at a time
//   sink.endSentence() sentence boundary

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ConsoleSink {
  constructor(out = process.stdout) {
    this.out = out;
    this.first = true;
  }
  word(w) {
    this.out.write((this.first ? '' : ' ') + w);
    this.first = false;
  }
  endSentence() {
    this.out.write('\n');
    this.first = true;
  }
}

export class RecordingSink {
  constructor() { this.sentences = []; this.cur = []; }
  word(w) { this.cur.push(w); }
  endSentence() { this.sentences.push(this.cur.join(' ')); this.cur = []; }
}

export class Player {
  constructor({ sink, wordMs = 600, sentenceMs = 1000, instant = false } = {}) {
    this.sink = sink;
    this.wordMs = wordMs;
    this.sentenceMs = sentenceMs;
    this.instant = instant;
    this.speed = 1;
    this.last = [];
  }

  async play(sentences, { reverse = false, remember = true } = {}) {
    if (remember) this.last = sentences;
    // "Reverse" steps backward by sentence; words inside a sentence stay in
    // order, since reversed words would not be readable.
    const seq = reverse ? [...sentences].reverse() : sentences;
    for (const s of seq) {
      for (const w of s.split(/\s+/).filter(Boolean)) {
        this.sink.word(w);
        if (!this.instant) await sleep(this.wordMs / this.speed);
      }
      this.sink.endSentence();
      if (!this.instant) await sleep(this.sentenceMs / this.speed);
    }
  }

  repeat() { return this.play(this.last, { remember: false }); }
  reverse() { return this.play(this.last, { reverse: true, remember: false }); }

  slower() { this.speed = Math.max(0.25, this.speed * 0.75); return this.speed; }
  faster() { this.speed = Math.min(4, this.speed / 0.75); return this.speed; }
}
