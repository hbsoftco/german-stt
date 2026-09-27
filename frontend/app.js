(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const fileInput = $("file");
  const submitBtn = $("submit");
  const statusBox = $("status");
  const statusText = $("status-text");
  const progress = $("progress");
  const errorBox = $("error");
  const resultBox = $("result");
  const player = $("player");
  const subtitleText = $("subtitle-text");
  const timeline = $("timeline");

  let segments = [];
  let srtText = "";
  let srtName = "transcript.srt";
  let audioUrl = null;
  let vttUrl = null;
  let activeIndex = -1;
  let rafId = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- formatting ---------- */

  const pad = (n, width) => String(n).padStart(width, "0");

  // seconds -> HH:MM:SS<sep>mmm  (sep "," for SRT, "." for WebVTT)
  function formatTimestamp(seconds, sep) {
    const totalMs = Math.max(0, Math.round(seconds * 1000));
    const ms = totalMs % 1000;
    const s = Math.floor(totalMs / 1000) % 60;
    const m = Math.floor(totalMs / 60000) % 60;
    const h = Math.floor(totalMs / 3600000);
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(ms, 3)}`;
  }

  function buildSrt(segs) {
    return segs
      .map((seg, i) =>
        `${i + 1}\n${formatTimestamp(seg.start, ",")} --> ${formatTimestamp(seg.end, ",")}\n${seg.text}\n`
      )
      .join("\n");
  }

  function escapeVtt(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function buildVtt(segs) {
    const cues = segs.map((seg) =>
      `${formatTimestamp(seg.start, ".")} --> ${formatTimestamp(seg.end, ".")}\n${escapeVtt(seg.text)}\n`
    );
    return `WEBVTT\n\n${cues.join("\n")}`;
  }

  function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${pad(s, 2)} (${seconds.toFixed(1)} s)`;
  }

  // Timeline label: mm:ss, or h:mm:ss for long audio
  function formatClock(seconds) {
    const t = Math.floor(seconds);
    const h = Math.floor(t / 3600);
    const m = Math.floor(t / 60) % 60;
    const s = t % 60;
    return h ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${pad(m, 2)}:${pad(s, 2)}`;
  }

  /* ---------- UI state ---------- */

  function setBusy(busy) {
    submitBtn.disabled = busy;
    fileInput.disabled = busy;
    statusBox.hidden = !busy;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  /* ---------- upload ---------- */

  function transcribe(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/transcribe");
      xhr.responseType = "json";

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        progress.value = (e.loaded / e.total) * 100;
        statusText.textContent = `Uploading… ${Math.round(progress.value)}%`;
      };
      xhr.upload.onload = () => {
        progress.removeAttribute("value"); // indeterminate while the server works
        statusText.textContent = "Transcribing… this can take a while for long files";
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
          resolve(xhr.response);
        } else {
          const detail = xhr.response && xhr.response.detail;
          reject(new Error(detail || `Server returned ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("Network error or server unavailable"));

      const data = new FormData();
      data.append("file", file);
      xhr.send(data);
    });
  }

  /* ---------- player / subtitles ---------- */

  function resetPlayer() {
    stopSync();
    player.pause();
    player.querySelectorAll("track").forEach((t) => t.remove());
    player.removeAttribute("src");
    player.load();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (vttUrl) URL.revokeObjectURL(vttUrl);
    audioUrl = vttUrl = null;
    activeIndex = -1;
    showSubtitle("");
  }

  function attachMedia(file) {
    audioUrl = URL.createObjectURL(file);
    player.src = audioUrl;

    vttUrl = URL.createObjectURL(new Blob([buildVtt(segments)], { type: "text/vtt" }));
    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = "Deutsch";
    track.srclang = "de";
    track.src = vttUrl;
    track.default = true;
    player.appendChild(track);
    // Audio elements draw no native captions; our overlay renders the text instead.
    track.addEventListener("load", () => { track.track.mode = "hidden"; });
    track.track.mode = "hidden";
  }

  function showSubtitle(text) {
    if (!text) {
      subtitleText.classList.remove("show");
      return;
    }
    if (subtitleText.textContent !== text) {
      subtitleText.classList.remove("show");
      subtitleText.textContent = text;
      void subtitleText.offsetWidth; // restart the transition
    }
    subtitleText.classList.add("show");
  }

  // Index of the segment playing at time t, or -1 (binary search on start times).
  function findSegment(t) {
    let lo = 0;
    let hi = segments.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start <= t) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return found >= 0 && t < segments[found].end ? found : -1;
  }

  function setActive(index) {
    if (index === activeIndex) return;
    const prev = timeline.children[activeIndex];
    if (prev) prev.firstElementChild.classList.remove("active");
    activeIndex = index;
    const item = timeline.children[index];
    if (item) {
      const row = item.firstElementChild;
      row.classList.add("active");
      centerInTimeline(row);
    }
    showSubtitle(index >= 0 ? segments[index].text : "");
  }

  // Center `el` in the timeline's visible area. Uses the element's real position
  // relative to the scroll container (offsetTop would be relative to the page here,
  // since the timeline isn't a positioned ancestor). Scrolls only the container.
  function centerInTimeline(el) {
    const containerRect = timeline.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const target =
      timeline.scrollTop +
      (elRect.top - containerRect.top - timeline.clientTop) -
      timeline.clientHeight / 2 +
      elRect.height / 2;
    const max = timeline.scrollHeight - timeline.clientHeight;
    timeline.scrollTo({
      top: Math.min(Math.max(target, 0), max),
      behavior: reducedMotion.matches ? "auto" : "smooth",
    });
  }

  function sync() {
    setActive(findSegment(player.currentTime));
  }

  function tick() {
    sync();
    rafId = requestAnimationFrame(tick);
  }
  function startSync() { if (rafId === null) tick(); }
  function stopSync() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function renderTimeline() {
    timeline.replaceChildren(
      ...segments.map((seg, i) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "seg";
        btn.dataset.index = i;
        const time = document.createElement("time");
        time.textContent = formatClock(seg.start);
        const text = document.createElement("span");
        text.textContent = seg.text;
        btn.append(time, text);
        li.appendChild(btn);
        return li;
      })
    );
    timeline.scrollTop = 0;
  }

  timeline.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    player.currentTime = segments[Number(btn.dataset.index)].start;
    player.play().catch(() => {});
    sync();
  });

  player.addEventListener("play", startSync);
  player.addEventListener("pause", () => { stopSync(); sync(); });
  player.addEventListener("ended", () => { stopSync(); sync(); });
  player.addEventListener("seeked", sync);

  /* ---------- events ---------- */

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    errorBox.hidden = true;
    resultBox.hidden = true;
    resetPlayer();
    progress.value = 0;
    statusText.textContent = "Uploading… 0%";
    setBusy(true);

    try {
      const res = await transcribe(file);
      segments = res.segments;
      srtText = buildSrt(segments);
      srtName = file.name.replace(/\.[^.]+$/, "") + ".srt";

      $("language").textContent = res.language;
      $("duration").textContent = formatDuration(res.duration);
      renderTimeline();
      attachMedia(file);
      resultBox.hidden = false;
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
    }
  });

  $("download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([srtText], { type: "application/x-subrip;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = srtName;
    a.click();
    URL.revokeObjectURL(url);
  });
})();
