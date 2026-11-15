#!/usr/bin/env python3
"""Video Indirici - local YouTube & Instagram downloader powered by yt-dlp."""

import argparse
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import quote

from flask import Flask, abort, jsonify, render_template, request, send_from_directory

try:
    import yt_dlp
except ImportError:
    print("yt-dlp is not installed. Run the Pinokio install step first.")
    sys.exit(1)

APP_DIR = Path(__file__).resolve().parent
DOWNLOAD_DIR = APP_DIR / "downloads"
DATA_DIR = APP_DIR / "data"
COOKIES_FILE = DATA_DIR / "cookies.txt"

for folder in (DOWNLOAD_DIR, DATA_DIR):
    folder.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024

JOBS = {}
JOBS_LOCK = threading.RLock()
JOB_QUEUE = queue.Queue()
JOB_TTL = 24 * 60 * 60
MAX_URLS = 25

URL_RE = re.compile(r"^https?://", re.IGNORECASE)

VIDEO_FORMATS = {
    "best": "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b",
    "1080": "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
    "720": "bv*[ext=mp4][height<=720]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/b",
    "480": "bv*[ext=mp4][height<=480]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]/b",
    "360": "bv*[ext=mp4][height<=360]+ba[ext=m4a]/bv*[height<=360]+ba/b[height<=360]/b",
}
AUDIO_CODECS = {"m4a", "mp3"}

ACTIVE_STATES = {"queued", "downloading", "processing"}
FINISHED_STATES = {"completed", "error", "canceled"}


class JobCancelled(Exception):
    pass


CANCELLED_ERRORS = (JobCancelled,)
if hasattr(yt_dlp.utils, "DownloadCancelled"):
    CANCELLED_ERRORS = (JobCancelled, yt_dlp.utils.DownloadCancelled)


def build_hooks(job):
    def progress_hook(data):
        if job["_cancel"]:
            raise JobCancelled()
        info = data.get("info_dict") or {}
        with JOBS_LOCK:
            if data.get("status") == "downloading":
                total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
                done = data.get("downloaded_bytes") or 0
                job["status"] = "downloading"
                job["percent"] = round(done * 100.0 / total, 1) if total else None
                job["downloaded_bytes"] = done
                job["total_bytes"] = total or None
                job["speed"] = data.get("speed")
                job["eta"] = data.get("eta")
                if info.get("title"):
                    job["title"] = info["title"]
                if info.get("thumbnail"):
                    job["thumbnail"] = info["thumbnail"]
            elif data.get("status") == "finished":
                job["status"] = "processing"
                job["percent"] = 100.0
                job["speed"] = None
                job["eta"] = None
                job["stage"] = "Merging / converting"

    def postprocessor_hook(data):
        if job["_cancel"]:
            raise JobCancelled()
        with JOBS_LOCK:
            job["status"] = "processing"
            job["stage"] = data.get("postprocessor") or "Processing"

    return [progress_hook], [postprocessor_hook]


def build_options(job):
    progress_hooks, postprocessor_hooks = build_hooks(job)
    options = {
        "paths": {"home": str(DOWNLOAD_DIR)},
        "outtmpl": "%(title).180s [%(id)s].%(ext)s",
        "windowsfilenames": True,
        "noplaylist": not job["playlist"],
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ignoreerrors": False,
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
        "socket_timeout": 30,
        "overwrites": False,
        "continuedl": True,
        "progress_hooks": progress_hooks,
        "postprocessor_hooks": postprocessor_hooks,
    }

    if job["mode"] == "audio":
        options["format"] = "ba/b"
        options["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": job["quality"],
            "preferredquality": "192",
        }]
    else:
        options["format"] = VIDEO_FORMATS.get(job["quality"], VIDEO_FORMATS["best"])
        options["merge_output_format"] = "mp4"

    if job["use_cookies"] and COOKIES_FILE.exists():
        options["cookiefile"] = str(COOKIES_FILE)

    return options


def friendly_error(message):
    message = re.sub(r"^ERROR:\s*", "", str(message).strip())
    lowered = message.lower()
    hints = []

    if "instagram" in lowered and any(word in lowered for word in ("unable to extract", "login", "not available", "requested content")):
        hints.append(
            "Instagram often blocks anonymous requests. Upload a fresh cookies.txt exported from a "
            "logged-in browser, and run Update so yt-dlp has the latest extractor."
        )
    elif any(word in lowered for word in ("sign in", "log in", "login", "cookies", "not a bot", "private", "rate-limit", "rate limit")):
        hints.append(
            "This content probably requires a logged-in session. Export cookies.txt from your browser "
            "and upload it in the Cookies section."
        )

    if "ffmpeg" in lowered:
        hints.append("ffmpeg was not found. Pinokio normally bundles it - restart Pinokio or add ffmpeg to PATH.")

    if hints:
        message += "\n\nHint: " + " ".join(hints)
    return message


def collect_info_files(info):
    files = []
    if not isinstance(info, dict):
        return files
    if info.get("_type") == "playlist":
        for entry in info.get("entries") or []:
            files.extend(collect_info_files(entry))
        return files
    filepath = info.get("filepath")
    if not filepath:
        downloads = info.get("requested_downloads") or []
        if downloads:
            filepath = downloads[0].get("filepath")
    if filepath:
        try:
            path = Path(filepath)
            if path.is_file() and path.parent.resolve() == DOWNLOAD_DIR.resolve():
                files.append(path.name)
        except OSError:
            pass
    return files


def snapshot_files():
    snapshot = {}
    for item in DOWNLOAD_DIR.iterdir():
        if item.is_file():
            try:
                snapshot[item.name] = item.stat().st_mtime_ns
            except OSError:
                pass
    return snapshot


def process_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["status"] = "downloading"
        job["started_at"] = time.time()

    before = snapshot_files()
    options = build_options(job)
    info = None

    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(job["url"], download=True)

        after = snapshot_files()
        new_files = [
            name for name, mtime in after.items()
            if before.get(name) != mtime and not name.endswith((".part", ".ytdl", ".temp"))
        ]
        if not new_files:
            new_files = collect_info_files(info)
        new_files = list(dict.fromkeys(new_files))

        title = None
        thumbnail = None
        if isinstance(info, dict):
            title = info.get("title")
            thumbnail = info.get("thumbnail")

        with JOBS_LOCK:
            if job["_cancel"]:
                job["status"] = "canceled"
                job["error"] = "Canceled"
            else:
                job["status"] = "completed"
                job["percent"] = 100.0
                job["downloaded_bytes"] = job.get("total_bytes") or job.get("downloaded_bytes") or 0
                job["files"] = new_files
                if title:
                    job["title"] = title
                if thumbnail:
                    job["thumbnail"] = thumbnail
                if not new_files:
                    job["stage"] = "Already downloaded"
            job["speed"] = None
            job["eta"] = None
            job["finished_at"] = time.time()
    except CANCELLED_ERRORS:
        with JOBS_LOCK:
            job["status"] = "canceled"
            job["error"] = "Canceled"
            job["speed"] = None
            job["eta"] = None
            job["finished_at"] = time.time()
    except Exception as error:  # noqa: BLE001 - surfaced to the UI
        with JOBS_LOCK:
            job["status"] = "error"
            job["error"] = friendly_error(error)
            job["speed"] = None
            job["eta"] = None
            job["finished_at"] = time.time()


def worker_loop():
    while True:
        job_id = JOB_QUEUE.get()
        try:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
                skip = not job or job["_cancel"]
                if skip and job:
                    job["status"] = "canceled"
                    job["error"] = "Canceled"
                    job["finished_at"] = time.time()
            if not skip:
                process_job(job_id)
        except Exception as error:  # noqa: BLE001 - keep the worker alive
            print(f"Unhandled worker error: {error}")
        finally:
            JOB_QUEUE.task_done()


def public_job(job):
    return {key: value for key, value in job.items() if not key.startswith("_")}


def prune_jobs():
    now = time.time()
    with JOBS_LOCK:
        for job_id in list(JOBS):
            job = JOBS[job_id]
            if job["status"] in FINISHED_STATES and job.get("finished_at") and now - job["finished_at"] > JOB_TTL:
                JOBS.pop(job_id, None)


def library_items():
    items = []
    for item in DOWNLOAD_DIR.iterdir():
        if not item.is_file() or item.name.startswith("."):
            continue
        if item.suffix.lower() in (".part", ".ytdl", ".temp"):
            continue
        try:
            stat = item.stat()
        except OSError:
            continue
        items.append({
            "name": item.name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
            "url": "/media/" + quote(item.name),
        })
    items.sort(key=lambda entry: entry["modified"], reverse=True)
    return items


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "cookies": COOKIES_FILE.exists(),
        "download_dir": str(DOWNLOAD_DIR),
        "ytdlp": getattr(yt_dlp.version, "__version__", "unknown"),
    })


@app.get("/api/jobs")
def list_jobs():
    with JOBS_LOCK:
        jobs = sorted(JOBS.values(), key=lambda entry: entry["created_at"], reverse=True)
        return jsonify([public_job(job) for job in jobs])


@app.post("/api/download")
def create_download():
    payload = request.get_json(silent=True) or {}
    raw_urls = payload.get("urls") or ""
    urls = [line.strip() for line in re.split(r"[\r\n]+", str(raw_urls)) if line.strip()]

    if not urls:
        return jsonify({"error": "Paste at least one YouTube or Instagram link."}), 400
    if len(urls) > MAX_URLS:
        return jsonify({"error": f"Too many links at once (max {MAX_URLS})."}), 400
    for url in urls:
        if not URL_RE.match(url):
            return jsonify({"error": f"Not a valid link: {url}"}), 400

    mode = payload.get("mode") if payload.get("mode") in ("video", "audio") else "video"
    quality = str(payload.get("quality") or "")
    if mode == "audio":
        quality = quality if quality in AUDIO_CODECS else "m4a"
    else:
        quality = quality if quality in VIDEO_FORMATS else "best"

    playlist = bool(payload.get("playlist"))
    use_cookies = bool(payload.get("use_cookies", True))

    prune_jobs()
    created = []
    for url in dict.fromkeys(urls):
        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id,
            "url": url,
            "mode": mode,
            "quality": quality,
            "playlist": playlist,
            "use_cookies": use_cookies,
            "status": "queued",
            "title": url,
            "thumbnail": None,
            "percent": 0,
            "downloaded_bytes": 0,
            "total_bytes": None,
            "speed": None,
            "eta": None,
            "stage": None,
            "error": None,
            "files": [],
            "created_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "_cancel": False,
        }
        with JOBS_LOCK:
            JOBS[job_id] = job
        JOB_QUEUE.put(job_id)
        created.append(job_id)

    return jsonify({"jobs": created})


@app.post("/api/jobs/<job_id>/cancel")
def cancel_download(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Unknown download."}), 404
        if job["status"] not in FINISHED_STATES:
            job["_cancel"] = True
            if job["status"] == "queued":
                job["status"] = "canceled"
                job["error"] = "Canceled"
                job["finished_at"] = time.time()
        return jsonify(public_job(job))


@app.delete("/api/jobs")
def clear_jobs():
    with JOBS_LOCK:
        for job_id in list(JOBS):
            if JOBS[job_id]["status"] in FINISHED_STATES:
                JOBS.pop(job_id, None)
    return jsonify({"ok": True})


@app.get("/api/library")
def library():
    return jsonify(library_items())


@app.delete("/api/library/<path:filename>")
def delete_library_file(filename):
    name = Path(filename).name
    if name != filename:
        abort(404)
    target = DOWNLOAD_DIR / name
    if not target.is_file():
        return jsonify({"error": "File not found."}), 404
    try:
        target.unlink()
    except OSError as error:
        return jsonify({"error": str(error)}), 500
    return jsonify({"ok": True})


@app.get("/media/<path:filename>")
def serve_media(filename):
    name = Path(filename).name
    if name != filename:
        abort(404)
    if not (DOWNLOAD_DIR / name).is_file():
        abort(404)
    return send_from_directory(DOWNLOAD_DIR, name, conditional=True)


@app.post("/api/open-folder")
def open_folder():
    try:
        if sys.platform == "win32":
            os.startfile(str(DOWNLOAD_DIR))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(DOWNLOAD_DIR)])
        else:
            subprocess.Popen(["xdg-open", str(DOWNLOAD_DIR)])
        return jsonify({"ok": True})
    except Exception as error:  # noqa: BLE001 - surfaced to the UI
        return jsonify({"error": str(error)}), 500


@app.get("/api/cookies")
def cookies_status():
    if COOKIES_FILE.exists():
        stat = COOKIES_FILE.stat()
        return jsonify({"exists": True, "size": stat.st_size, "updated": stat.st_mtime})
    return jsonify({"exists": False})


@app.post("/api/cookies")
def upload_cookies():
    data = b""
    if "file" in request.files:
        data = request.files["file"].read()
    else:
        payload = request.get_json(silent=True) or {}
        text = payload.get("text") or ""
        data = text.encode("utf-8", errors="ignore")

    if not data:
        return jsonify({"error": "No cookie file content received."}), 400
    if len(data) > 5 * 1024 * 1024:
        return jsonify({"error": "Cookie file is too large (max 5 MB)."}), 400

    decoded = data.decode("utf-8", errors="ignore")
    if "Netscape" not in decoded and "\t" not in decoded:
        return jsonify({"error": "This does not look like a Netscape cookies.txt file."}), 400

    COOKIES_FILE.write_bytes(data)
    return jsonify({"ok": True})


@app.delete("/api/cookies")
def delete_cookies():
    if COOKIES_FILE.exists():
        COOKIES_FILE.unlink()
    return jsonify({"ok": True})


def main():
    parser = argparse.ArgumentParser(description="Video Indirici server")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "7860")))
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    threading.Thread(target=worker_loop, daemon=True).start()

    print("", flush=True)
    print("  ============================================================", flush=True)
    print("   Video Indirici  |  YouTube & Instagram downloader", flush=True)
    print(f"   Running at http://{args.host}:{args.port}", flush=True)
    print(f"   Downloads: {DOWNLOAD_DIR}", flush=True)
    print("  ============================================================", flush=True)
    print("", flush=True)

    app.run(host=args.host, port=args.port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
