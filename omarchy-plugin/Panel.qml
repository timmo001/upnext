import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "timmo.upnext"
  ipcTarget: "timmo.upnext"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null

  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color liveColor: "#ac77e5"
  readonly property var sourceIcons: ({ twitch: "\uf1e8", youtube: "\uf16a", link: "\uf0c1" })
  readonly property var sourceColors: ({ twitch: "#ac77e5", youtube: "#ff4e45" })
  readonly property int actionCount: 5
  readonly property var actionLabels: [
    "Recheck",
    "Open live auto-open channels",
    "Open Twitch following",
    "Open YouTube subscriptions",
    "Restart upnext"
  ]
  readonly property var actionIcons: ["󰑐", "󰕃", "\uf1e8", "\uf16a", "󰜉"]
  readonly property var actionUrls: [
    "",
    "",
    "https://www.twitch.tv/directory/following/live",
    "https://www.youtube.com/feed/subscriptions",
    ""
  ]
  readonly property var sections: [
    { kind: "live", title: "LIVE" },
    { kind: "upcoming", title: "UPCOMING" },
    { kind: "upload", title: "NEW UPLOADS" },
    { kind: "saved", title: "WATCH LATER" }
  ]
  property var expanded: ({ live: true, upcoming: true, upload: true, saved: true })
  // Refreshed while the panel is open, so relative times stay current.
  property double now: Date.now()

  readonly property var panelRows: buildPanelRows()
  readonly property var filteredHeaderActions: filterRows("header-action")
  readonly property var filteredActions: filterRows("action")
  readonly property var filteredAttention: filterRows("attention")
  readonly property var filteredSections: buildSections()
  readonly property var navigationRows: buildNavigationRows()

  function sourceIcon(source) {
    return sourceIcons[source] || sourceIcons.link
  }

  function sourceColor(source) {
    return sourceColors[source] || contentForeground
  }

  function ago(iso) {
    var minutes = Math.floor((now - Date.parse(iso)) / 60000)
    if (!(minutes >= 0)) return ""
    if (minutes < 60) return minutes + "m ago"
    if (minutes < 60 * 24) return Math.floor(minutes / 60) + "h ago"
    return Math.floor(minutes / (60 * 24)) + "d ago"
  }

  function startsAt(iso) {
    var date = new Date(iso)
    if (isNaN(date.getTime())) return "Upcoming"
    var sameDay = date.toDateString() === new Date(now).toDateString()
    return "Starts " + (sameDay ? "" : date.toLocaleDateString(Qt.locale(), "ddd d MMM") + " ")
      + date.toLocaleTimeString(Qt.locale(), "HH:mm")
  }

  function detailFor(entry) {
    var item = entry.item
    var published = item.publishedAt ? String(item.publishedAt) : ""
    if (item.kind === "live")
      return [item.category || "Live", entry.tracked ? "" : "followed"]
        .filter(function(part) { return part !== "" }).join(" · ")
    if (item.kind === "upcoming") return startsAt(published)
    if (item.kind === "saved") return published ? "Saved " + ago(published) : "Saved"
    return ago(published)
  }

  function buildPanelRows() {
    var rows = []
    for (var i = 0; i < actionCount; i++) {
      rows.push({
        key: "action:" + i,
        kind: i === 0 || i === 4 ? "header-action" : "action",
        section: "action",
        actionIndex: i,
        primaryText: actionLabels[i],
        secondaryText: ""
      })
    }
    var attention = service ? service.attentionSources : []
    for (var j = 0; j < attention.length; j++) {
      var status = attention[j]
      rows.push({
        key: "attention:" + status.source,
        kind: "attention",
        section: "attention",
        value: status,
        primaryText: status.source,
        secondaryText: status.message || status.state
      })
    }
    var items = service && service.connected ? service.items : []
    // Tracked live channels before followed ones; the feed's order otherwise.
    var ordered = items.filter(function(entry) { return entry.item.kind !== "live" || entry.tracked })
      .concat(items.filter(function(entry) { return entry.item.kind === "live" && !entry.tracked }))
    for (var k = 0; k < ordered.length; k++) {
      var entry = ordered[k]
      var item = entry.item
      rows.push({
        key: "item:" + item.id,
        kind: "item",
        section: item.kind,
        value: entry,
        primaryText: item.channel ? item.channel.name : item.title,
        secondaryText: item.channel ? item.title : "",
        tertiaryText: detailFor(entry)
      })
    }
    return rows
  }

  function filterRows(kind) {
    return filterController.filteredModel.filter(function(entry) { return entry.kind === kind })
  }

  function buildSections() {
    var items = filterRows("item")
    return sections.map(function(section) {
      var rows = items.filter(function(entry) { return entry.section === section.kind })
      return {
        kind: section.kind,
        title: section.title,
        count: rows.length,
        toggleKey: "toggle:" + section.kind,
        rows: filterController.filterText || expanded[section.kind] ? rows : []
      }
    }).filter(function(section) { return section.count > 0 })
  }

  function buildNavigationRows() {
    var rows = filteredHeaderActions.concat(filteredActions, filteredAttention)
    for (var i = 0; i < filteredSections.length; i++) {
      var section = filteredSections[i]
      if (!filterController.filterText)
        rows.push({ key: section.toggleKey, kind: "toggle", section: section.kind })
      rows = rows.concat(section.rows)
    }
    return rows
  }

  function toggleSection(kind) {
    var next = Object.assign({}, expanded)
    next[kind] = !next[kind]
    expanded = next
  }

  function open() {
    now = Date.now()
    expanded = { live: true, upcoming: true, upload: true, saved: true }
    filterController.reset()
    if (service) service.refreshThumbnails()
    controller.show()
    Qt.callLater(function() {
      panelFlick.contentY = 0
      filterController.forceActiveFocus()
    })
  }

  function close() {
    controller.hide()
  }

  function toggle() {
    if (opened) close()
    else open()
  }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function cursorItem() {
    var entry = filterController.selectedEntry()
    if (!entry) return null
    if (entry.kind === "header-action") return actionsHeader
    if (entry.kind === "action") return actionRepeater.itemAt(filteredActions.indexOf(entry))
    if (entry.kind === "attention") return attentionRepeater.itemAt(filteredAttention.indexOf(entry))
    for (var i = 0; i < filteredSections.length; i++) {
      var section = filteredSections[i]
      if (section.kind !== entry.section) continue
      var sectionItem = sectionRepeater.itemAt(i)
      if (!sectionItem) return null
      if (entry.kind === "toggle") return sectionItem.heading
      return sectionItem.rowAt(section.rows.indexOf(entry))
    }
    return null
  }

  function scrollCursorIntoView() {
    var item = cursorItem()
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  Timer {
    id: revealTimer
    interval: 0
    onTriggered: root.scrollCursorIntoView()
  }

  Timer {
    interval: 60000
    running: root.opened
    repeat: true
    onTriggered: {
      root.now = Date.now()
      if (root.service) root.service.refreshThumbnails()
    }
  }

  function activateAction(index) {
    if (!service) return
    if ((index === 0 || index === 1) && !service.canRecheck) return
    if (index === 0) service.recheck(false)
    else if (index === 1) {
      service.recheck(true)
      close()
    } else if (index === 4) service.restart()
    else {
      service.openUrl(actionUrls[index])
      close()
    }
  }

  function canMarkWatched(entry) {
    return entry.item.kind === "saved"
      || (entry.item.kind === "upload" && entry.item.source === "youtube")
  }

  // Opens the item, or with Shift or a right-click marks it watched.
  function activateItem(entry, markWatched) {
    if (!service) return
    if (markWatched) {
      if (canMarkWatched(entry)) service.markWatched(entry.item)
      return
    }
    service.openUrl(entry.item.url)
    close()
  }

  function activateAttention(status) {
    if (!service || status.state !== "auth-required") return
    service.signIn(status.source)
    close()
  }

  function activateEntry(entry, modifiers) {
    if (entry.kind === "action" || entry.kind === "header-action") activateAction(entry.actionIndex)
    else if (entry.kind === "attention") activateAttention(entry.value)
    else if (entry.kind === "item") activateItem(entry.value, (modifiers & Qt.ShiftModifier) !== 0)
    else if (entry.kind === "toggle") toggleSection(entry.section)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(560))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

    FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      navigationModel: root.navigationRows
      onRevealRequested: revealTimer.restart()
      onActivateRequested: function(entry, modifiers) { root.activateEntry(entry, modifiers) }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: root.activateAction(0)

      PanelFlickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: contentColumn
          width: panelFlick.width
          spacing: Style.space(12)

          PanelHeader {
            title: "upnext"
            meta: root.service && root.service.restarting ? "Restarting upnext"
              : (!root.service || root.service.statusState === "inactive"
                ? "upnext is unavailable"
                : (root.service.statusState === "live"
                  ? root.service.liveCount + " live now"
                  : "Nothing live"))
            detail: root.service && root.service.restarting ? "RESTARTING"
              : (root.service && root.service.connected ? "CONNECTED" : "OFFLINE")
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconOpacity: root.service && root.service.connected ? 1 : 0.5
            iconComponent: Component {
              Text {
                text: "󰂚"
                color: root.service && root.service.statusState === "live" ? root.liveColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          SectionHeading {
            id: actionsHeader
            visible: root.filteredHeaderActions.length > 0 || root.filteredActions.length > 0
            title: filterController.filterText || "Actions"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            trailingControl: Component {
              Row {
                spacing: Style.space(4)

                Repeater {
                  model: root.filteredHeaderActions

                  PanelActionButton {
                    required property var modelData
                    enabled: root.service && (modelData.actionIndex === 4
                      ? !root.service.actionBusy : root.service.canRecheck)
                    iconText: root.actionIcons[modelData.actionIndex]
                    tooltipText: modelData.actionIndex === 4 && root.service && root.service.restarting
                      ? "Restarting upnext" : modelData.primaryText
                    foreground: modelData.actionIndex === 4
                      ? (root.bar ? root.bar.urgent : Color.urgent)
                      : Qt.darker(root.contentForeground, 1.15)
                    fontFamily: root.contentFontFamily
                    hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                    onHovered: function(hovered) {
                      if (hovered) filterController.cursorIndex = filterController.indexForKey(modelData.key)
                    }
                    onClicked: root.activateAction(modelData.actionIndex)
                  }
                }
              }
            }
          }

          Column {
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              id: actionRepeater
              model: root.filteredActions

              CursorSurface {
                required property var modelData
                width: contentColumn.width
                implicitHeight: actionRow.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground

                Row {
                  id: actionRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)

                  Text {
                    width: Style.space(22)
                    text: root.actionIcons[modelData.actionIndex]
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Text {
                    width: Math.max(0, actionRow.width - Style.space(32))
                    text: root.actionLabels[modelData.actionIndex]
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    elide: Text.ElideRight
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: root.activateAction(modelData.actionIndex)
                }
              }
            }
          }

          SectionHeading {
            visible: root.filteredAttention.length > 0
            title: "NEEDS ATTENTION"
            foreground: root.bar ? root.bar.urgent : Color.urgent
            fontFamily: root.contentFontFamily
          }

          Column {
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              id: attentionRepeater
              model: root.filteredAttention

              CursorSurface {
                required property var modelData
                width: contentColumn.width
                implicitHeight: attentionColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.bar ? root.bar.urgent : Color.urgent

                Row {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)

                  Text {
                    width: Style.space(22)
                    text: root.sourceIcon(modelData.value.source)
                    color: root.sourceColor(modelData.value.source)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Column {
                    id: attentionColumn
                    width: Math.max(0, parent.width - Style.space(32))
                    spacing: Style.space(2)

                    Text {
                      width: parent.width
                      text: modelData.value.state === "auth-required"
                        ? "Sign in to " + modelData.value.source
                        : modelData.value.source + " failed"
                      color: root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.body
                      elide: Text.ElideRight
                    }

                    Text {
                      width: parent.width
                      visible: text !== ""
                      text: String(modelData.value.message || "")
                      color: Qt.darker(root.contentForeground, 1.4)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: modelData.value.state === "auth-required" ? Qt.PointingHandCursor : Qt.ArrowCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: root.activateAttention(modelData.value)
                }
              }
            }
          }

          Repeater {
            id: sectionRepeater
            model: root.filteredSections

            Column {
              id: sectionColumn
              required property var modelData
              readonly property alias heading: sectionHeading
              width: contentColumn.width
              spacing: Style.space(4)

              function rowAt(index) {
                return rowRepeater.itemAt(index)
              }

              SectionHeading {
                id: sectionHeading
                width: parent.width
                hasCursor: filterController.cursorIndex === filterController.indexForKey(sectionColumn.modelData.toggleKey)
                title: (filterController.filterText || root.expanded[sectionColumn.modelData.kind] ? "󰅀 " : "󰅂 ")
                  + sectionColumn.modelData.title + " · " + sectionColumn.modelData.count
                  + (filterController.filterText ? " MATCHING" : "")
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily

                MouseArea {
                  anchors.fill: parent
                  enabled: !filterController.filterText
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(sectionColumn.modelData.toggleKey)
                  onClicked: root.toggleSection(sectionColumn.modelData.kind)
                }
              }

              Column {
                width: parent.width
                spacing: Style.space(2)

                Repeater {
                  id: rowRepeater
                  model: sectionColumn.modelData.rows
                  delegate: itemDelegate
                }
              }
            }
          }

          Component {
            id: itemDelegate

            CursorSurface {
              id: itemSurface
              required property var modelData
              readonly property var entry: modelData.value
              readonly property var item: entry.item
              readonly property bool live: item.kind === "live"
              readonly property var thumbnail: root.service ? root.service.thumbnailFor(item) : null
              width: contentColumn.width
              implicitHeight: itemColumn.implicitHeight + Style.space(12)
              hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
              foreground: root.contentForeground
              accent: live ? root.liveColor : root.contentForeground

              Row {
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Style.space(8)
                anchors.rightMargin: Style.space(8)
                spacing: Style.space(10)

                Item {
                  width: Style.space(64)
                  height: Math.round(width * 9 / 16)
                  clip: true

                  Rectangle {
                    anchors.fill: parent
                    color: Qt.darker(root.contentForeground, itemSurface.live ? 2.2 : 2.5)
                    radius: Style.space(4)
                  }

                  Image {
                    id: itemThumbnail
                    anchors.fill: parent
                    source: itemSurface.thumbnail ? itemSurface.thumbnail.source : ""
                    asynchronous: true
                    cache: true
                    fillMode: Image.PreserveAspectCrop
                  }

                  Text {
                    anchors.fill: parent
                    visible: itemThumbnail.status !== Image.Ready
                    text: root.sourceIcon(itemSurface.item.source)
                    color: root.sourceColor(itemSurface.item.source)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                  }
                }

                Column {
                  id: itemColumn
                  width: Math.max(0, parent.width - Style.space(124))
                  spacing: Style.space(2)

                  Text {
                    width: parent.width
                    text: String(itemSurface.modelData.primaryText || "")
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    font.bold: itemSurface.live && itemSurface.entry.tracked
                    elide: Text.ElideRight
                  }

                  Text {
                    width: parent.width
                    visible: text !== ""
                    text: String(itemSurface.modelData.secondaryText || "")
                    color: Qt.darker(root.contentForeground, 1.4)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }

                  Text {
                    width: parent.width
                    visible: text !== ""
                    text: String(itemSurface.modelData.tertiaryText || "")
                    color: Qt.darker(root.contentForeground, 1.25)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }

                Text {
                  width: Style.space(20)
                  text: itemSurface.entry.autoOpen === true ? "" : root.sourceIcon(itemSurface.item.source)
                  color: itemSurface.entry.autoOpen === true
                    ? Qt.darker(root.contentForeground, 1.3)
                    : root.sourceColor(itemSurface.item.source)
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.caption
                  horizontalAlignment: Text.AlignHCenter
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.LeftButton | Qt.RightButton
                cursorShape: Qt.PointingHandCursor
                onEntered: filterController.cursorIndex = filterController.indexForKey(itemSurface.modelData.key)
                onClicked: function(mouse) {
                  root.activateItem(itemSurface.entry, mouse.button === Qt.RightButton)
                }
              }
            }
          }

          Text {
            visible: filterController.count === 0 || (root.filteredSections.length === 0 && !filterController.filterText)
            width: parent.width
            text: filterController.filterText
              ? "No matches for “" + filterController.filterText + "”"
              : (root.service && root.service.errorText !== "" ? root.service.errorText : "Nothing to watch")
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }
        }
      }
    }
  }
}
