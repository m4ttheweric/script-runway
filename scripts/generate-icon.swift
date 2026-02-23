#!/usr/bin/env swift

import Cocoa
import CoreGraphics
import CoreText

let W: CGFloat = 1024
let H: CGFloat = 1024
let cs = CGColorSpace(name: CGColorSpace.sRGB)!

guard let ctx = CGContext(
    data: nil, width: Int(W), height: Int(H),
    bitsPerComponent: 8, bytesPerRow: 0, space: cs,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { fatalError() }

func c(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: cs, components: [r, g, b, a])!
}

let bg     = c(0.04, 0.06, 0.04)
let bright = c(0.62, 1.00, 0.60)
let mid    = c(0.18, 0.48, 0.18)
let dim    = c(0.08, 0.20, 0.08)

// ---------------------------------------------------------------------------
// 1. Background + scanlines
// ---------------------------------------------------------------------------

ctx.setFillColor(bg)
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

for row in stride(from: 0, through: Int(H), by: 5) {
    ctx.setFillColor(c(0, 0, 0, 0.16))
    ctx.fill(CGRect(x: 0, y: CGFloat(row), width: W, height: 2))
}

let bloom = CGGradient(colorsSpace: cs,
    colors: [c(0.22, 0.50, 0.18, 0.12), c(0.04, 0.06, 0.04, 0.0)] as CFArray,
    locations: [0.0, 1.0])!
ctx.drawRadialGradient(bloom,
    startCenter: CGPoint(x: W/2, y: H * 0.52), startRadius: 0,
    endCenter:   CGPoint(x: W/2, y: H * 0.52), endRadius: W * 0.72,
    options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])

// ---------------------------------------------------------------------------
// 2. Runway — simple thick band at bottom
// ---------------------------------------------------------------------------

let groundTop: CGFloat = H * 0.28
let groundBot: CGFloat = 0

ctx.setFillColor(dim)
ctx.fill(CGRect(x: 0, y: groundBot, width: W, height: groundTop - groundBot))
// Thick bright edge line
ctx.setFillColor(bright)
ctx.fill(CGRect(x: 0, y: groundTop - 7, width: W, height: 8))
// Centerline dashes — fewer, thicker
let clY = groundBot + (groundTop - groundBot) * 0.5
for i in stride(from: 0, through: Int(W), by: 240) {
    ctx.setFillColor(mid)
    ctx.fill(CGRect(x: CGFloat(i), y: clY - 5, width: 110, height: 10))
}

// ---------------------------------------------------------------------------
// 3. >_ + thick streaks — rotated together
// ---------------------------------------------------------------------------

let fontSize: CGFloat = 400
let font = CTFontCreateWithName("Menlo-Bold" as CFString, fontSize, nil)
let textAttrs: [NSAttributedString.Key: Any] = [
    .font: font,
    .foregroundColor: bright,
    .kern: -20.0
]
let attrStr = NSAttributedString(string: ">_", attributes: textAttrs)
let ctLine  = CTLineCreateWithAttributedString(attrStr)
let bounds  = CTLineGetBoundsWithOptions(ctLine, .useOpticalBounds)

let screenCX: CGFloat = W * 0.54
let screenCY: CGFloat = groundTop + 280

let takeoffAngle: CGFloat = .pi / 10  // ~18° nose-up

ctx.saveGState()
ctx.translateBy(x: screenCX, y: screenCY)
ctx.rotate(by: takeoffAngle)

// Thick streaks — 5 lines, chunkier
struct Streak { var dy: CGFloat; var len: CGFloat; var h: CGFloat; var a: CGFloat }
let streaks: [Streak] = [
    Streak(dy:   0, len: 300, h: 14, a: 1.00),
    Streak(dy:  45, len: 220, h: 10, a: 0.75),
    Streak(dy: -45, len: 220, h: 10, a: 0.75),
    Streak(dy:  95, len: 130, h:  7, a: 0.45),
    Streak(dy: -95, len: 130, h:  7, a: 0.45),
]

let leftEdge = -bounds.width / 2 - bounds.origin.x - 14
for s in streaks {
    ctx.setFillColor(bright.copy(alpha: s.a)!)
    ctx.fill(CGRect(x: leftEdge - s.len, y: s.dy - s.h/2, width: s.len, height: s.h))
}

// >_ text
ctx.setFillColor(bright)
ctx.textMatrix = .identity
ctx.translateBy(x: -bounds.width/2 - bounds.origin.x,
                y: -bounds.height/2 - bounds.origin.y)
CTLineDraw(ctLine, ctx)
ctx.restoreGState()

// ---------------------------------------------------------------------------
// 4. Write PNG
// ---------------------------------------------------------------------------

guard let img = ctx.makeImage() else { fatalError() }
let bmp = NSBitmapImageRep(cgImage: img)
bmp.size = CGSize(width: W, height: H)
guard let png = bmp.representation(using: .png, properties: [:]) else { fatalError() }
try! png.write(to: URL(fileURLWithPath: "images/icon.png"))
print("✓ Saved \(Int(W))×\(Int(H)) icon to images/icon.png")
