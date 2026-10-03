(() => {
  const STORAGE_KEY = "typing-game-settings-v1";

  const CATEGORIES = [
    {
      id: "python",
      label: "Pythonの単語と記号",
      hint: "def、return、self.、: など",
    },
    {
      id: "symbol",
      label: "記号",
      hint: "! @ # や ==、-> など",
    },
    {
      id: "japanese",
      label: "日本語の単語",
      hint: "ひらがなのまま入力",
    },
    {
      id: "english",
      label: "英語の単語",
      hint: "日常で使う英単語",
    },
    {
      id: "number",
      label: "数字",
      hint: "0〜9の5桁",
    },
  ];

  const DEFAULT_SETTINGS = {
    python: 3,
    symbol: 3,
    japanese: 3,
    english: 3,
    number: 3,
  };

  const screens = {
    start: document.querySelector("#screen-start"),
    settings: document.querySelector("#screen-settings"),
    game: document.querySelector("#screen-game"),
    result: document.querySelector("#screen-result"),
  };

  const input = document.querySelector("#type-input");
  const promptEl = document.querySelector("#prompt");
  const categoryEl = document.querySelector("#category-label");
  const gainEl = document.querySelector("#gain");
  const settingsList = document.querySelector("#settings-list");

  const state = {
    settings: loadSettings(),
    current: null,
    lastText: "",
    score: 0,
    combo: 0,
    maxCombo: 0,
    cleared: 0,
    correctChars: 0,
    typos: 0,
    startedAt: null,
    finishedAt: null,
    timerId: null,
    prevConfirmed: "",
    acceptedText: null,
    editGeneration: 0,
    composing: false,
    playing: false,
    focusMode: false,
    focusWeights: null,
    charStats: {},
    sessionStats: {},
    charClock: null,
  };

  document.querySelector("#btn-start").addEventListener("click", () => startGame(false));
  document.querySelector("#btn-settings").addEventListener("click", openSettings);
  document.querySelector("#btn-settings-back").addEventListener("click", () => show("start"));
  document.querySelector("#btn-settings-reset").addEventListener("click", resetSettings);
  document.querySelector("#btn-end").addEventListener("click", finishGame);
  document.querySelector("#btn-retry").addEventListener("click", () => startGame(false));
  document.querySelector("#btn-focus").addEventListener("click", startFocusGame);
  document.querySelector("#btn-menu").addEventListener("click", () => show("start"));

  input.addEventListener("compositionstart", () => {
    state.composing = true;
  });

  input.addEventListener("compositionend", () => {
    state.composing = false;
    onConfirmedInput();
  });

  input.addEventListener("input", (event) => {
    renderPrompt();
    if (state.composing || event.isComposing) return;
    onConfirmedInput();
  });

  input.addEventListener("paste", (event) => {
    event.preventDefault();
  });

  document.addEventListener("keydown", (event) => {
    if (!state.playing) return;
    if (event.key === " " && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });

  renderSettings();

  function loadSettings() {
    const settings = { ...DEFAULT_SETTINGS, custom: "" };
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return settings;
      for (const id of Object.keys(DEFAULT_SETTINGS)) {
        const value = Number(raw[id]);
        if (Number.isInteger(value) && value >= 0 && value <= 5) settings[id] = value;
      }
      if (typeof raw.custom === "string") settings.custom = raw.custom;
    } catch {
      return { ...DEFAULT_SETTINGS, custom: "" };
    }
    return settings;
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  }

  function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS, custom: "" };
    saveSettings();
    renderSettings();
  }

  function customEntries() {
    return String(state.settings.custom || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function customWeight() {
    return customEntries().length > 0 ? 3 : 0;
  }

  function canStart() {
    return CATEGORIES.some((category) => state.settings[category.id] > 0) || customEntries().length > 0;
  }

  function renderSettings() {
    settingsList.replaceChildren();
    for (const category of CATEGORIES) {
      const row = document.createElement("article");
      row.className = "setting-row";

      const title = document.createElement("h2");
      title.textContent = category.label;

      const hint = document.createElement("p");
      hint.textContent = category.hint;

      const levels = document.createElement("div");
      levels.className = "levels";
      levels.setAttribute("role", "group");
      levels.setAttribute("aria-label", `${category.label}の頻出度`);

      for (let level = 0; level <= 5; level += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "level";
        button.textContent = String(level);
        const selected = state.settings[category.id];
        button.classList.toggle("on", level > 0 && level <= selected);
        button.classList.toggle("picked", level === selected);
        button.setAttribute("aria-pressed", String(level === selected));
        button.addEventListener("click", () => {
          state.settings[category.id] = level;
          saveSettings();
          renderSettings();
        });
        levels.append(button);
      }

      row.append(title, hint, levels);
      settingsList.append(row);
    }

    const customRow = document.createElement("article");
    customRow.className = "setting-row";

    const customTitle = document.createElement("h2");
    customTitle.textContent = "カスタム";

    const customHint = document.createElement("p");
    customHint.textContent = "1行につき1問。頻度をすべて0にしても、ここにあれば出題されます。";

    const customField = document.createElement("textarea");
    customField.className = "custom-field";
    customField.rows = 5;
    customField.spellcheck = false;
    customField.placeholder = "例）\n!=\nこんにちは";
    customField.value = state.settings.custom || "";
    customField.setAttribute("aria-label", "カスタムの出題");
    customField.addEventListener("input", () => {
      state.settings.custom = customField.value;
      saveSettings();
    });

    customRow.append(customTitle, customHint, customField);
    settingsList.append(customRow);
  }

  function openSettings() {
    document.querySelector("#start-notice").hidden = true;
    renderSettings();
    show("settings");
  }

  function show(name) {
    state.playing = name === "game";
    for (const [key, screen] of Object.entries(screens)) {
      const active = key === name;
      screen.classList.toggle("active", active);
      screen.hidden = !active;
    }
    if (name !== "game") input.blur();
  }

  function startGame(focus = false) {
    state.editGeneration += 1;
    const notice = document.querySelector("#start-notice");
    if (!canStart()) {
      notice.hidden = false;
      if (screens.result.classList.contains("active")) {
        const resultNotice = document.querySelector("#result-notice");
        resultNotice.hidden = false;
        resultNotice.textContent = "設定で、どれか1つは1以上にするか、カスタムに文字を入力してください。";
      }
      return;
    }
    notice.hidden = true;

    clearInterval(state.timerId);
    state.timerId = null;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.cleared = 0;
    state.correctChars = 0;
    state.typos = 0;
    state.startedAt = null;
    state.finishedAt = null;
    state.lastText = "";
    state.prevConfirmed = "";
    state.acceptedText = null;
    state.charStats = {};
    state.charClock = performance.now();
    state.focusMode = Boolean(focus);
    if (!focus) state.focusWeights = null;
    state.current = pickEntry();
    input.value = "";
    show("game");
    applyInputMode();
    renderPrompt();
    updateHud();
    input.focus();
  }

  function startFocusGame() {
    const weights = buildWeakWeights(state.sessionStats);
    const notice = document.querySelector("#result-notice");
    if (weights.size === 0) {
      notice.hidden = false;
      notice.textContent = "この回では、苦手な文字がまだありません。";
      return;
    }
    notice.hidden = true;
    state.focusWeights = weights;
    startGame(true);
  }

  function finishGame() {
    if (!state.playing && !screens.game.classList.contains("active")) return;
    state.finishedAt = state.startedAt ? Date.now() : state.startedAt;
    clearInterval(state.timerId);
    state.timerId = null;
    state.playing = false;
    document.querySelector("#result-score").textContent = String(state.score);
    document.querySelector("#result-cleared").textContent = String(state.cleared);
    document.querySelector("#result-acc").textContent = `${accuracy()}%`;
    document.querySelector("#result-combo").textContent = String(state.maxCombo);
    document.querySelector("#result-cpm").textContent = String(cpm());
    document.querySelector("#result-time").textContent = formatTime(elapsedMs());
    state.sessionStats = snapshotStats(state.charStats);
    document.querySelector("#result-notice").hidden = true;
    show("result");
  }

  function pickEntry() {
    const extra = customWeight();
    const total = CATEGORIES.reduce((sum, category) => sum + state.settings[category.id], 0) + extra;
    if (total <= 0) return null;

    if (state.focusMode && state.focusWeights && state.focusWeights.size > 0) {
      const focused = pickFocusEntry();
      if (focused) return focused;
    }

    let roll = Math.random() * total;
    let chosen = null;
    for (const category of CATEGORIES) {
      if (state.settings[category.id] <= 0) continue;
      roll -= state.settings[category.id];
      if (roll < 0) {
        chosen = category.id;
        break;
      }
    }
    if (!chosen && extra > 0) chosen = "custom";
    if (!chosen) {
      const fallback = CATEGORIES.find((category) => state.settings[category.id] > 0);
      chosen = fallback ? fallback.id : "custom";
    }

    let text;
    let guard = 0;
    if (chosen === "custom") {
      const bank = customEntries();
      text = bank[Math.floor(Math.random() * bank.length)];
      while (text === state.lastText && bank.length > 1 && guard < 8) {
        text = bank[Math.floor(Math.random() * bank.length)];
        guard += 1;
      }
    } else if (chosen === "number") {
      text = randomNumber();
      while (text === state.lastText && guard < 8) {
        text = randomNumber();
        guard += 1;
      }
    } else {
      const bank = window.WORD_BANK[chosen];
      text = bank[Math.floor(Math.random() * bank.length)];
      while (text === state.lastText && bank.length > 1 && guard < 8) {
        text = bank[Math.floor(Math.random() * bank.length)];
        guard += 1;
      }
    }
    state.lastText = text;
    return { category: chosen, text };
  }

  function randomNumber() {
    let text = "";
    for (let i = 0; i < 5; i += 1) {
      text += String(Math.floor(Math.random() * 10));
    }
    return text;
  }

  function pickFocusEntry() {
    const pool = [];
    for (const category of CATEGORIES) {
      if (state.settings[category.id] <= 0) continue;
      const texts = category.id === "number" ? focusedNumbers() : window.WORD_BANK[category.id];
      for (const text of texts) {
        const score = scoreText(text);
        if (score > 0) pool.push({ category: category.id, text, score });
      }
    }
    for (const text of customEntries()) {
      const score = scoreText(text);
      if (score > 0) pool.push({ category: "custom", text, score });
    }
    if (pool.length === 0) return null;

    let choice = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      choice = weightedPick(pool);
      if (choice.text !== state.lastText || pool.length === 1) break;
    }
    state.lastText = choice.text;
    return { category: choice.category, text: choice.text };
  }

  function focusedNumbers() {
    const digits = [...state.focusWeights.keys()].filter((ch) => ch >= "0" && ch <= "9");
    const samples = [];
    for (let sample = 0; sample < 36; sample += 1) {
      let text = "";
      for (let i = 0; i < 5; i += 1) {
        if (digits.length > 0 && Math.random() < 0.75) {
          text += digits[Math.floor(Math.random() * digits.length)];
        } else {
          text += String(Math.floor(Math.random() * 10));
        }
      }
      samples.push(text);
    }
    return samples;
  }

  function scoreText(text) {
    let score = 0;
    for (const ch of Array.from(text)) {
      const weight = state.focusWeights.get(ch) || 0;
      if (weight > 0) score += weight;
    }
    return score;
  }

  function weightedPick(pool) {
    const total = pool.reduce((sum, item) => sum + item.score, 0);
    let roll = Math.random() * total;
    for (const item of pool) {
      roll -= item.score;
      if (roll < 0) return item;
    }
    return pool[pool.length - 1];
  }

  function snapshotStats(stats) {
    const copy = {};
    for (const [ch, stat] of Object.entries(stats)) {
      copy[ch] = { misses: stat.misses, count: stat.count, totalTime: stat.totalTime };
    }
    return copy;
  }

  function statFor(ch) {
    if (!state.charStats[ch]) state.charStats[ch] = { misses: 0, count: 0, totalTime: 0 };
    return state.charStats[ch];
  }

  function buildWeakWeights(stats) {
    const entries = Object.entries(stats).filter(([, stat]) => stat.misses > 0 || stat.count > 0);
    const averages = entries
      .filter(([, stat]) => stat.count > 0)
      .map(([, stat]) => stat.totalTime / stat.count)
      .sort((a, b) => a - b);
    const median = averages[Math.floor(averages.length / 2)] || 0;
    const slowLine = Math.max(median * 1.5, 700);
    const weights = [];
    for (const [ch, stat] of entries) {
      const average = stat.count > 0 ? stat.totalTime / stat.count : 0;
      let weight = stat.misses * 4;
      if (stat.count > 0 && average >= slowLine) weight += average / Math.max(slowLine, 1);
      if (weight > 0) weights.push([ch, weight]);
    }
    weights.sort((a, b) => b[1] - a[1]);
    return new Map(weights.slice(0, 10));
  }

  function recordTiming(prev, next, target) {
    const targetChars = Array.from(target);
    const prevMatch = prefixLength(Array.from(prev), targetChars);
    const nextChars = Array.from(next);
    const nextMatch = prefixLength(nextChars, targetChars);
    const now = performance.now();
    if (!state.charClock) state.charClock = now;

    if (nextMatch > prevMatch) {
      const added = nextMatch - prevMatch;
      const elapsed = Math.max(0, now - state.charClock) / added;
      for (let i = prevMatch; i < nextMatch; i += 1) {
        const stat = statFor(targetChars[i]);
        stat.count += 1;
        stat.totalTime += elapsed;
      }
      state.charClock = now;
    } else if (nextMatch < prevMatch) {
      state.charClock = now;
    }
  }

  function prefixLength(typedChars, targetChars) {
    let index = 0;
    while (index < typedChars.length && index < targetChars.length && typedChars[index] === targetChars[index]) {
      index += 1;
    }
    return index;
  }

  function onConfirmedInput() {
    if (!state.playing || !state.current) return;
    const typed = input.value;
    if (state.acceptedText !== null) {
      if (typed === state.acceptedText) return;
      state.acceptedText = null;
    }
    if (typed === state.prevConfirmed) return;

    ensureTimer();
    recordTiming(state.prevConfirmed, typed, state.current.text);
    const missed = registerTypos(state.prevConfirmed, typed, state.current.text);
    state.prevConfirmed = typed;
    renderPrompt();
    updateHud();

    if (missed) scheduleShake();

    if (typed === state.current.text) succeed();
  }

  function deferClear(expected) {
    const generation = ++state.editGeneration;
    setTimeout(() => {
      if (!state.playing || state.editGeneration !== generation) return;
      if (input.value === expected) {
        input.value = "";
        state.prevConfirmed = "";
      }
      state.acceptedText = null;
      state.charClock = performance.now();
      applyInputMode();
      renderPrompt();
      if (document.activeElement !== input) input.focus();
    }, 0);
  }

  function scheduleShake() {
    requestAnimationFrame(() => {
      if (!state.playing) return;
      input.classList.remove("shake");
      requestAnimationFrame(() => {
        if (!state.playing) return;
        input.classList.add("shake");
      });
    });
  }

  function registerTypos(prev, next, target) {
    const prevChars = Array.from(prev);
    const nextChars = Array.from(next);
    const targetChars = Array.from(target);
    if (nextChars.length < prevChars.length) return false;

    let missed = false;
    for (let i = 0; i < nextChars.length; i += 1) {
      const changed = prevChars[i] !== nextChars[i];
      if (changed && nextChars[i] !== targetChars[i]) {
        state.typos += 1;
        missed = true;
        if (targetChars[i]) statFor(targetChars[i]).misses += 1;
      }
    }
    if (missed) state.combo = 0;
    return missed;
  }

  function succeed() {
    const chars = Array.from(state.current.text).length;
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.cleared += 1;
    state.correctChars += chars;
    const gain = chars * 10 + (state.combo - 1) * 5;
    state.score += gain;
    showGain(gain);
    const finished = state.current.text;
    state.acceptedText = finished;
    state.current = pickEntry();
    state.prevConfirmed = "";
    updateHud();
    deferClear(finished);
  }

  function renderPrompt() {
    const target = state.current ? state.current.text : "";
    const typed = input.value;
    const targetChars = Array.from(target);
    const typedChars = Array.from(typed);
    const category = CATEGORIES.find((item) => item.id === state.current?.category);
    const label = state.current?.category === "custom" ? "カスタム" : category?.label;

    categoryEl.textContent = label || "";
    updateFocusLabel();
    promptEl.classList.toggle("long", targetChars.length > 18);
    promptEl.replaceChildren();

    targetChars.forEach((ch, index) => {
      const span = document.createElement("span");
      span.className = "char";
      if (index < typedChars.length) {
        span.classList.add(typedChars[index] === ch ? "ok" : "bad");
      } else if (index === typedChars.length) {
        span.classList.add("current");
      }
      span.textContent = ch === " " ? "\u00a0" : ch;
      promptEl.append(span);
    });

    typedChars.slice(targetChars.length).forEach((ch) => {
      const span = document.createElement("span");
      span.className = "char bad";
      span.textContent = ch;
      promptEl.append(span);
    });

    input.setAttribute("aria-label", `${label || "問題"}: ${target}`);
  }

  function updateFocusLabel() {
    const label = document.querySelector("#focus-label");
    if (!state.focusMode || !state.focusWeights || state.focusWeights.size === 0) {
      label.hidden = true;
      label.textContent = "";
      return;
    }
    const chars = [...state.focusWeights.keys()];
    label.hidden = false;
    label.textContent = `苦手な文字: ${chars.join(" ")}`;
  }

  function applyInputMode() {
    const category = state.current?.category;
    const text = state.current?.text || "";
    const japanese = category === "japanese" || (category === "custom" && /[\u3040-\u30ff\u4e00-\u9fff]/.test(text));
    input.lang = japanese ? "ja" : "en";
    input.inputMode = category === "number" ? "numeric" : "text";
  }

  function showGain(gain) {
    gainEl.textContent = `+${gain}`;
    gainEl.classList.remove("show");
    void gainEl.offsetWidth;
    gainEl.classList.add("show");
  }

  function ensureTimer() {
    if (state.startedAt) return;
    state.startedAt = Date.now();
    state.timerId = setInterval(updateHud, 200);
  }

  function elapsedMs() {
    if (!state.startedAt) return 0;
    const end = state.finishedAt || Date.now();
    return Math.max(0, end - state.startedAt);
  }

  function accuracy() {
    const total = state.correctChars + state.typos;
    if (total === 0) return 100;
    return Math.round((state.correctChars / total) * 100);
  }

  function cpm() {
    const minutes = elapsedMs() / 60000;
    if (minutes <= 0 || state.correctChars === 0) return 0;
    return Math.round(state.correctChars / minutes);
  }

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function updateHud() {
    document.querySelector("#hud-score").textContent = String(state.score);
    document.querySelector("#hud-combo").textContent = String(state.combo);
    document.querySelector("#hud-acc").textContent = `${accuracy()}%`;
    document.querySelector("#hud-cpm").textContent = String(cpm());
    document.querySelector("#hud-time").textContent = formatTime(elapsedMs());
  }
})();
