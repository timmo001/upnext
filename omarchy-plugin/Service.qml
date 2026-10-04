import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property bool connected: false
  property var sources: []
  property var items: []
  property string errorText: "Connecting to Up Next"
  property var actionCommand: []
  property string commandPath: "upnext"
  // Empty uses the daemon's default socket.
  property string socketPath: ""
  property var restartCommand: ["systemctl", "--user", "restart", "upnext.service"]
  property var thumbnails: ({})

  // Brand colours, lifted so they read on a dark bar.
  readonly property var sourceColors: ({ twitch: "#a970ff", youtube: "#ff4040" })

  readonly property bool restarting: restartFeedback.running
  readonly property bool actionBusy: actionProcess.running || restarting
  readonly property bool canRecheck: connected && !actionBusy
  readonly property var liveItems: items.filter(function(entry) { return entry.item.kind === "live" })
  readonly property var trackedLive: liveItems.filter(function(entry) { return entry.tracked === true })
  readonly property int liveCount: trackedLive.length
  readonly property int twitchLiveCount: trackedLive.filter(function(entry) { return entry.item.source === "twitch" }).length
  readonly property int youtubeLiveCount: trackedLive.filter(function(entry) { return entry.item.source === "youtube" }).length
  readonly property int newUploadCount: items.filter(function(entry) {
    return entry.item.kind === "upload" && entry.item.source === "youtube" && entry.tracked === true
  }).length
  readonly property var attentionSources: sources.filter(function(status) {
    return status.state === "auth-required" || status.state === "error"
  })
  readonly property var sourceNames: ({ twitch: "Twitch", youtube: "YouTube" })
  // Problems to flag in the bar: sources needing attention, and a feed the
  // panel couldn't read while still connected.
  readonly property var issues: {
    var lines = attentionSources.map(function(status) {
      var name = sourceNames[status.source] || status.source
      if (status.state === "auth-required") return name + " needs you to sign in again"
      return name + ": " + (status.message || "error")
    })
    if (connected && errorText !== "") lines.push(errorText)
    return lines
  }
  // What's live and new, for the bar tooltip and the panel header.
  readonly property string summary: {
    var parts = []
    if (twitchLiveCount > 0) parts.push(twitchLiveCount + " live on Twitch")
    if (youtubeLiveCount > 0) parts.push(youtubeLiveCount + " live on YouTube")
    if (newUploadCount > 0)
      parts.push(newUploadCount + " new upload" + (newUploadCount === 1 ? "" : "s"))
    return parts.length > 0 ? parts.join(" · ") : "Nothing new"
  }
  // live, new, active or inactive, for the bar widget.
  readonly property string statusState: !connected ? "inactive"
    : (liveCount > 0 ? "live" : (newUploadCount > 0 ? "new" : "active"))

  function command(args) {
    return socketPath ? [commandPath, "--socket", socketPath].concat(args) : [commandPath].concat(args)
  }

  function applyFeed(line) {
    var text = String(line || "").trim()
    if (!text) return
    try {
      var feed = JSON.parse(text)
      sources = Array.isArray(feed.sources) ? feed.sources : []
      items = Array.isArray(feed.items) ? feed.items : []
      connected = true
      errorText = ""
      pruneThumbnails()
    } catch (error) {
      errorText = "Invalid feed from Up Next"
    }
  }

  function disconnect() {
    connected = false
    errorText = "Up Next is unavailable"
  }

  function thumbnailFor(item) {
    if (!item || !item.thumbnailUrl) return null
    var thumbnail = thumbnails[item.id]
    if (!thumbnail) {
      thumbnail = thumbnailComponent.createObject(root)
      thumbnails[item.id] = thumbnail
    }
    thumbnail.thumbnailUrl = String(item.thumbnailUrl)
    return thumbnail
  }

  // Live previews change while a stream runs; other thumbnails don't.
  function refreshThumbnails() {
    for (var i = 0; i < liveItems.length; i++) {
      var thumbnail = thumbnails[liveItems[i].item.id]
      if (thumbnail) thumbnail.refresh()
    }
  }

  function pruneThumbnails() {
    var ids = {}
    for (var i = 0; i < items.length; i++) ids[items[i].item.id] = true
    for (var id in thumbnails) {
      if (ids[id]) continue
      thumbnails[id].destroy()
      delete thumbnails[id]
    }
  }

  Component {
    id: thumbnailComponent
    Thumbnail {}
  }

  function runAction(command) {
    if (actionProcess.running) return
    actionCommand = command
    actionProcess.running = true
  }

  function recheck(openLive) {
    if (!canRecheck) return
    runAction(command(openLive ? ["recheck", "--open"] : ["recheck"]))
  }

  function restart() {
    if (actionBusy) return
    restartFeedback.restart()
    runAction(restartCommand)
  }

  function markWatched(item) {
    if (!item || !connected) return
    Quickshell.execDetached(command(["watched", String(item.id)]))
  }

  function signIn(source) {
    Quickshell.execDetached(command(["auth", String(source)]))
  }

  function openUrl(url) {
    var launcher = Quickshell.env("OMARCHY_HOST") === "desktop"
      ? "xdg-open" : "omarchy-launch-webapp"
    Quickshell.execDetached([launcher, url])
  }

  // Streams the feed now and after every change. The process exits when the
  // daemon stops, and reconnects shortly after.
  Process {
    id: watchProcess
    running: true
    command: root.command(["watch", "--json"])
    stdout: SplitParser {
      onRead: function(line) { root.applyFeed(line) }
    }
    stderr: StdioCollector { waitForEnd: true }
    onExited: {
      root.disconnect()
      reconnect.restart()
    }
  }

  Process {
    id: actionProcess
    command: root.actionCommand
    stdout: StdioCollector { waitForEnd: true }
    stderr: StdioCollector { waitForEnd: true }
  }

  Timer {
    id: reconnect
    interval: root.restarting ? 500 : 5000
    onTriggered: if (!watchProcess.running) watchProcess.running = true
  }

  Timer {
    id: restartFeedback
    interval: 5000
  }
}
