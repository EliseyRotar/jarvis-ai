/* JARVIS Web HUD client.
   - Connects to /ws.
   - Streams tokens char-by-char into the Thinking panel.
   - Renders the ATE task tracker (plan / step / complete).
   - Streams clean tag-free text into the Response panel.
   - Shows tool_call / tool_result rows in the Actions panel.
   - Drives the waveform / reactor animation while JARVIS is speaking.
*/

const $ = (id) => document.getElementById(id);
const els = {
  statConn: $("stat-conn"),
  modelSelect: $("model-select"),
  modelConfirm: $("model-confirm"),
  statClock: $("stat-clock"),

  thinkStream: $("think-stream"),
  thinkState: $("think-state"),

  responseStream: $("response-stream"),
  respState: $("resp-state"),

  transcriptStream: $("transcript-stream"),
  transcriptState: $("transcript-state"),

  reactorCore: $("reactor-core"),
  reactor: document.querySelector(".reactor"),
  waveform: $("waveform"),

  actionsStream: $("actions-stream"),
  actionsState: $("actions-state"),

  taskTracker: $("task-tracker"),
  taskId: $("task-id"),
  taskGoal: $("task-goal"),
  taskElapsed: $("task-elapsed"),
  taskSteps: $("task-steps"),
  progressFill: $("progress-fill"),
  progressPct: $("progress-pct"),
  taskComplete: $("task-complete"),

  form: $("input-form"),
  input: $("input-text"),
  mic: $("mic-btn"),
};

// ── model selector ────────────────────────────────────────────────────
const MODEL_LABELS = {
  "claude-haiku-4-5":   "HAIKU 4.5",
  "claude-sonnet-4-6":  "SONNET 4.6",
  "claude-opus-4-7":    "OPUS 4.7",
};

async function loadModels() {
  try {
    const res = await fetch("/api/models");
    const data = await res.json();
    els.modelSelect.innerHTML = "";
    for (const m of (data.models || [])) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = MODEL_LABELS[m] || m.toUpperCase();
      if (m === data.active) opt.selected = true;
      els.modelSelect.appendChild(opt);
    }
  } catch (_) {}
}

function flashConfirm() {
  els.modelConfirm.classList.remove("hidden");
  setTimeout(() => els.modelConfirm.classList.add("hidden"), 1800);
}

els.modelSelect.addEventListener("change", async () => {
  const model = els.modelSelect.value;
  try {
    const res = await fetch("/api/model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await res.json();
    if (data.ok) flashConfirm();
  } catch (_) {}
});

loadModels();

// ── clock ──────────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  els.statClock.textContent =
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0");
}
setInterval(tickClock, 1000);
tickClock();

// ── waveform ───────────────────────────────────────────────────────────
const wf = els.waveform.getContext("2d");
let wfPhase = 0;
let wfAmp = 0;       // current visual amplitude
let wfTarget = 0.05; // target amplitude
function drawWave() {
  const w = els.waveform.width, h = els.waveform.height;
  wf.clearRect(0, 0, w, h);
  wfAmp += (wfTarget - wfAmp) * 0.12;
  wf.lineWidth = 1.4;
  for (let layer = 0; layer < 3; layer++) {
    wf.beginPath();
    const baseAmp = wfAmp * (1 - layer * 0.25);
    wf.strokeStyle = layer === 0
      ? "rgba(0, 200, 255, 0.85)"
      : `rgba(0, 200, 255, ${0.35 - layer * 0.1})`;
    for (let x = 0; x < w; x++) {
      const t = (x / w) * Math.PI * 4 + wfPhase + layer * 0.7;
      const noise = (Math.sin(x * 0.21 + wfPhase * 2.3) + Math.sin(x * 0.07 + wfPhase * 1.1)) * 0.5;
      const y = h / 2 + Math.sin(t) * baseAmp * h * 0.35 + noise * baseAmp * h * 0.15;
      if (x === 0) wf.moveTo(x, y); else wf.lineTo(x, y);
    }
    wf.stroke();
  }
  wfPhase += 0.07 + wfAmp * 0.15;
  requestAnimationFrame(drawWave);
}
drawWave();

// ── WebSocket ──────────────────────────────────────────────────────────
let ws = null;
let reconnectDelay = 800;

function connect() {
  const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  ws = new WebSocket(url);
  ws.onopen = () => {
    els.statConn.classList.add("linked");
    els.statConn.firstChild.replaceWith(Object.assign(document.createElement("span"), { className: "dot" }));
    els.statConn.appendChild(document.createTextNode(" LINK"));
    reconnectDelay = 800;
  };
  ws.onclose = () => {
    els.statConn.classList.remove("linked");
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 6000);
  };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    handleMessage(msg);
  };
}
connect();

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ── DOM helpers ────────────────────────────────────────────────────────
// Smart auto-scroll: only stick to the bottom if the user is already near it,
// so reading earlier text mid-stream isn't constantly yanked away.
const _stick = new WeakMap();
function _nearBottom(node) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < 120;
}
function autoscroll(node) {
  if (!_stick.has(node)) {
    _stick.set(node, true);
    node.addEventListener("scroll", () => _stick.set(node, _nearBottom(node)));
  }
  if (_stick.get(node)) node.scrollTop = node.scrollHeight;
}
function ensureCursor(parent, cls) {
  let cur = parent.querySelector("." + cls);
  if (!cur) {
    cur = document.createElement("span");
    cur.className = cls;
    parent.appendChild(cur);
  } else {
    parent.appendChild(cur); // move to end
  }
  return cur;
}
function appendText(parent, cls, text) {
  // Append before the trailing cursor (if any)
  const cursor = parent.querySelector("." + cls);
  const node = document.createTextNode(text);
  if (cursor) parent.insertBefore(node, cursor);
  else parent.appendChild(node);
  autoscroll(parent);
}

// ── transcripts ────────────────────────────────────────────────────────
function pushTranscript(text, voice) {
  const turn = document.createElement("div");
  turn.className = "turn" + (voice ? " voice" : "");
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = voice ? "VOICE › OPERATOR" : "TEXT › OPERATOR";
  const what = document.createElement("div");
  what.className = "what";
  what.textContent = text;
  turn.appendChild(who);
  turn.appendChild(what);
  els.transcriptStream.appendChild(turn);
  autoscroll(els.transcriptStream);
  els.transcriptState.textContent = voice ? "voice" : "text";
}

// ── actions panel ──────────────────────────────────────────────────────
const actionRows = new Map(); // call_id → element

function addActionRow(id, name, args) {
  const row = document.createElement("div");
  row.className = "action-item";
  row.dataset.id = id;
  const head = document.createElement("div");
  head.className = "action-head";
  const tname = document.createElement("span");
  tname.className = "tool-name";
  tname.textContent = name;
  const ttime = document.createElement("span");
  ttime.className = "tool-time";
  ttime.textContent = "running…";
  head.appendChild(tname);
  head.appendChild(ttime);
  const a = document.createElement("pre");
  a.className = "action-args";
  a.textContent = JSON.stringify(args, null, 2);
  row.appendChild(head);
  row.appendChild(a);
  els.actionsStream.appendChild(row);
  autoscroll(els.actionsStream);
  actionRows.set(id, row);
  els.actionsState.textContent = "running";
  els.actionsState.classList.add("live");
}

function completeActionRow(id, result, elapsedMs) {
  const row = actionRows.get(id);
  if (!row) return;
  const ttime = row.querySelector(".tool-time");
  if (ttime) ttime.textContent = (elapsedMs / 1000).toFixed(2) + "s";
  const ok = result && (result.ok !== false) && !(result.error);
  row.classList.add(ok ? "done" : "error");
  const out = document.createElement("pre");
  out.className = "action-result" + (ok ? "" : " err");
  let display = result;
  // shrink huge results
  try {
    display = JSON.stringify(result, null, 2);
    if (display.length > 4000) display = display.slice(0, 4000) + "\n... [truncated]";
  } catch (_) { display = String(result); }
  out.textContent = display;
  row.appendChild(out);
  autoscroll(els.actionsStream);
  els.actionsState.classList.remove("live");
  els.actionsState.textContent = ok ? "ok" : "error";
  els.actionsState.classList.toggle("err", !ok);
  els.actionsState.classList.toggle("ok", ok);
}

// ── task tracker ───────────────────────────────────────────────────────
let activeTask = null;
let taskTimer = null;

function showTask(plan) {
  activeTask = plan;
  els.taskTracker.classList.remove("hidden");
  els.taskComplete.classList.add("hidden");
  els.taskComplete.classList.remove("failed");
  els.taskId.textContent = plan.task_id || "TASK";
  els.taskGoal.textContent = plan.goal || "";
  els.progressFill.style.width = (plan.progress || 0) + "%";
  els.progressPct.textContent = (plan.progress || 0).toFixed(0) + "%";
  els.taskSteps.innerHTML = "";
  (plan.steps || []).forEach((s) => {
    const li = document.createElement("li");
    li.className = "task-step " + (s.status || "pending");
    li.dataset.n = s.n;
    li.innerHTML =
      '<span class="step-marker"></span>' +
      '<span class="step-num">' + String(s.n).padStart(2, "0") + '</span>' +
      '<span class="step-label"></span>';
    li.querySelector(".step-label").textContent = s.label;
    if (s.status === "error" && s.reason) {
      const r = document.createElement("span");
      r.className = "step-reason";
      r.textContent = s.reason;
      li.querySelector(".step-label").appendChild(r);
    }
    els.taskSteps.appendChild(li);
  });
  if (taskTimer) clearInterval(taskTimer);
  const t0 = plan.started_at ? plan.started_at * 1000 : Date.now();
  taskTimer = setInterval(() => {
    const sec = (Date.now() - t0) / 1000;
    els.taskElapsed.textContent = sec.toFixed(1) + "s";
  }, 100);
}

function updateTaskStep(plan) {
  if (!activeTask) showTask(plan);
  activeTask = plan;
  els.progressFill.style.width = (plan.progress || 0) + "%";
  els.progressPct.textContent = (plan.progress || 0).toFixed(0) + "%";
  (plan.steps || []).forEach((s) => {
    let li = els.taskSteps.querySelector('[data-n="' + s.n + '"]');
    if (!li) {
      li = document.createElement("li");
      li.dataset.n = s.n;
      li.innerHTML =
        '<span class="step-marker"></span>' +
        '<span class="step-num">' + String(s.n).padStart(2, "0") + '</span>' +
        '<span class="step-label"></span>';
      els.taskSteps.appendChild(li);
    }
    li.className = "task-step " + (s.status || "pending");
    const lbl = li.querySelector(".step-label");
    lbl.textContent = s.label;
    if (s.status === "error" && s.reason) {
      const r = document.createElement("span");
      r.className = "step-reason";
      r.textContent = s.reason;
      lbl.appendChild(r);
      li.title = s.reason;
    }
  });
}

function completeTask(plan) {
  if (taskTimer) { clearInterval(taskTimer); taskTimer = null; }
  els.taskElapsed.textContent = (plan.elapsed || 0).toFixed(1) + "s";
  els.taskComplete.classList.remove("hidden");
  els.taskComplete.classList.toggle("failed", plan.status === "failed");
  let html = '<h3>' + (plan.status === "failed" ? "TASK FAILED" : "TASK COMPLETE") + '</h3>';
  if (plan.summary) html += '<div class="summary">' + escapeHtml(plan.summary) + '</div>';
  if (plan.artifacts && plan.artifacts.length) {
    html += '<ul class="artifacts">';
    for (const a of plan.artifacts) {
      const isUrl = /^https?:\/\//i.test(a);
      html += '<li>' + (isUrl
        ? '<a href="' + a + '" target="_blank" rel="noopener">' + escapeHtml(a) + '</a>'
        : escapeHtml(a)) + '</li>';
    }
    html += '</ul>';
  }
  if (plan.issues) {
    html += '<div class="summary" style="color:var(--amber)">⚠ ' + escapeHtml(plan.issues) + '</div>';
  }
  els.taskComplete.innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// ── minimal markdown renderer (dependency-free) ────────────────────────
// Extracts code blocks first so their contents aren't mangled, escapes
// everything, then applies inline + block formatting.
function renderMarkdown(src) {
  const blocks = [];
  let s = String(src).replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push(
      '<pre class="md-code"><button class="md-copy" title="Copy">copy</button><code>' +
      escapeHtml(code.replace(/\n$/, "")) + "</code></pre>"
    );
    return "B" + i + "";
  });
  s = escapeHtml(s);
  // inline code
  s = s.replace(/`([^`\n]+)`/g, (_, c) => "<code>" + c + "</code>");
  // bold / italic / strike
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  // links
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // headings
  s = s.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
       .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
       .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
       .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
       .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
       .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  // unordered lists
  s = s.replace(/(?:^[-*]\s+.+\n?)+/gm, (m) => {
    const items = m.trim().split(/\n/).map((l) => "<li>" + l.replace(/^[-*]\s+/, "") + "</li>").join("");
    return "<ul>" + items + "</ul>";
  });
  // paragraphs / line breaks
  s = s.replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  s = "<p>" + s + "</p>";
  // restore code blocks
  s = s.replace(/B(\d+)/g, (_, i) => blocks[Number(i)]);
  return s;
}

function setMarkdown(node, src) {
  node.innerHTML = renderMarkdown(src);
  node.querySelectorAll(".md-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.parentElement.querySelector("code");
      navigator.clipboard.writeText(code ? code.textContent : "").then(() => {
        btn.textContent = "copied"; setTimeout(() => (btn.textContent = "copy"), 1500);
      });
    });
  });
}

// ── toast notifications ────────────────────────────────────────────────
function toast(message, kind = "info", ms = 3800) {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ── streaming text into thinking / response ────────────────────────────
function startThinkLive() {
  els.thinkState.textContent = "live";
  els.thinkState.classList.add("live");
  els.thinkStream.classList.add("live");
  ensureCursor(els.thinkStream, "think-cursor");
}
function endThinkLive() {
  els.thinkState.textContent = "ready";
  els.thinkState.classList.remove("live");
  els.thinkStream.classList.remove("live");
  const cur = els.thinkStream.querySelector(".think-cursor");
  if (cur) cur.remove();
}
function appendThink(text) { appendText(els.thinkStream, "think-cursor", text); }

let _respBuffer = "";   // raw text of the current response, for markdown pass
function startRespLive() {
  els.respState.textContent = "streaming";
  els.respState.classList.add("live");
  _respBuffer = "";
  // live container for plain-text streaming (fast); markdown is applied at end
  let live = els.responseStream.querySelector(".resp-live");
  if (!live) {
    live = document.createElement("span");
    live.className = "resp-live";
    els.responseStream.appendChild(live);
  }
  ensureCursor(els.responseStream, "resp-cursor");
}
function endRespLive() {
  const cur = els.responseStream.querySelector(".resp-cursor");
  if (cur) cur.remove();
  // Replace the plain-text live span with a rendered-markdown block.
  const live = els.responseStream.querySelector(".resp-live");
  if (live && _respBuffer.trim()) {
    const rendered = document.createElement("div");
    rendered.className = "resp-md";
    setMarkdown(rendered, _respBuffer);
    live.replaceWith(rendered);
  } else if (live) {
    live.remove();
  }
  _respBuffer = "";
  els.respState.textContent = "ready";
  els.respState.classList.remove("live");
}
function appendResp(text) {
  _respBuffer += text;
  const live = els.responseStream.querySelector(".resp-live");
  if (live) {
    live.textContent += text;
    autoscroll(els.responseStream);
  } else {
    appendText(els.responseStream, "resp-cursor", text);
  }
}

// ── master message handler ─────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case "ready":
      if (msg.model) {
        for (const opt of els.modelSelect.options) {
          if (opt.value === msg.model) { opt.selected = true; break; }
        }
      }
      break;
    case "model_changed":
      for (const opt of els.modelSelect.options) {
        if (opt.value === msg.model) { opt.selected = true; break; }
      }
      flashConfirm();
      toast("Model → " + (MODEL_LABELS[msg.model] || msg.model), "ok");
      break;
    case "wake":
      els.reactorCore.textContent = "WAKE";
      setTimeout(() => { if (!els.reactor.classList.contains("speaking")) els.reactorCore.textContent = "ONLINE"; }, 1200);
      break;
    case "transcript":
      pushTranscript(msg.text, !!msg.voice);
      break;
    case "turn_start":
      // clear thinking panel; keep response history, insert separator
      els.thinkStream.textContent = "";
      if (els.responseStream.textContent.trim()) {
        const sep = document.createElement("div");
        sep.className = "turn-sep";
        els.responseStream.appendChild(sep);
      }
      els.reactorCore.textContent = "THINK";
      wfTarget = 0.18;
      setStopActive(true);
      break;
    case "turn_end":
      els.reactorCore.textContent = "DONE";
      setStopActive(false);
      endRespLive();  // finalize: render the accumulated response as markdown
      break;
    case "stopped":
      endRespLive(); endThinkLive();
      els.reactor.classList.remove("speaking");
      els.reactorCore.textContent = "HALT";
      wfTarget = 0.05;
      setStopActive(false);
      toast("Turn aborted", "warn");
      setTimeout(() => { if (els.reactorCore.textContent === "HALT") els.reactorCore.textContent = "ONLINE"; }, 1500);
      break;
    case "speaking":
      if (msg.state === "start") {
        els.reactor.classList.add("speaking");
        els.reactorCore.textContent = "SPEAK";
        wfTarget = 0.92;
      } else {
        els.reactor.classList.remove("speaking");
        els.reactorCore.textContent = "ONLINE";
        wfTarget = 0.06;
      }
      break;
    case "llm_event":
      handleLlmEvent(msg.event);
      break;
    case "task_update":
      if (msg.kind === "task_plan") showTask(msg.plan);
      else if (msg.kind === "step") updateTaskStep(msg.plan);
      else if (msg.kind === "task_complete") completeTask(msg.plan);
      break;
    case "reset":
      els.thinkStream.textContent = "";
      els.responseStream.textContent = "";
      els.actionsStream.innerHTML = "";
      els.transcriptStream.innerHTML = "";
      els.taskTracker.classList.add("hidden");
      actionRows.clear();
      break;
    case "shutdown":
      els.reactorCore.textContent = "OFFLINE";
      wfTarget = 0;
      shutdownBtn.textContent = "OFFLINE";
      shutdownBtn.classList.add("offline");
      els.statConn.classList.remove("linked");
      toast("JARVIS is shutting down", "err", 6000);
      break;
    case "error":
      console.error("JARVIS error:", msg.message);
      els.respState.textContent = "ERR";
      els.respState.classList.add("err");
      toast(msg.message || "An error occurred", "err", 6000);
      break;
  }
}

function handleLlmEvent(ev) {
  switch (ev.type) {
    case "think_start":  startThinkLive(); break;
    case "think_delta":  appendThink(ev.text); break;
    case "think_end":    endThinkLive(); break;
    case "response_delta":
      if (els.respState.textContent !== "streaming") startRespLive();
      appendResp(ev.text);
      break;
    case "tool_call":
      addActionRow(ev.id, ev.name, ev.args);
      break;
    case "tool_result":
      completeActionRow(ev.id, ev.result, ev.elapsed_ms || 0);
      break;
    case "hop":
      // optional debug hint
      break;
    case "tag":
      // task_plan / task_complete already arrive separately as task_update,
      // but some other ad-hoc tags may also come through — ignore by default.
      break;
    case "step":
      // handled via task_update
      break;
    case "error":
      console.error("LLM error:", ev.message);
      break;
  }
}

// ── input ──────────────────────────────────────────────────────────────
els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  send({ type: "user_text", text, voice: false });
  els.input.value = "";
  endRespLive(); endThinkLive();
});

const stopBtn = $("stop-btn");
stopBtn.addEventListener("click", () => {
  send({ type: "stop" });
});

const shutdownBtn = $("shutdown-btn");
shutdownBtn.addEventListener("click", () => {
  if (!confirm("Shut down JARVIS completely?")) return;
  shutdownBtn.textContent = "OFFLINE";
  shutdownBtn.classList.add("offline");
  fetch("/api/shutdown", { method: "POST" }).catch(() => {});
});

// Activate/deactivate stop button based on turn state
function setStopActive(active) {
  stopBtn.classList.toggle("active", active);
}

// Mic: hold to record (uses browser MediaRecorder; raw PCM is preferred but
// MediaRecorder emits container audio; we send WebM/opus and let server decode
// — for the cleanest local path, the wake-word loop captures PCM directly.)
let recorder = null;
let recordChunks = [];
els.mic.addEventListener("mousedown", startRec);
els.mic.addEventListener("touchstart", startRec);
els.mic.addEventListener("mouseup", stopRec);
els.mic.addEventListener("touchend", stopRec);
els.mic.addEventListener("mouseleave", stopRec);

async function startRec() {
  if (recorder) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream);
    recordChunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recordChunks.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(recordChunks, { type: recorder.mimeType || "audio/webm" });
      stream.getTracks().forEach((t) => t.stop());
      recorder = null;
      // Decode in-browser → 16kHz mono PCM, send as base64
      try {
        const arrBuf = await blob.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuf = await audioCtx.decodeAudioData(arrBuf);
        const pcm = resampleTo16kMonoPCM16(audioBuf);
        const b64 = arrayBufferToBase64(pcm.buffer);
        send({ type: "user_audio_pcm", data: b64 });
      } catch (err) {
        console.error("audio decode failed", err);
      }
    };
    recorder.start();
    els.mic.classList.add("recording");
    els.mic.textContent = "REC";
  } catch (err) {
    console.error("mic failed", err);
  }
}
function stopRec() {
  if (!recorder) return;
  els.mic.classList.remove("recording");
  els.mic.textContent = "MIC";
  try { recorder.stop(); } catch (_) {}
}

function resampleTo16kMonoPCM16(audioBuf) {
  const targetRate = 16000;
  const ch0 = audioBuf.getChannelData(0);
  const ratio = audioBuf.sampleRate / targetRate;
  const outLen = Math.floor(ch0.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx), hi = Math.min(ch0.length - 1, lo + 1);
    const frac = idx - lo;
    const s = ch0[lo] * (1 - frac) + ch0[hi] * frac;
    out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  return out;
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
