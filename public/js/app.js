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
  };

  document.querySelector("#btn-start").addEventListener("click", startGame);
  document.querySelector("#btn-settings").addEventListener("click", openSettings);
  document.querySelector("#btn-settings-back").addEventListener("click", () => show("start"));
  document.querySelector("#btn-settings-reset").addEventListener("click", resetSettings);
  document.querySelector("#btn-end").addEventListener("click", finishGame);
  document.querySelector("#btn-retry").addEventListener("click", startGame);
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
    const settings = { ...DEFAULT_SETTINGS };
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return settings;
      for (const id of Object.keys(DEFAULT_SETTINGS)) {
        const value = Number(raw[id]);
        if (Number.isInteger(value) && value >= 0 && value <= 5) settings[id] = value;
      }
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
    return settings;
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  }

  function resetSettings() {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    renderSettings();
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

  function startGame() {
    state.editGeneration += 1;
    const notice = document.querySelector("#start-notice");
    if (!CATEGORIES.some((category) => state.settings[category.id] > 0)) {
      notice.hidden = false;
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
    state.current = pickEntry();
    input.value = "";
    show("game");
    applyInputMode();
    renderPrompt();
    updateHud();
    input.focus();
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
    show("result");
  }

  function pickEntry() {
    const total = CATEGORIES.reduce((sum, category) => sum + state.settings[category.id], 0);
    if (total <= 0) return null;
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
    if (!chosen) {
      chosen = CATEGORIES.find((category) => state.settings[category.id] > 0).id;
    }

    let text;
    let guard = 0;
    if (chosen === "number") {
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

  function onConfirmedInput() {
    if (!state.playing || !state.current) return;
    const typed = input.value;
    if (state.acceptedText !== null) {
      if (typed === state.acceptedText) return;
      state.acceptedText = null;
    }
    if (typed === state.prevConfirmed) return;

    ensureTimer();
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

    categoryEl.textContent = category ? category.label : "";
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

    input.setAttribute("aria-label", `${category ? category.label : "問題"}: ${target}`);
  }

  function applyInputMode() {
    const category = state.current?.category;
    input.lang = category === "japanese" ? "ja" : "en";
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
