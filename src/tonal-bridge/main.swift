// Tonal Bridge — passes MIDI controller input to the Tonal panel in Premiere Pro.
//
// Premiere plugins can't read MIDI devices themselves, so this small menu-bar
// app does it: it listens to every MIDI controller plugged into the Mac and
// forwards knob, fader and button messages to Tonal over a local connection
// (127.0.0.1 only — nothing leaves the computer). Tonal sends values back so
// the controller's LED rings can show where each Lumetri setting sits.
//
// Messages (JSON text frames, one per message):
//   Bridge → Tonal  {"t":"hello","version":"1.0.0","devices":["X-TOUCH MINI"]}
//                   {"t":"devices","devices":[...]}
//                   {"t":"cc","dev":"X-TOUCH MINI","ch":11,"n":1,"v":64}
//                   {"t":"note","dev":"X-TOUCH MINI","ch":11,"n":8,"v":127,"on":true}
//                   {"t":"pb","dev":"X-TOUCH MINI","ch":1,"v":8192}        (pitch bend, e.g. faders in Mackie mode)
//   Tonal → Bridge  {"t":"cc","dev":"X-TOUCH MINI","ch":11,"n":1,"v":64}   (LED ring / motor feedback)
//                   {"t":"note","dev":"X-TOUCH MINI","ch":11,"n":8,"v":127} (button lights)

import AppKit
import CoreMIDI
import Network
import ServiceManagement

let VERSION = "1.0.0"
let PORT: UInt16 = 51849

// MARK: - MIDI + WebSocket bridge

final class Bridge {
    private var client = MIDIClientRef()
    private var inPort = MIDIPortRef()
    private var outPort = MIDIPortRef()
    private var connectedSources = Set<MIDIEndpointRef>()
    private var listener: NWListener?
    private var clients: [ObjectIdentifier: NWConnection] = [:]

    private(set) var deviceNames: [String] = []
    private(set) var serverError: String?
    var tonalConnected: Bool { !clients.isEmpty }
    var onChange: (() -> Void)?

    func start() {
        startMIDI()
        startServer()
    }

    // MARK: MIDI

    private func startMIDI() {
        MIDIClientCreateWithBlock("Tonal Bridge" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async { self?.connectSources() }
        }
        MIDIInputPortCreateWithBlock(client, "Tonal Bridge In" as CFString, &inPort) { [weak self] packets, refCon in
            let source = MIDIEndpointRef(UInt(bitPattern: refCon))
            var messages: [[UInt8]] = []
            for packet in packets.unsafeSequence() {
                let length = min(Int(packet.pointee.length), 256)
                let bytes: [UInt8] = withUnsafeBytes(of: packet.pointee.data) { Array($0.prefix(length)) }
                messages.append(bytes)
            }
            DispatchQueue.main.async {
                guard let self = self else { return }
                let name = Bridge.name(of: source)
                for bytes in messages { self.handleMIDI(bytes, from: name) }
            }
        }
        MIDIOutputPortCreate(client, "Tonal Bridge Out" as CFString, &outPort)
        connectSources()
    }

    private func connectSources() {
        var present = Set<MIDIEndpointRef>()
        var names: [String] = []
        for i in 0..<MIDIGetNumberOfSources() {
            let src = MIDIGetSource(i)
            if src == 0 { continue }
            present.insert(src)
            let name = Bridge.name(of: src)
            if !name.isEmpty && !names.contains(name) { names.append(name) }
            if !connectedSources.contains(src) {
                let refCon = UnsafeMutableRawPointer(bitPattern: UInt(src))
                if MIDIPortConnectSource(inPort, src, refCon) == noErr { connectedSources.insert(src) }
            }
        }
        for gone in connectedSources.subtracting(present) {
            MIDIPortDisconnectSource(inPort, gone)
            connectedSources.remove(gone)
        }
        deviceNames = names
        broadcast(["t": "devices", "devices": names])
        onChange?()
    }

    static func name(of endpoint: MIDIEndpointRef) -> String {
        var cf: Unmanaged<CFString>?
        if MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &cf) == noErr, let s = cf?.takeRetainedValue() {
            return s as String
        }
        if MIDIObjectGetStringProperty(endpoint, kMIDIPropertyName, &cf) == noErr, let s = cf?.takeRetainedValue() {
            return s as String
        }
        return ""
    }

    private func handleMIDI(_ bytes: [UInt8], from device: String) {
        var i = 0
        var running: UInt8 = 0
        while i < bytes.count {
            var status = bytes[i]
            if status & 0x80 != 0 {
                i += 1
                if status >= 0xF0 {            // system messages: skip SysEx and real-time
                    if status == 0xF0 { while i < bytes.count && bytes[i] != 0xF7 { i += 1 }; i += 1 }
                    continue
                }
                running = status
            } else {
                status = running
                if status == 0 { i += 1; continue }
            }
            let kind = status & 0xF0
            let ch = Int(status & 0x0F) + 1
            let needs = (kind == 0xC0 || kind == 0xD0) ? 1 : 2
            if i + needs > bytes.count { break }
            let d1 = Int(bytes[i])
            let d2 = needs == 2 ? Int(bytes[i + 1]) : 0
            i += needs
            switch kind {
            case 0xB0: broadcast(["t": "cc", "dev": device, "ch": ch, "n": d1, "v": d2])
            case 0x90: broadcast(["t": "note", "dev": device, "ch": ch, "n": d1, "v": d2, "on": d2 > 0])
            case 0x80: broadcast(["t": "note", "dev": device, "ch": ch, "n": d1, "v": 0, "on": false])
            case 0xE0: broadcast(["t": "pb", "dev": device, "ch": ch, "v": (d2 << 7) | d1])
            default: break
            }
        }
    }

    /// Send a message to the controller(s) whose name matches `device` (or every known controller).
    private func sendMIDI(_ bytes: [UInt8], to device: String?) {
        var list = MIDIPacketList()
        let first = MIDIPacketListInit(&list)
        _ = bytes.withUnsafeBufferPointer { buf in
            MIDIPacketListAdd(&list, MemoryLayout<MIDIPacketList>.size, first, 0, bytes.count, buf.baseAddress!)
        }
        for i in 0..<MIDIGetNumberOfDestinations() {
            let dest = MIDIGetDestination(i)
            let name = Bridge.name(of: dest)
            let match = device.map { $0 == name } ?? deviceNames.contains(name)
            if match { MIDISend(outPort, dest, &list) }
        }
    }

    // MARK: WebSocket server (127.0.0.1 only)

    private func startServer() {
        do {
            let params = NWParameters.tcp
            params.allowLocalEndpointReuse = true
            params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: NWEndpoint.Port(rawValue: PORT)!)
            let ws = NWProtocolWebSocket.Options()
            ws.autoReplyPing = true
            params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
            let listener = try NWListener(using: params)
            listener.stateUpdateHandler = { [weak self] state in
                guard let self = self else { return }
                if case .failed(let err) = state {
                    self.serverError = "Can't open port \(PORT): \(err.localizedDescription)"
                    self.onChange?()
                }
            }
            listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            listener.start(queue: .main)
            self.listener = listener
        } catch {
            serverError = "Can't start: \(error.localizedDescription)"
        }
    }

    private func accept(_ conn: NWConnection) {
        let id = ObjectIdentifier(conn)
        conn.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                self.clients[id] = conn
                self.send(["t": "hello", "app": "Tonal Bridge", "version": VERSION, "devices": self.deviceNames], to: conn)
                self.onChange?()
            case .failed, .cancelled:
                self.clients.removeValue(forKey: id)
                self.onChange?()
            default: break
            }
        }
        conn.start(queue: .main)
        receive(on: conn)
    }

    private func receive(on conn: NWConnection) {
        conn.receiveMessage { [weak self] data, context, _, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty,
               let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata {
                if meta.opcode == .text { self.handleFromTonal(data) }
                if meta.opcode == .close { conn.cancel(); return }
            }
            if error == nil { self.receive(on: conn) } else { conn.cancel() }
        }
    }

    private func handleFromTonal(_ data: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let t = obj["t"] as? String else { return }
        let dev = obj["dev"] as? String
        let ch = max(1, min(16, (obj["ch"] as? Int) ?? 1)) - 1
        let n = UInt8(max(0, min(127, (obj["n"] as? Int) ?? 0)))
        let v = UInt8(max(0, min(127, (obj["v"] as? Int) ?? 0)))
        switch t {
        case "cc": sendMIDI([0xB0 | UInt8(ch), n, v], to: dev)
        case "note": sendMIDI([(v > 0 ? 0x90 : 0x80) | UInt8(ch), n, v], to: dev)
        default: break
        }
    }

    private func send(_ obj: [String: Any], to conn: NWConnection) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "tonal", metadata: [meta])
        conn.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func broadcast(_ obj: [String: Any]) {
        for conn in clients.values { send(obj, to: conn) }
    }
}

// MARK: - Menu bar

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var item: NSStatusItem!
    private let bridge = Bridge()

    func applicationDidFinishLaunching(_ notification: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let image = NSImage(systemSymbolName: "slider.horizontal.3", accessibilityDescription: "Tonal Bridge") {
            image.isTemplate = true
            item.button?.image = image
        } else {
            item.button?.title = "Tonal"
        }
        bridge.onChange = { [weak self] in self?.rebuildMenu() }
        bridge.start()
        rebuildMenu()
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        menu.addItem(disabled("Tonal Bridge \(VERSION)"))
        menu.addItem(.separator())
        if bridge.deviceNames.isEmpty {
            menu.addItem(disabled("No MIDI controller found"))
        } else {
            for name in bridge.deviceNames { menu.addItem(disabled("●  " + name)) }
        }
        if let err = bridge.serverError {
            menu.addItem(disabled(err))
        } else {
            menu.addItem(disabled(bridge.tonalConnected ? "Connected to Tonal" : "Waiting for Tonal in Premiere"))
        }
        menu.addItem(.separator())
        if #available(macOS 13.0, *) {
            let login = NSMenuItem(title: "Open at Login", action: #selector(toggleLogin), keyEquivalent: "")
            login.target = self
            login.state = SMAppService.mainApp.status == .enabled ? .on : .off
            menu.addItem(login)
        }
        let quit = NSMenuItem(title: "Quit Tonal Bridge", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
        item.menu = menu
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        it.isEnabled = false
        return it
    }

    @objc private func toggleLogin() {
        if #available(macOS 13.0, *) {
            do {
                if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
                else { try SMAppService.mainApp.register() }
            } catch {
                let alert = NSAlert()
                alert.messageText = "Couldn't change Open at Login"
                alert.informativeText = "Add Tonal Bridge in System Settings → General → Login Items instead.\n\n\(error.localizedDescription)"
                alert.runModal()
            }
            rebuildMenu()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
