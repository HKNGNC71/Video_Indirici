module.exports = {
  version: "8.0.0",
  title: "Video Indirici",
  description: "Download videos and audio from YouTube & Instagram",
  icon: "icon.png",
  menu: async (kernel, info) => {
    const installed = info.exists("app/env")
    const running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js")
    }

    if (running.install) {
      return [{
        default: true,
        icon: "fa-solid fa-plug",
        text: "Installing",
        href: "install.js"
      }]
    }

    if (installed) {
      if (running.start) {
        const local = info.local("start.js")
        if (info.ready("start.js") && local && local.url) {
          return [{
            default: true,
            icon: "fa-solid fa-rocket",
            text: "Open Web UI",
            href: local.url
          }, {
            icon: "fa-solid fa-terminal",
            text: "Terminal",
            href: "start.js"
          }, {
            icon: "fa-solid fa-rotate",
            text: "Update",
            href: "update.js"
          }]
        }
        return [{
          default: true,
          icon: "fa-solid fa-terminal",
          text: "Starting",
          href: "start.js"
        }]
      }

      if (running.update) {
        return [{
          default: true,
          icon: "fa-solid fa-rotate",
          text: "Updating",
          href: "update.js"
        }]
      }

      if (running.reset) {
        return [{
          default: true,
          icon: "fa-solid fa-broom",
          text: "Resetting",
          href: "reset.js"
        }]
      }

      return [{
        default: true,
        icon: "fa-solid fa-power-off",
        text: "Start",
        href: "start.js"
      }, {
        icon: "fa-solid fa-rotate",
        text: "Update",
        href: "update.js"
      }, {
        icon: "fa-solid fa-plug",
        text: "Install",
        href: "install.js"
      }, {
        icon: "fa-solid fa-broom",
        text: "Reset",
        href: "reset.js",
        confirm: "Reset the app dependencies? Your downloaded files are kept."
      }]
    }

    return [{
      default: true,
      icon: "fa-solid fa-plug",
      text: "Install",
      href: "install.js"
    }, {
      icon: "fa-solid fa-rotate",
      text: "Update",
      href: "update.js"
    }]
  }
}
