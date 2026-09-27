(() => {
  const TEMPO = 108;
  const BEAT_MS = 60_000 / TEMPO;
  const TOTAL_BEATS = 16;
  const PERFECT_WINDOW = 105;
  const GOOD_WINDOW = 215;
  const MAX_WINDOW = 305;
  const PICK_BEATS = [0, 2, 3, 5, 8, 10, 11, 13];

  const $ = (id) => document.getElementById(id);
  const els = {
    stage: $("stage"), scene: $("scene"), start: $("start-button"), sound: $("sound-toggle"),
    help: $("help-toggle"), helpModal: $("help-modal"), helpClose: $("help-close"), modalStart: $("modal-start"),
    messageKicker: $("message-kicker"), message: $("message-main"), feedback: $("feedback"), countdown: $("countdown"),
    pressHint: $("press-hint"), beats: $("beats"), beatCurrent: $("beat-current"), roundLabel: $("round-label"),
    controlCopy: $("control-copy"), score: $("score-value"), scoreCaption: $("score-caption"),
    perfect: $("perfect-count"), good: $("good-count"), miss: $("miss-count"), combo: $("combo-chip"), announcer: $("announcer"),
  };

  let state = "ready";
  let round = 0;
  let muted = false;
  let audio = null;
  let startAt = 0;
  let raf = 0;
  let lastBeat = -1;
  let feedbackTimer = 0;
  let countdownTimer = 0;
  let stats = freshStats();
  let cues = [];

  function freshStats() {
    return { perfect: 0, good: 0, miss: 0, extra: 0, points: 0, combo: 0, bestCombo: 0 };
  }

  function makeTrack() {
    els.beats.replaceChildren();
    for (let index = 0; index < TOTAL_BEATS; index += 1) {
      const cell = document.createElement("span");
      cell.className = `beat${PICK_BEATS.includes(index) ? " pick-beat" : ""}`;
      cell.setAttribute("role", "listitem");
      cell.setAttribute("aria-label", PICK_BEATS.includes(index) ? `Beat ${index + 1}, pick` : `Beat ${index + 1}`);
      cell.dataset.beat = String(index);
      els.beats.append(cell);
    }
  }

  function playTone(frequency, duration = 0.075, type = "sine", volume = 0.045, delay = 0) {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = audio.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, at);
      if (type === "sine") oscillator.frequency.exponentialRampToValueAtTime(Math.max(70, frequency * 0.72), at + duration);
      gain.gain.setValueAtTime(volume, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.01);
    } catch (error) {
      // The game still works with visual cues when Web Audio is unavailable.
    }
  }

  function playBeat(beat) {
    if (beat % 4 === 0) playTone(660, 0.085, "sine", 0.055);
    else if (PICK_BEATS.includes(beat)) playTone(520, 0.06, "triangle", 0.035);
    else playTone(370, 0.045, "sine", 0.022);
  }

  function flashFeedback(kind, label) {
    window.clearTimeout(feedbackTimer);
    els.feedback.className = `feedback ${kind}`;
    els.feedback.textContent = label;
    // Restart CSS animation even when two judgments have the same class.
    void els.feedback.offsetWidth;
    els.feedback.classList.add("show");
    feedbackTimer = window.setTimeout(() => { els.feedback.className = "feedback"; }, 820);
  }

  function flashCount(label) {
    window.clearTimeout(countdownTimer);
    els.countdown.textContent = label;
    els.countdown.className = "countdown";
    void els.countdown.offsetWidth;
    els.countdown.classList.add("show");
    countdownTimer = window.setTimeout(() => { els.countdown.className = "countdown"; }, 530);
  }

  function setCombo() {
    const count = stats.combo;
    if (count >= 8) {
      els.combo.innerHTML = "<span>✦</span> WHOLE GROVE COMBO!";
      els.combo.classList.add("active");
    } else if (count >= 3) {
      els.combo.innerHTML = `<span>✦</span> ${count} PICK STREAK — KEEP IT UP`;
      els.combo.classList.add("active");
    } else if (count > 0) {
      els.combo.innerHTML = `<span>✦</span> ${count} PICK${count === 1 ? "" : "S"} IN A ROW`;
      els.combo.classList.add("active");
    } else {
      els.combo.innerHTML = "<span>✦</span> Waiting for your first pick";
      els.combo.classList.remove("active");
    }
  }

  function resetDisplay() {
    stats = freshStats();
    cues = PICK_BEATS.map((beat) => ({ beat, judged: false }));
    lastBeat = -1;
    [...els.beats.children].forEach((cell) => {
      cell.classList.remove("current", "judged-perfect", "judged-good", "judged-miss", "stray");
    });
    els.beatCurrent.textContent = "—";
    els.score.textContent = "—";
    els.scoreCaption.textContent = "Your score will bloom here.";
    els.perfect.textContent = "0";
    els.good.textContent = "0";
    els.miss.textContent = "0";
    setCombo();
  }

  function beginRound() {
    if (state === "count-in" || state === "playing") return;
    window.cancelAnimationFrame(raf);
    round += 1;
    resetDisplay();
    state = "count-in";
    els.roundLabel.textContent = `ROUND ${String(round).padStart(2, "0")}`;
    els.messageKicker.textContent = "PIP'S COUNTING";
    els.message.textContent = "Ready… steady…";
    els.stage.classList.remove("running");
    els.scene.classList.remove("windup", "bop", "miss", "pick");
    els.pressHint.hidden = true;
    els.start.disabled = true;
    els.start.querySelector("span:first-child").textContent = "Get ready…";
    els.controlCopy.innerHTML = "Listen for the count-in";
    if (audio && audio.state === "suspended" && !muted) audio.resume();

    let count = 4;
    flashCount(String(count));
    playTone(660, 0.09, "sine", 0.05);
    const countTimer = window.setInterval(() => {
      count -= 1;
      if (count > 0) {
        flashCount(String(count));
        playTone(count === 1 ? 820 : 660, 0.09, "sine", 0.05);
      } else {
        window.clearInterval(countTimer);
        flashCount("PICK!");
        playTone(990, 0.13, "sine", 0.065);
        window.setTimeout(startPhrase, 340);
      }
    }, BEAT_MS);
    beginRound.countTimer = countTimer;
  }

  function startPhrase() {
    if (state !== "count-in") return;
    state = "playing";
    startAt = performance.now() + 240;
    lastBeat = -1;
    els.stage.classList.add("running");
    els.scene.classList.add("windup");
    els.messageKicker.textContent = "HERE THEY COME";
    els.message.textContent = "Pick on the beat!";
    els.roundLabel.textContent = "PICKING TIME";
    els.pressHint.hidden = false;
    els.start.querySelector("span:first-child").textContent = "Picking…";
    els.controlCopy.innerHTML = "<kbd>SPACE</kbd> when the berry glows";
    raf = window.requestAnimationFrame(frame);
  }

  function frame(now) {
    if (state !== "playing") return;
    const elapsed = now - startAt;
    const beat = Math.floor(elapsed / BEAT_MS);
    const within = elapsed - beat * BEAT_MS;
    if (beat !== lastBeat && beat >= 0 && beat < TOTAL_BEATS) {
      lastBeat = beat;
      els.beatCurrent.textContent = String(beat + 1).padStart(2, "0");
      [...els.beats.children].forEach((cell) => cell.classList.remove("current"));
      els.beats.children[beat].classList.add("current");
      playBeat(beat);
      if (PICK_BEATS.includes(beat)) {
        els.message.textContent = "Now! Pluck it!";
        els.scene.classList.add("bop");
        window.setTimeout(() => els.scene.classList.remove("bop"), 150);
      } else {
        els.message.textContent = beat % 4 === 3 ? "Keep the groove…" : "Listen…";
      }
    }

    const nextCue = cues.find((cue) => !cue.judged);
    if (nextCue) {
      const untilCue = nextCue.beat * BEAT_MS - elapsed;
      if (untilCue <= 245 && untilCue >= -MAX_WINDOW) els.scene.classList.add("windup");
      else els.scene.classList.remove("windup");
    }

    for (const cue of cues) {
      if (!cue.judged && elapsed > cue.beat * BEAT_MS + MAX_WINDOW) {
        cue.judged = true;
        stats.miss += 1;
        stats.combo = 0;
        els.beats.children[cue.beat].classList.add("judged-miss");
        els.miss.textContent = String(stats.miss);
        els.scene.classList.add("miss");
        flashFeedback("miss", "MISSED IT!");
        playTone(180, 0.12, "triangle", 0.035);
        setCombo();
      }
    }

    if (elapsed >= TOTAL_BEATS * BEAT_MS + MAX_WINDOW) {
      finishRound();
      return;
    }
    raf = window.requestAnimationFrame(frame);
  }

  function pick() {
    if (state === "ready" || state === "results") {
      if (state === "results") beginRound();
      return;
    }
    if (state !== "playing") return;
    const elapsed = performance.now() - startAt;
    const openCues = cues.filter((cue) => !cue.judged);
    let best = null;
    let bestOffset = Infinity;
    for (const cue of openCues) {
      const offset = elapsed - cue.beat * BEAT_MS;
      if (Math.abs(offset) < Math.abs(bestOffset)) { best = cue; bestOffset = offset; }
    }

    els.scene.classList.remove("miss", "pick");
    if (best && Math.abs(bestOffset) <= MAX_WINDOW) {
      best.judged = true;
      const cell = els.beats.children[best.beat];
      stats.combo += 1;
      stats.bestCombo = Math.max(stats.combo, stats.bestCombo);
      if (Math.abs(bestOffset) <= PERFECT_WINDOW) {
        stats.perfect += 1;
        stats.points += 1;
        cell.classList.add("judged-perfect");
        flashFeedback("perfect", "PERFECT!");
        els.announcer.textContent = "Perfect pick!";
        playTone(880, 0.11, "sine", 0.065);
      } else {
        stats.good += 1;
        stats.points += 0.72;
        cell.classList.add("judged-good");
        flashFeedback("good", bestOffset < 0 ? "A LITTLE EARLY!" : "NICE PICK!");
        els.announcer.textContent = bestOffset < 0 ? "A little early. Nice pick!" : "Nice pick!";
        playTone(720, 0.1, "sine", 0.05);
      }
      els.scene.classList.add("pick");
      window.setTimeout(() => els.scene.classList.remove("pick"), 380);
      els.perfect.textContent = String(stats.perfect);
      els.good.textContent = String(stats.good);
      setCombo();
      return;
    }

    stats.extra += 1;
    stats.combo = 0;
    setCombo();
    flashFeedback("miss", bestOffset < 0 && best ? "TOO SOON!" : "HOLD THE BEAT!");
    els.announcer.textContent = "Hold the beat for the next berry.";
    playTone(210, 0.09, "triangle", 0.025);
    const current = Math.max(0, Math.min(TOTAL_BEATS - 1, Math.floor(elapsed / BEAT_MS)));
    els.beats.children[current].classList.add("stray");
    window.setTimeout(() => els.beats.children[current]?.classList.remove("stray"), 300);
  }

  function finishRound() {
    if (state !== "playing") return;
    state = "results";
    window.cancelAnimationFrame(raf);
    els.scene.classList.remove("windup", "bop", "miss");
    els.stage.classList.remove("running");
    els.pressHint.hidden = true;
    [...els.beats.children].forEach((cell) => cell.classList.remove("current"));
    els.beatCurrent.textContent = "16";
    const percent = Math.max(0, Math.round((stats.points - stats.extra * 0.28) / PICK_BEATS.length * 100));
    const mood = percent >= 95 ? "A perfect little harvest!" : percent >= 75 ? "You found your grove groove." : percent >= 45 ? "A lovely start. One more?" : "Pip says: let's try that again!";
    const title = percent >= 95 ? "GROVE GROOVE!" : percent >= 75 ? "NICE HARVEST!" : percent >= 45 ? "GOOD GROWING!" : "KEEP PRACTICING!";
    els.score.textContent = String(percent);
    els.scoreCaption.textContent = mood;
    els.messageKicker.textContent = title;
    els.message.textContent = percent >= 75 ? "What a pick!" : "Every beat blooms.";
    els.roundLabel.textContent = "ROUND COMPLETE";
    els.start.disabled = false;
    els.start.querySelector("span:first-child").textContent = "Play again";
    els.controlCopy.innerHTML = `Best streak: <strong>${stats.bestCombo}</strong> · Press <kbd>SPACE</kbd> to play again`;
    els.announcer.textContent = `${title} Score ${percent} percent. ${stats.perfect} perfect, ${stats.good} close, ${stats.miss} missed.`;
    if (percent >= 75) {
      flashFeedback("perfect", "NICE HARVEST!");
      playTone(880, .13, "sine", .045, 0);
      playTone(1100, .17, "sine", .04, .12);
      playTone(1320, .22, "sine", .035, .24);
    } else {
      flashFeedback("good", "ROUND COMPLETE!");
      playTone(660, .14, "sine", .035);
      playTone(790, .18, "sine", .03, .13);
    }
  }

  function toggleHelp(show) {
    els.helpModal.hidden = !show;
    if (show) els.helpClose.focus();
    else els.help.focus();
  }

  els.start.addEventListener("click", beginRound);
  els.modalStart.addEventListener("click", () => { toggleHelp(false); beginRound(); });
  els.help.addEventListener("click", () => toggleHelp(true));
  els.helpClose.addEventListener("click", () => toggleHelp(false));
  els.helpModal.addEventListener("click", (event) => { if (event.target === els.helpModal) toggleHelp(false); });
  els.sound.addEventListener("click", () => {
    muted = !muted;
    els.sound.classList.toggle("muted", muted);
    els.sound.setAttribute("aria-label", muted ? "Turn sound on" : "Mute sound");
    els.sound.title = muted ? "Turn sound on" : "Mute sound";
    if (!muted && audio?.state === "suspended") audio.resume();
  });
  els.stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    if (state === "ready" || state === "results") beginRound();
    else pick();
  });
  document.addEventListener("keydown", (event) => {
    if (event.code === "Escape" && !els.helpModal.hidden) { toggleHelp(false); return; }
    if (event.code === "Space" || event.code === "Enter" || event.code === "ArrowUp") {
      if (!els.helpModal.hidden) return;
      event.preventDefault();
      if (event.repeat) return;
      if (state === "ready" || state === "results") beginRound();
      else pick();
    }
  });

  makeTrack();
})();
