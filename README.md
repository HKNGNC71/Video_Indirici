# Video Indirici

A local, one-click downloader for **YouTube** and **Instagram** videos, reels, and audio.

Video Indirici runs a small Flask web UI on your machine and uses [yt-dlp](https://github.com/yt-dlp/yt-dlp) (with ffmpeg) under the hood. Paste links, pick a format, and the files land in the app's `downloads` folder. Nothing is uploaded anywhere.

## Features

- Download YouTube videos, Shorts, playlists, and Instagram reels, posts, and carousels
- Quality presets: best available, 1080p, 720p, 480p, 360p
- Audio extraction to M4A or MP3 (192 kbps)
- Batch downloads: one link per line, up to 25 at a time
- Live progress, speed, ETA, and cancel controls
- Built-in library with preview, save, and delete
- Optional `cookies.txt` upload for private, age-restricted, or login-only content
- Everything runs locally at `http://127.0.0.1:<port>`

## Install

1. Open this app in Pinokio and click **Install**.
2. Click **Start**.
3. Pinokio opens the **Web UI** automatically.

The install step creates a Python virtual environment in `app/env` and installs Flask and yt-dlp. ffmpeg ships with Pinokio, so no extra setup is required.

## Usage

1. Paste one or more links into the text area (YouTube and Instagram links can be mixed).
2. Choose **Video** or **Audio only** and pick a quality.
3. Leave **Download entire playlist / carousel** unchecked unless you want every entry.
4. Click **Download** and watch the progress cards.
5. Use the **Library** section to preview, save, or delete files, or click **Open downloads folder**.

Downloads are stored in `app/downloads`.

### Private or restricted content

YouTube sometimes asks a downloader to "confirm you're not a bot", and some Instagram posts are only visible while logged in. To handle both:

1. Install a **Get cookies.txt LOCALLY** extension in Chrome, Edge, or Firefox.
2. Log in to YouTube or Instagram in that browser.
3. Export the site's cookies as `cookies.txt`.
4. Upload the file in the **Cookies for private content** section of the app.

Cookies are stored locally in `app/data/cookies.txt` and are only used for downloads you start. Delete them any time with **Remove cookies**.

## API

The web UI is just a client of the local HTTP API. Start the app, then use the URL printed in the Pinokio terminal (for example `http://127.0.0.1:7860`).

### `POST /api/download`

Queue one or more downloads.

```bash
curl -X POST http://127.0.0.1:7860/api/download \
  -H "Content-Type: application/json" \
  -d '{
    "urls": "https://www.youtube.com/watch?v=VIDEO_ID\nhttps://www.instagram.com/reel/REEL_ID/",
    "mode": "video",
    "quality": "1080",
    "playlist": false,
    "use_cookies": true
  }'
```

- `urls` (string): newline-separated links.
- `mode`: `video` or `audio`.
- `quality`: videos use `best`, `1080`, `720`, `480`, `360`; audio uses `m4a` or `mp3`.
- `playlist` (boolean): download every entry of a playlist / carousel.
- `use_cookies` (boolean): use the uploaded `cookies.txt` when present.

Response: `{ "jobs": ["<job-id>", ...] }`

### `GET /api/jobs`

List current and recent download jobs.

```bash
curl http://127.0.0.1:7860/api/jobs
```

Each job contains `id`, `url`, `status` (`queued`, `downloading`, `processing`, `completed`, `error`, `canceled`), `title`, `thumbnail`, `percent`, `speed`, `eta`, `files`, and `error`.

### `POST /api/jobs/{id}/cancel`

Cancel a queued or running download.

```bash
curl -X POST http://127.0.0.1:7860/api/jobs/abc123/cancel
```

### `DELETE /api/jobs`

Remove all finished jobs from the list.

### `GET /api/library`

List downloaded files: `name`, `size`, `modified`, `url`.

### `DELETE /api/library/{filename}`

Permanently delete a file from the downloads folder.

### `GET /media/{filename}`

Stream or download a finished file (supports HTTP range requests, so video seeking works).

### `POST /api/cookies`

Upload a Netscape-format `cookies.txt`, either as multipart form data:

```bash
curl -X POST http://127.0.0.1:7860/api/cookies -F "file=@cookies.txt"
```

or as JSON: `{ "text": "# Netscape HTTP Cookie File\n..." }`

### `GET /api/cookies` / `DELETE /api/cookies`

Check whether cookies are stored, or remove them.

### `GET /api/health`

Returns ffmpeg availability, cookie status, the downloads path, and the yt-dlp version.

### `POST /api/open-folder`

Open the downloads folder in the system file manager.

### Client examples

JavaScript:

```javascript
const base = "http://127.0.0.1:7860"

const { jobs } = await fetch(`${base}/api/download`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    urls: "https://www.youtube.com/watch?v=VIDEO_ID",
    mode: "audio",
    quality: "mp3",
  }),
}).then((response) => response.json())

const status = await fetch(`${base}/api/jobs`).then((response) => response.json())
console.log(jobs, status)
```

Python:

```python
import requests

base = "http://127.0.0.1:7860"

job = requests.post(f"{base}/api/download", json={
    "urls": "https://www.instagram.com/reel/REEL_ID/",
    "mode": "video",
    "quality": "best",
}).json()

jobs = requests.get(f"{base}/api/jobs").json()
files = requests.get(f"{base}/api/library").json()

# Save a finished file locally
if files:
    data = requests.get(base + files[0]["url"]).content
    with open(files[0]["name"], "wb") as handle:
        handle.write(data)
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Sign in to confirm you're not a bot" | Upload a fresh `cookies.txt` from a logged-in browser. |
| Instagram says login is required | Upload Instagram `cookies.txt`. Cookies expire, so re-export when needed. |
| Video has no audio or merging fails | ffmpeg was not found. Restart Pinokio, or check that `ffmpeg` is available in the app shell. |
| A site no longer downloads | Click **Update** to refresh yt-dlp and its extractors. |
| Downloads fail behind a proxy | Set `HTTP_PROXY` / `HTTPS_PROXY` in the app's `ENVIRONMENT` file and restart. |

## Project layout

```text
Video_Indirici/
├── app/
│   ├── app.py            # Flask server + yt-dlp job queue
│   ├── requirements.txt
│   ├── templates/
│   │   └── index.html
│   ├── static/
│   │   ├── app.js
│   │   └── style.css
│   ├── downloads/        # finished files (ignored by git)
│   └── data/             # cookies.txt (ignored by git)
├── install.js
├── start.js
├── update.js
├── reset.js
├── pinokio.js
├── pinokio.json
├── icon.png
└── README.md
```

## Legal

Only download content you own or have explicit permission to save. Respect the terms of service of YouTube, Instagram, and the rights of the people who created the content.
