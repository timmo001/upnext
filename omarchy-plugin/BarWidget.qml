import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.upnext"

  readonly property bool primaryOnly: setting("primaryOnly", false)
  readonly property string preferredOutput: setting("primaryOutput", "")
  readonly property string currentOutput: {
    var window = root.QsWindow ? root.QsWindow.window : null
    return window && window.screen ? String(window.screen.name || "") : ""
  }
  readonly property string activeOutput: {
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++)
      if (root.preferredOutput !== "" && screens[i].name === root.preferredOutput)
        return root.preferredOutput
    return screens.length > 0 ? String(screens[0].name || "") : ""
  }
  readonly property bool activeInstance: !primaryOnly
    || (currentOutput !== "" && currentOutput === activeOutput)
  readonly property var upnext: bar?.shell?.serviceFor("timmo.upnext")
  readonly property bool hasIssues: !!upnext && upnext.connected && upnext.issues.length > 0
  readonly property bool hiddenByState: upnext && upnext.statusState === "active" && !hasIssues
  readonly property bool hoverRevealed: hiddenByState
    && setting("revealOnHover", true)
    && !!bar
    && bar.barHovered === true
  readonly property bool shown: !upnext || !hiddenByState || hoverRevealed || opened
  readonly property bool vertical: bar ? bar.vertical : false
  // Twitch live, YouTube live, then new uploads. Zero counts are left out,
  // and the lowest priority goes first when there's no room. A warning always
  // shows when a source has a problem.
  readonly property var counts: {
    if (!upnext || !upnext.connected) return []
    var parts = [
      { icon: "󰕃", count: upnext.twitchLiveCount, color: upnext.sourceColors.twitch, gap: false },
      { icon: "󰗃", count: upnext.youtubeLiveCount, color: upnext.sourceColors.youtube, gap: false },
      { icon: "󰗃", count: upnext.newUploadCount, color: Qt.darker(upnext.sourceColors.youtube, 1.3), gap: true }
    ].filter(function(part) { return part.count > 0 })
    var room = vertical ? 1 : Math.max(1, setting("maxCounts", 3))
    if (!hasIssues) return parts.slice(0, room)
    var warning = { icon: "󰀦", count: "", color: warningColor, gap: parts.length > 0 }
    return vertical ? [warning] : parts.slice(0, room).concat([warning])
  }
  readonly property color warningColor: "#e5a50a"
  readonly property bool disconnected: !upnext || upnext.statusState === "inactive"
  readonly property string displayText: root.hoverRevealed ? "󰒭 0" : "󰒭"
  readonly property color displayColor: root.disconnected ? "#a55555" : "#9b9b9b"
  readonly property string tooltipText: {
    if (root.disconnected) return "Up Next is unavailable"
    return upnext.issues.concat([upnext.summary]).join("\n")
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: counts.length > 0 ? countsRow.implicitWidth : button.labelWidth

  function activeWidget() {
    if (root.activeInstance) return root
    var items = root.bar && typeof root.bar.moduleWidgets === "function"
      ? root.bar.moduleWidgets(root.moduleName) : []
    for (var i = 0; i < items.length; i++)
      if (items[i] && items[i].activeInstance === true) return items[i]
    return null
  }

  function open() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.open()
      return
    }
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.close()
      return
    }
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.togglePanel()
      return
    }
    if (panelLoader.item) panelLoader.item.toggle()
  }

  // Opens the panel on Twitch live channels or YouTube uploads, or closes it
  // if it's already showing them.
  function toggleSection(source) {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.toggleSection(source)
      return
    }
    if (panelLoader.item) panelLoader.item.toggleSource(source)
  }

  function closeForPopoutSwitch() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.closeForPopoutSwitch()
      return
    }
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    panel.bar = root.bar
    panel.settings = root.settings
    panel.anchorItem = button
    panel.hostWidget = root
    panel.service = root.upnext
  }

  visible: activeInstance && shown
  implicitWidth: activeInstance && shown ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  onUpnextChanged: injectPanel()

  Loader {
    id: panelLoader
    active: root.activeInstance
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Loader {
    active: root.activeInstance
    sourceComponent: Component {
      IpcHandler {
        target: "timmo.upnext"
        function recheck(): void { if (root.upnext) root.upnext.recheck(false) }
        function restart(): void { if (root.upnext) root.upnext.restart() }
        function open(): void { root.open() }
        function close(): void { root.close() }
        function show(): void { root.open() }
        function hide(): void { root.close() }
        function toggle(): void { root.togglePanel() }
        function twitch(): void { root.toggleSection("twitch") }
        function youtube(): void { root.toggleSection("youtube") }
      }
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    fontSize: 10
    text: root.displayText
    labelVisible: root.counts.length === 0
    fixedWidth: root.counts.length > 0 && !root.vertical
      ? countsRow.implicitWidth + Style.spaceReal(horizontalMargin) * 2 : -1
    dimmed: root.hoverRevealed
    foreground: root.displayColor
    tooltipText: root.tooltipText
    horizontalMargin: 6
    onPressed: function(buttonCode) {
      if (!root.upnext) return
      if (buttonCode === Qt.MiddleButton) root.upnext.recheck(false)
      else if (buttonCode === Qt.RightButton) root.upnext.restart()
      else root.togglePanel()
    }

    Row {
      id: countsRow
      anchors.centerIn: parent
      visible: root.counts.length > 0
      spacing: Style.space(6)

      Repeater {
        model: root.counts

        Row {
          required property var modelData
          required property int index
          spacing: Style.space(3)
          leftPadding: modelData.gap && index > 0 ? Style.space(6) : 0

          Text {
            text: modelData.icon
            color: modelData.color
            font.family: button.fontFamily
            font.pixelSize: button.fontSize
            renderType: Text.NativeRendering
          }

          Text {
            visible: modelData.count !== ""
            text: modelData.count
            color: modelData.color
            font.family: button.fontFamily
            font.pixelSize: button.fontSize
            renderType: Text.NativeRendering
          }
        }
      }
    }
  }
}
