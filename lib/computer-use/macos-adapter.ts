import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_SCREENSHOT_EDGE = 1024;
const HELPER_DIR = path.join(os.tmpdir(), "ranni-computer-use");
const HELPER_PATH = path.join(HELPER_DIR, "macos-action.swift");

export type ComputerScreenshot = {
  dataUrl: string;
  displayHeight: number;
  displayWidth: number;
  path: string;
};

export type ComputerAction = Record<string, unknown>;

export type ComputerActionResult = {
  description: string;
};

type ScreenInfo = {
  accessibilityTrusted: boolean;
  displayHeight: number;
  displayWidth: number;
  pixelHeight: number;
  pixelWidth: number;
};

const HELPER_SOURCE = String.raw`
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func arg(_ index: Int) -> String {
  guard CommandLine.arguments.count > index else {
    fail("missing argument \(index)")
  }
  return CommandLine.arguments[index]
}

func doubleArg(_ index: Int) -> Double {
  guard let value = Double(arg(index)) else {
    fail("argument \(index) is not a number")
  }
  return value
}

func postMouse(_ type: CGEventType, x: Double, y: Double, button: CGMouseButton) {
  guard let event = CGEvent(
    mouseEventSource: nil,
    mouseType: type,
    mouseCursorPosition: CGPoint(x: x, y: y),
    mouseButton: button
  ) else {
    fail("failed to create mouse event")
  }
  event.post(tap: .cghidEventTap)
}

func mouseButton(_ value: String) -> CGMouseButton {
  switch value.lowercased() {
  case "right":
    return .right
  case "middle", "center":
    return .center
  default:
    return .left
  }
}

func mouseDownType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right:
    return .rightMouseDown
  case .center:
    return .otherMouseDown
  default:
    return .leftMouseDown
  }
}

func mouseUpType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right:
    return .rightMouseUp
  case .center:
    return .otherMouseUp
  default:
    return .leftMouseUp
  }
}

func mouseDraggedType(_ button: CGMouseButton) -> CGEventType {
  switch button {
  case .right:
    return .rightMouseDragged
  case .center:
    return .otherMouseDragged
  default:
    return .leftMouseDragged
  }
}

func keyCode(_ raw: String) -> CGKeyCode? {
  let key = raw.lowercased()
  if key == String(UnicodeScalar(96)!) {
    return 50
  }
  let map: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
    "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
    "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
    "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
    "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
    "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40,
    ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47,
    "tab": 48, "space": 49, "grave": 50, "backtick": 50, "delete": 51, "backspace": 51,
    "escape": 53, "esc": 53, "command": 55, "cmd": 55, "shift": 56,
    "capslock": 57, "option": 58, "alt": 58, "control": 59, "ctrl": 59,
    "rightshift": 60, "rightoption": 61, "rightcontrol": 62, "fn": 63,
    "f17": 64, "volumeup": 72, "volumedown": 73, "mute": 74, "f18": 79,
    "f19": 80, "f20": 90, "f5": 96, "f6": 97, "f7": 98, "f3": 99,
    "f8": 100, "f9": 101, "f11": 103, "f13": 105, "f16": 106, "f14": 107,
    "f10": 109, "f12": 111, "f15": 113, "help": 114, "home": 115,
    "pageup": 116, "forwarddelete": 117, "end": 119, "pagedown": 121,
    "left": 123, "arrowleft": 123, "right": 124, "arrowright": 124,
    "down": 125, "arrowdown": 125, "up": 126, "arrowup": 126
  ]
  return map[key]
}

func flagsAndKey(_ rawKeys: String) -> (CGEventFlags, CGKeyCode) {
  let keys = rawKeys.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
  var flags = CGEventFlags()
  var finalKey: CGKeyCode?

  for key in keys {
    switch key.lowercased() {
    case "command", "cmd", "meta":
      flags.insert(.maskCommand)
    case "shift":
      flags.insert(.maskShift)
    case "control", "ctrl":
      flags.insert(.maskControl)
    case "option", "alt":
      flags.insert(.maskAlternate)
    default:
      finalKey = keyCode(key)
    }
  }

  guard let code = finalKey else {
    fail("keypress must include a non-modifier key")
  }

  return (flags, code)
}

func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags, down: Bool) {
  guard let event = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: down) else {
    fail("failed to create key event")
  }
  event.flags = flags
  event.post(tap: .cghidEventTap)
}

func pasteText(_ value: String) {
  let pasteboard = NSPasteboard.general
  pasteboard.clearContents()
  pasteboard.setString(value, forType: .string)
  let flags = CGEventFlags.maskCommand
  postKey(9, flags: flags, down: true)
  usleep(20_000)
  postKey(9, flags: flags, down: false)
}

func number(_ value: Any) -> Double? {
  if let number = value as? NSNumber {
    return number.doubleValue
  }

  if let string = value as? String {
    return Double(string)
  }

  return nil
}

func parseDragPath(_ encoded: String) -> [CGPoint] {
  guard
    let data = Data(base64Encoded: encoded),
    let raw = try? JSONSerialization.jsonObject(with: data) as? [[Any]]
  else {
    fail("drag path is not valid base64 json")
  }

  let points = raw.compactMap { item -> CGPoint? in
    guard item.count >= 2, let x = number(item[0]), let y = number(item[1]) else {
      return nil
    }

    return CGPoint(x: x, y: y)
  }

  guard points.count >= 2 else {
    fail("drag path must include at least two points")
  }

  return points
}

let command = arg(1)
let displayId = CGMainDisplayID()

switch command {
case "info":
  let bounds = CGDisplayBounds(displayId)
  let payload: [String: Any] = [
    "displayWidth": bounds.width,
    "displayHeight": bounds.height,
    "pixelWidth": CGDisplayPixelsWide(displayId),
    "pixelHeight": CGDisplayPixelsHigh(displayId),
    "accessibilityTrusted": AXIsProcessTrusted()
  ]
  let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
case "move":
  let x = doubleArg(2)
  let y = doubleArg(3)
  postMouse(.mouseMoved, x: x, y: y, button: .left)
case "click":
  let x = doubleArg(2)
  let y = doubleArg(3)
  let button = mouseButton(arg(4))
  let count = Int(arg(5)) ?? 1
  postMouse(.mouseMoved, x: x, y: y, button: button)
  usleep(30_000)
  for _ in 0..<max(1, count) {
    postMouse(mouseDownType(button), x: x, y: y, button: button)
    usleep(40_000)
    postMouse(mouseUpType(button), x: x, y: y, button: button)
    usleep(80_000)
  }
case "drag":
  let points = parseDragPath(arg(2))
  let button = mouseButton(arg(3))
  guard let first = points.first, let last = points.last else {
    fail("drag path is empty")
  }
  postMouse(.mouseMoved, x: first.x, y: first.y, button: button)
  usleep(30_000)
  postMouse(mouseDownType(button), x: first.x, y: first.y, button: button)
  usleep(40_000)
  for point in points.dropFirst() {
    postMouse(mouseDraggedType(button), x: point.x, y: point.y, button: button)
    usleep(25_000)
  }
  postMouse(mouseUpType(button), x: last.x, y: last.y, button: button)
case "scroll":
  let x = doubleArg(2)
  let y = doubleArg(3)
  let dx = Int32(Double(arg(4)) ?? 0)
  let dy = Int32(Double(arg(5)) ?? 0)
  postMouse(.mouseMoved, x: x, y: y, button: .left)
  usleep(20_000)
  guard let event = CGEvent(
    scrollWheelEvent2Source: nil,
    units: .pixel,
    wheelCount: 2,
    wheel1: -dy,
    wheel2: -dx,
    wheel3: 0
  ) else {
    fail("failed to create scroll event")
  }
  event.post(tap: .cghidEventTap)
case "type":
  guard let data = Data(base64Encoded: arg(2)), let text = String(data: data, encoding: .utf8) else {
    fail("type argument is not valid base64 utf8")
  }
  pasteText(text)
case "keypress":
  let (flags, code) = flagsAndKey(arg(2))
  postKey(code, flags: flags, down: true)
  usleep(40_000)
  postKey(code, flags: flags, down: false)
default:
  fail("unknown command \(command)")
}
`;

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error);
}

async function ensureHelper() {
  await fs.mkdir(HELPER_DIR, { recursive: true });
  await fs.writeFile(HELPER_PATH, HELPER_SOURCE, "utf8");
  return HELPER_PATH;
}

async function runHelper(args: string[], signal?: AbortSignal) {
  const helper = await ensureHelper();
  const result = await execFileAsync("/usr/bin/swift", [helper, ...args], {
    signal,
    timeout: 12_000,
  });
  return result.stdout.trim();
}

async function getScreenInfo(signal?: AbortSignal): Promise<ScreenInfo> {
  const raw = await runHelper(["info"], signal);
  const parsed = JSON.parse(raw) as Partial<ScreenInfo>;

  return {
    accessibilityTrusted: Boolean(parsed.accessibilityTrusted),
    displayHeight: Number(parsed.displayHeight) || 1,
    displayWidth: Number(parsed.displayWidth) || 1,
    pixelHeight: Number(parsed.pixelHeight) || 1,
    pixelWidth: Number(parsed.pixelWidth) || 1,
  };
}

function readPngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24 ||
    buffer.toString("ascii", 1, 4) !== "PNG" ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("截图不是有效 PNG。");
  }

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

async function ensureScaledScreenshot(sourcePath: string, outputPath: string) {
  await execFileAsync("/usr/bin/sips", [
    "-s",
    "format",
    "png",
    "-Z",
    String(MAX_SCREENSHOT_EDGE),
    sourcePath,
    "--out",
    outputPath,
  ]);
}

export async function captureMacScreenshot({
  directory,
  index,
  signal,
}: {
  directory: string;
  index: number;
  signal?: AbortSignal;
}): Promise<ComputerScreenshot> {
  await fs.mkdir(directory, { recursive: true });
  const rawPath = path.join(directory, `screen-${String(index).padStart(2, "0")}-raw.png`);
  const scaledPath = path.join(directory, `screen-${String(index).padStart(2, "0")}.png`);
  const display = process.env.RANNI_COMPUTER_CAPTURE_DISPLAY?.trim();
  const args = ["-x", ...(display ? ["-D", display] : []), rawPath];

  try {
    await execFileAsync("/usr/sbin/screencapture", args, {
      signal,
      timeout: 10_000,
    });
  } catch (error) {
    throw new Error(
      [
        "macOS 截图失败，无法获取 computer-use 屏幕画面。",
        "请确认运行 Ranni 后端的 Terminal/Node 进程已在 系统设置 -> 隐私与安全性 -> 屏幕录制 中被允许，并且当前 macOS 会话有可捕获的显示器。",
        display ? `当前 RANNI_COMPUTER_CAPTURE_DISPLAY=${display}。` : "",
        `底层错误：${getErrorMessage(error)}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  await ensureScaledScreenshot(rawPath, scaledPath);

  const buffer = await fs.readFile(scaledPath);
  const dimensions = readPngDimensions(buffer);

  return {
    dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    displayHeight: dimensions.height,
    displayWidth: dimensions.width,
    path: scaledPath,
  };
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function getActionType(action: ComputerAction) {
  return readString(action.type || action.action, "unknown");
}

function mapCoordinate({
  screenshot,
  screenInfo,
  x,
  y,
}: {
  screenshot: ComputerScreenshot;
  screenInfo: ScreenInfo;
  x: number;
  y: number;
}) {
  return {
    x: (x / Math.max(1, screenshot.displayWidth)) * screenInfo.displayWidth,
    y: (y / Math.max(1, screenshot.displayHeight)) * screenInfo.displayHeight,
  };
}

function readKeys(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  return readString(value)
    .split(/[+,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDragPath(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (Array.isArray(item)) {
        return {
          x: readNumber(item[0], Number.NaN),
          y: readNumber(item[1], Number.NaN),
        };
      }

      if (item && typeof item === "object") {
        const point = item as Record<string, unknown>;
        return {
          x: readNumber(point.x, Number.NaN),
          y: readNumber(point.y, Number.NaN),
        };
      }

      return {
        x: Number.NaN,
        y: Number.NaN,
      };
    })
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

export async function executeMacAction({
  action,
  screenshot,
  signal,
}: {
  action: ComputerAction;
  screenshot: ComputerScreenshot;
  signal?: AbortSignal;
}): Promise<ComputerActionResult> {
  const screenInfo = await getScreenInfo(signal);
  const type = getActionType(action);
  const rawX = readNumber(action.x);
  const rawY = readNumber(action.y);
  const point = mapCoordinate({
    screenshot,
    screenInfo,
    x: rawX,
    y: rawY,
  });

  if (!screenInfo.accessibilityTrusted && type !== "wait" && type !== "screenshot") {
    throw new Error(
      "macOS Accessibility 权限未授予当前 Node/Terminal 进程，无法发送鼠标键盘事件。请在 系统设置 -> 隐私与安全性 -> 辅助功能 中允许当前终端或运行 Ranni 的进程。",
    );
  }

  try {
    if (type === "wait" || type === "screenshot") {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return { description: `${type}: no desktop action` };
    }

    if (type === "move") {
      await runHelper(["move", String(point.x), String(point.y)], signal);
      return { description: `move (${Math.round(rawX)}, ${Math.round(rawY)})` };
    }

    if (type === "click" || type === "double_click" || type === "doubleClick") {
      const button = readString(action.button, "left");
      const clicks = type === "click" ? 1 : 2;
      await runHelper(
        ["click", String(point.x), String(point.y), button, String(clicks)],
        signal,
      );
      return {
        description: `${type} ${button} (${Math.round(rawX)}, ${Math.round(rawY)})`,
      };
    }

    if (type === "drag") {
      const rawPath = readDragPath(action.path);

      if (rawPath.length < 2) {
        throw new Error("drag 缺少至少两个 path 坐标。");
      }

      const mappedPath = rawPath.map((item) => {
        const mapped = mapCoordinate({
          screenshot,
          screenInfo,
          x: item.x,
          y: item.y,
        });
        return [mapped.x, mapped.y];
      });
      const button = readString(action.button, "left");
      const encoded = Buffer.from(JSON.stringify(mappedPath), "utf8").toString("base64");

      await runHelper(["drag", encoded, button], signal);
      return {
        description: `drag ${button} (${Math.round(rawPath[0].x)}, ${Math.round(rawPath[0].y)}) -> (${Math.round(rawPath[rawPath.length - 1].x)}, ${Math.round(rawPath[rawPath.length - 1].y)})`,
      };
    }

    if (type === "scroll") {
      const scrollX = readNumber(action.scroll_x ?? action.scrollX ?? action.dx);
      const scrollY = readNumber(action.scroll_y ?? action.scrollY ?? action.dy);
      await runHelper(
        [
          "scroll",
          String(point.x),
          String(point.y),
          String(scrollX),
          String(scrollY),
        ],
        signal,
      );
      return {
        description: `scroll (${Math.round(scrollX)}, ${Math.round(scrollY)}) at (${Math.round(rawX)}, ${Math.round(rawY)})`,
      };
    }

    if (type === "type") {
      const text = readString(action.text);
      const encoded = Buffer.from(text, "utf8").toString("base64");
      await runHelper(["type", encoded], signal);
      return { description: `type ${text.length} chars` };
    }

    if (type === "keypress") {
      const keys = readKeys(action.keys ?? action.key);
      if (keys.length === 0) {
        throw new Error("keypress 缺少 keys。");
      }

      await runHelper(["keypress", keys.join(",")], signal);
      return { description: `keypress ${keys.join("+")}` };
    }

    throw new Error(`暂不支持 computer action: ${type}`);
  } catch (error) {
    throw new Error(`执行 macOS 动作失败：${getErrorMessage(error)}`);
  }
}
