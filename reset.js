module.exports = {
  run: [
    {
      when: "{{exists('app/env')}}",
      method: "fs.rm",
      params: {
        path: "app/env"
      }
    },
    {
      when: "{{exists('app/__pycache__')}}",
      method: "fs.rm",
      params: {
        path: "app/__pycache__"
      }
    },
    {
      method: "notify",
      params: {
        html: "Video Indirici was reset. Run <b>Install</b> to set it up again. Your downloaded files were kept."
      }
    }
  ]
}
