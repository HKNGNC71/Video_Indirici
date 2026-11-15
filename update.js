module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: [
          "uv pip install -U yt-dlp flask"
        ]
      }
    },
    {
      method: "notify",
      params: {
        html: "Video Indirici is up to date. yt-dlp extractors were refreshed."
      }
    }
  ]
}
