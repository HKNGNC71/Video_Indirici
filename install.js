module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: [
          "uv pip install -r requirements.txt"
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app",
        message: [
          "python -c \"import yt_dlp, flask; print('Video Indirici dependencies ready')\""
        ]
      }
    },
    {
      method: "notify",
      params: {
        html: "Video Indirici is installed. Click <b>Start</b> to open it."
      }
    }
  ]
}
