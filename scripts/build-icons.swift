import Foundation
import CoreGraphics
import ImageIO

let root = FileManager.default.currentDirectoryPath
let sourceURL = URL(fileURLWithPath: root + "/assets/icon-master.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let input = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let space = CGColorSpace(name: CGColorSpace.sRGB) else {
    fatalError("Unable to read the transparent icon master")
}
let width = input.width, height = input.height, count = width * height
guard width <= 8192 && height <= 8192 else {
    fatalError("Icon master exceeds 8192 pixels per side")
}
let pixels = UnsafeMutablePointer<UInt8>.allocate(capacity: count * 4)
pixels.initialize(repeating: 0, count: count * 4)
defer { pixels.deallocate() }
let info = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
guard let context = CGContext(data: pixels, width: width, height: height,
    bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: info) else {
    fatalError("Unable to create icon canvas")
}
context.draw(input, in: CGRect(x: 0, y: 0, width: width, height: height))
var visited = [UInt8](repeating: 0, count: count)
var largest: [Int] = []
var queue: [Int] = []
for start in 0..<count where visited[start] == 0 && pixels[start * 4 + 3] >= 16 {
    queue.removeAll(keepingCapacity: true)
    queue.append(start)
    visited[start] = 1
    var head = 0
    while head < queue.count {
        let index = queue[head]
        head += 1
        let x = index % width, y = index / width
        for next in [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
                     y > 0 ? index - width : -1, y + 1 < height ? index + width : -1] {
            if next >= 0 && visited[next] == 0 && pixels[next * 4 + 3] >= 16 {
                visited[next] = 1
                queue.append(next)
            }
        }
    }
    if queue.count > largest.count { largest = queue }
}
guard largest.count > count / 3 else { fatalError("No complete icon plaque found") }
var keep = [UInt8](repeating: 0, count: count)
var minX = width, minY = height, maxX = 0, maxY = 0
for index in largest {
    keep[index] = 1
    minX = min(minX, index % width)
    maxX = max(maxX, index % width)
    minY = min(minY, index / width)
    maxY = max(maxY, index / width)
}
for index in 0..<count where keep[index] == 0 {
    for channel in 0..<4 { pixels[index * 4 + channel] = 0 }
}
guard let clean = context.makeImage(),
      let cropped = clean.cropping(to: CGRect(x: minX, y: minY,
          width: maxX - minX + 1, height: maxY - minY + 1)) else {
    fatalError("Unable to crop the icon plaque")
}
func writePNG(_ image: CGImage, canvas: Int, content: Int, to path: String) {
    guard let target = CGContext(data: nil, width: canvas, height: canvas,
        bitsPerComponent: 8, bytesPerRow: canvas * 4, space: space, bitmapInfo: info) else {
        fatalError("Unable to create output canvas")
    }
    target.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
    target.interpolationQuality = .high
    let scale = min(Double(content) / Double(image.width), Double(content) / Double(image.height))
    let drawWidth = Double(image.width) * scale, drawHeight = Double(image.height) * scale
    target.draw(image, in: CGRect(x: (Double(canvas) - drawWidth) / 2,
        y: (Double(canvas) - drawHeight) / 2, width: drawWidth, height: drawHeight))
    guard let output = target.makeImage(),
          let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL,
              "public.png" as CFString, 1, nil) else { fatalError("Unable to encode PNG") }
    CGImageDestinationAddImage(destination, output, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Unable to save PNG") }
}
writePNG(cropped, canvas: 1024, content: 976, to: root + "/assets/icon.png")
writePNG(cropped, canvas: 1024, content: 824, to: root + "/assets/icon-mac.png")
let iconset = root + "/.build/brand/AppIcon.iconset"
try FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)
let macSource = CGImageSourceCreateWithURL(URL(fileURLWithPath: root + "/assets/icon-mac.png") as CFURL, nil)!
let macImage = CGImageSourceCreateImageAtIndex(macSource, 0, nil)!
for (name, size) in [("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64), ("icon_128x128", 128),
    ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024)] {
    writePNG(macImage, canvas: size, content: size, to: iconset + "/" + name + ".png")
}
let tool = Process()
tool.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
tool.arguments = ["--convert", "icns", iconset, "--output", root + "/assets/icon.icns"]
try tool.run()
tool.waitUntilExit()
guard tool.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Cropped plaque: x=\(minX), y=\(minY), width=\(cropped.width), height=\(cropped.height)")
print("Created 1024px application and Dock PNGs; ten-size ICNS with native macOS padding")
