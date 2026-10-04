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

  readonly property bool restarting: restartFeedback.running
  readonly property bool actionBusy: actionProcess.running || restarting
  readonly property bool canRecheck: connected && !actionBusy
  readonly property var liveItems: items.filter(function(entry) { return entry.item.kind === "live" })
  readonly property int liveCount: liveItems.filter(function(entry) { return entry.tracked === true }).length
  readonly property var attentionSources: sources.filter(function(status) {
    return status.state === "auth-required" || status.state === "error"
  })
  // live, active or inactive, for the bar widget.
  readonly property string statusState: !connected ? "inactive" : (liveCount > 0 ? "live" : "active")

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
