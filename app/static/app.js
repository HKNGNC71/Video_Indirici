(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const state = {
    mode: "video",
    quality: { video: "best", audio: "m4a" },
    jobs: [],
    library: [],
    cookies: { exists: false },
    seenCompleted: new Set(),
    firstJobsLoad: true,
    libraryDirty: true,
    pollTimer: null,
    busy: false,
  };

  const els = {
    urls: $("#urls"),
    downloadBtn: $("#download-btn"),
    dlHint: $("#dl-hint"),
    openFolder: $("#open-folder"),
    pasteBtn: $("#paste-btn"),
    playlist: $("#playlist"),
    useCookies: $("#use-cookies"),
    jobs: $("#jobs"),
    clearJobs: $("#clear-jobs"),
    library: $("#library"),
    libCount: $("#lib-count"),
    statusBadge: $("#status-badge"),
    cookieState: $("#cookie-state"),
    cookieFile: $("#cookie-file"),
    cookieUpload: $("#cookie-upload"),
    cookieRemove: $("#cookie-remove"),
    toasts: $("#toasts"),
    videoChips: $("#video-chips"),
    audioChips: $("#audio-chips"),
  };

  function icon(paths) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    paths.forEach((d) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    });
    return svg;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function toast(message, kind = "") {
    const node = el("div", "toast" + (kind ? " " + kind : ""), message);
    els.toasts.appendChild(node);
    setTimeout(() => {
      node.style.opacity = "0";
      node.style.transition = "opacity 0.25s ease";
      setTimeout(() => node.remove(), 260);
    }, 4200);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 1) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, index);
    return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
  }

  function formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond) return "";
    return `${formatBytes(bytesPerSecond)}/s`;
  }

  function formatEta(seconds) {
    if (!seconds && seconds !== 0) return "";
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins < 60) return `${mins}m ${secs}s left`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m left`;
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function formatLabel(job) {
    if (job.mode === "audio") return job.quality === "mp3" ? "MP3 192 kbps" : "M4A audio";
    if (job.quality === "best") return "MP4 best quality";
    return `MP4 ${job.quality}p`;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (error) {
      return "";
    }
  }

  function platformIcon(url) {
    if (/instagram/i.test(url)) {
      return icon([
        "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z",
        "M16 11.37a4 4 0 1 1-7.9 1.26 4 4 0 0 1 7.9-1.26Z",
        "M17.5 6.5h.01",
      ]);
    }
    return icon(["M8 5v14l11-7L8 5Z"]);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    if (!response.ok) {
      const message = (payload && payload.error) || `Request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  function updateStatusBadge(health) {
    els.statusBadge.classList.remove("is-live", "is-bad");
    if (health.ffmpeg) {
      els.statusBadge.textContent = "ready";
      els.statusBadge.classList.add("is-live");
    } else {
      els.statusBadge.textContent = "ffmpeg missing";
      els.statusBadge.classList.add("is-bad");
      els.dlHint.textContent = "ffmpeg was not detected - merged videos and audio conversion may fail.";
    }
  }

  function renderJobs() {
    const container = els.jobs;
    container.replaceChildren();

    if (!state.jobs.length) {
      container.appendChild(el("div", "empty", "No downloads yet. Paste a link above to get started."));
      return;
    }

    state.jobs.forEach((job) => {
      const card = el("div", "job");

      const thumb = el("div", "job-thumb");
      if (job.thumbnail) {
        const img = document.createElement("img");
        img.src = job.thumbnail;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => {
          img.remove();
          thumb.appendChild(platformIcon(job.url));
        });
        thumb.appendChild(img);
      } else {
        thumb.appendChild(platformIcon(job.url));
      }

      const main = el("div", "job-main");
      const top = el("div", "job-top");
      const title = el("div", "job-title", job.title || job.url);
      title.title = job.title || job.url;
      const badge = el("span", "state " + job.status, job.status);
      top.append(title, badge);
      main.appendChild(top);
      main.appendChild(el("div", "job-url", hostOf(job.url) + " · " + formatLabel(job)));

      const meta = el("div", "job-meta");
      if (job.total_bytes) meta.appendChild(el("span", formatBytes(job.total_bytes)));
      if (job.status === "downloading" && job.speed) meta.appendChild(el("span", formatSpeed(job.speed)));
      if (job.status === "downloading" && job.eta) meta.appendChild(el("span", formatEta(job.eta)));
      if (job.status === "processing") meta.appendChild(el("span", job.stage || "Processing"));
      if (job.status === "completed" && job.stage) meta.appendChild(el("span", job.stage));
      if (job.files && job.files.length > 1) meta.appendChild(el("span", `${job.files.length} files`));
      if (meta.childNodes.length) main.appendChild(meta);

      const progress = el("div", "progress");
      const fill = el("div", "progress-fill");
      const unknownPercent = job.status === "downloading" &&
        (job.percent === null || job.percent === undefined);
      if (unknownPercent) {
        progress.classList.add("is-indeterminate");
      } else if (job.status === "downloading" && (job.percent || job.percent === 0)) {
        fill.style.width = `${Math.min(100, job.percent || 0)}%`;
      } else if (job.status === "processing" || job.status === "completed") {
        fill.style.width = "100%";
      } else if (job.status === "error" || job.status === "canceled") {
        fill.style.width = "100%";
      } else {
        fill.style.width = "0%";
      }
      if (job.status === "downloading" || job.status === "processing") progress.classList.add("is-active");
      if (job.status === "completed") fill.classList.add("is-done");
      if (job.status === "error" || job.status === "canceled") fill.classList.add("is-error");
      progress.appendChild(fill);
      main.appendChild(progress);

      if (job.error) main.appendChild(el("div", "job-error", job.error));

      const side = el("div", "job-side");
      let label = "";
      if (job.status === "downloading" && job.percent !== null && job.percent !== undefined) {
        label = `${Math.min(100, job.percent).toFixed(0)}%`;
      } else if (job.status === "completed") {
        label = "Done";
      } else if (job.status === "error") {
        label = "Failed";
      } else if (job.status === "canceled") {
        label = "Canceled";
      } else if (job.status === "processing") {
        label = "Finishing";
      } else if (job.status === "downloading") {
        label = "Working";
      } else {
        label = "Queued";
      }
      side.appendChild(el("div", "job-percent", label));

      if (job.files && job.files.length) {
        const link = document.createElement("a");
        link.className = "job-file-link";
        link.href = "/media/" + encodeURIComponent(job.files[0]);
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = job.files[0];
        link.title = job.files[0];
        side.appendChild(link);
      }

      if (job.status === "queued" || job.status === "downloading" || job.status === "processing") {
        const cancel = el("button", "btn ghost small", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => cancelJob(job.id));
        side.appendChild(cancel);
      }

      card.append(thumb, main, side);
      container.appendChild(card);
    });
  }

  function renderLibrary() {
    const container = els.library;
    container.replaceChildren();
    els.libCount.textContent = `${state.library.length} file${state.library.length === 1 ? "" : "s"}`;

    if (!state.library.length) {
      container.appendChild(el("div", "empty", "Downloaded files will appear here."));
      return;
    }

    state.library.forEach((file) => {
      const card = el("div", "lib-card");
      const preview = el("div", "lib-preview");
      const ext = (file.name.split(".").pop() || "").toLowerCase();

      if (["mp4", "webm", "mov", "m4v"].includes(ext)) {
        const video = document.createElement("video");
        video.src = file.url;
        video.controls = true;
        video.preload = "metadata";
        video.addEventListener("error", () => {
          preview.replaceChildren(fileGlyph(ext));
        });
        preview.appendChild(video);
      } else if (["m4a", "mp3", "opus", "ogg", "wav", "aac", "flac", "webma"].includes(ext)) {
        const audio = document.createElement("audio");
        audio.src = file.url;
        audio.controls = true;
        audio.preload = "metadata";
        preview.appendChild(audio);
      } else {
        preview.appendChild(fileGlyph(ext));
      }

      const body = el("div", "lib-body");
      const name = el("div", "lib-name", file.name);
      name.title = file.name;
      const meta = el("div", "lib-meta", `${formatBytes(file.size)} · ${formatDate(file.modified)}`);

      const actions = el("div", "lib-actions");
      const save = document.createElement("a");
      save.className = "btn ghost";
      save.href = file.url;
      save.download = file.name;
      save.textContent = "Save";
      const remove = el("button", "btn ghost danger", "Delete");
      remove.type = "button";
      remove.addEventListener("click", () => deleteFile(file.name));

      actions.append(save, remove);
      body.append(name, meta, actions);
      card.append(preview, body);
      container.appendChild(card);
    });
  }

  function fileGlyph(ext) {
    const wrap = el("div", "file-glyph");
    wrap.appendChild(icon(["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z", "M14 2v6h6"]));
    wrap.appendChild(el("span", null, ext ? ext.toUpperCase() : "FILE"));
    return wrap;
  }

  async function refreshJobs() {
    try {
      const jobs = await api("/api/jobs");
      state.jobs = jobs;

      jobs.forEach((job) => {
        if (job.status === "completed" && !state.seenCompleted.has(job.id)) {
          state.seenCompleted.add(job.id);
          if (!state.firstJobsLoad) {
            state.libraryDirty = true;
            toast(`Download finished: ${job.title || job.url}`, "ok");
          }
        }
      });
      state.firstJobsLoad = false;
      renderJobs();

      if (state.libraryDirty) {
        state.libraryDirty = false;
        await refreshLibrary();
      }
    } catch (error) {
      // Keep the last known state; the next poll may succeed.
    }
  }

  async function refreshLibrary() {
    try {
      state.library = await api("/api/library");
      renderLibrary();
    } catch (error) {
      // Ignore transient errors.
    }
  }

  async function refreshCookies() {
    try {
      state.cookies = await api("/api/cookies");
      els.cookieState.classList.remove("is-ok");
      if (state.cookies.exists) {
        els.cookieState.textContent = "Uploaded " + formatDate(state.cookies.updated);
        els.cookieState.classList.add("is-ok");
        els.cookieRemove.disabled = false;
      } else {
        els.cookieState.textContent = "Not uploaded";
        els.cookieRemove.disabled = true;
      }
    } catch (error) {
      // Ignore transient errors.
    }
  }

  async function refreshHealth() {
    try {
      const health = await api("/api/health");
      updateStatusBadge(health);
    } catch (error) {
      els.statusBadge.textContent = "offline";
      els.statusBadge.classList.add("is-bad");
    }
  }

  async function cancelJob(id) {
    try {
      await api(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
      await refreshJobs();
    } catch (error) {
      toast(error.message, "bad");
    }
  }

  async function deleteFile(name) {
    if (!window.confirm(`Delete "${name}" permanently?`)) return;
    try {
      await api("/api/library/" + encodeURIComponent(name), { method: "DELETE" });
      state.libraryDirty = false;
      await refreshLibrary();
      toast("File deleted.");
    } catch (error) {
      toast(error.message, "bad");
    }
  }

  function selectedQuality() {
    return state.quality[state.mode];
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".seg").forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    els.videoChips.classList.toggle("is-hidden", mode !== "video");
    els.audioChips.classList.toggle("is-hidden", mode !== "audio");
    syncChips();
  }

  function syncChips() {
    const wanted = state.mode === "video" ? els.videoChips : els.audioChips;
    wanted.querySelectorAll(".chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.quality === selectedQuality());
    });
  }

  async function startDownload() {
    if (state.busy) return;
    const urls = els.urls.value.trim();
    if (!urls) {
      els.urls.focus();
      toast("Paste at least one link first.", "bad");
      return;
    }

    state.busy = true;
    els.downloadBtn.disabled = true;
    els.dlHint.textContent = "Starting download...";

    try {
      const result = await api("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          mode: state.mode,
          quality: selectedQuality(),
          playlist: els.playlist.checked,
          use_cookies: els.useCookies.checked,
        }),
      });
      els.urls.value = "";
      els.dlHint.textContent = `${result.jobs.length} download${result.jobs.length === 1 ? "" : "s"} queued.`;
      toast(`${result.jobs.length} download${result.jobs.length === 1 ? "" : "s"} queued.`, "ok");
      await refreshJobs();
    } catch (error) {
      els.dlHint.textContent = "";
      toast(error.message, "bad");
    } finally {
      state.busy = false;
      els.downloadBtn.disabled = false;
    }
  }

  function bindEvents() {
    document.querySelectorAll(".seg").forEach((button) => {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    });

    [els.videoChips, els.audioChips].forEach((group) => {
      group.querySelectorAll(".chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          state.quality[state.mode] = chip.dataset.quality;
          syncChips();
        });
      });
    });

    els.downloadBtn.addEventListener("click", startDownload);

    els.urls.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        startDownload();
      }
    });

    els.pasteBtn.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
          toast("Clipboard is empty.");
          return;
        }
        els.urls.value = els.urls.value.trim() ? els.urls.value.trim() + "\n" + text.trim() : text.trim();
        els.urls.focus();
      } catch (error) {
        toast("Clipboard access was blocked. Paste manually with Ctrl+V.", "bad");
      }
    });

    els.openFolder.addEventListener("click", async () => {
      try {
        await api("/api/open-folder", { method: "POST" });
      } catch (error) {
        toast(error.message, "bad");
      }
    });

    els.clearJobs.addEventListener("click", async () => {
      try {
        await api("/api/jobs", { method: "DELETE" });
        state.seenCompleted.clear();
        state.firstJobsLoad = true;
        await refreshJobs();
        toast("Finished downloads cleared.");
      } catch (error) {
        toast(error.message, "bad");
      }
    });

    els.cookieUpload.addEventListener("click", () => els.cookieFile.click());
    els.cookieFile.addEventListener("change", async () => {
      const file = els.cookieFile.files && els.cookieFile.files[0];
      if (!file) return;
      const form = new FormData();
      form.append("file", file);
      try {
        await api("/api/cookies", { method: "POST", body: form });
        toast("cookies.txt saved.", "ok");
        await refreshCookies();
      } catch (error) {
        toast(error.message, "bad");
      } finally {
        els.cookieFile.value = "";
      }
    });

    els.cookieRemove.addEventListener("click", async () => {
      if (!window.confirm("Remove the saved cookies.txt?")) return;
      try {
        await api("/api/cookies", { method: "DELETE" });
        toast("Cookies removed.");
        await refreshCookies();
      } catch (error) {
        toast(error.message, "bad");
      }
    });
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(refreshJobs, 1200);
  }

  async function init() {
    bindEvents();
    syncChips();
    await Promise.all([refreshHealth(), refreshCookies()]);
    await Promise.all([refreshJobs(), refreshLibrary()]);
    startPolling();
  }

  init();
})();
