import { svgToPngDataUrl } from "./svg-to-png"

const labelTextureCache = new Map<string, string>()

export interface LabelTextureOptions {
  fontSize?: number
  fontFamily?: string
  padding?: number
  backgroundColor?: string
  textColor?: string
  borderRadius?: number
  minWidth?: number
  minHeight?: number
  pixelWidth?: number
}

export async function createLabelTexture(
  text: string,
  options: LabelTextureOptions = {},
): Promise<string> {
  const fontSize = options.fontSize ?? 48
  const fontFamily = options.fontFamily ?? "Arial, Helvetica, sans-serif"
  const padding = options.padding ?? fontSize * 0.4
  const backgroundColor = options.backgroundColor ?? "rgba(0,0,0,0.7)"
  const textColor = options.textColor ?? "#ffffff"
  const borderRadius = options.borderRadius ?? fontSize * 0.3
  const minWidth = options.minWidth ?? fontSize * 2
  const minHeight = options.minHeight ?? fontSize * 1.6
  const pixelWidth = options.pixelWidth ?? 512

  const estimatedTextWidth = Math.max(text.length, 1) * fontSize * 0.6
  const svgWidth = Math.max(estimatedTextWidth + padding * 2, minWidth)
  const svgHeight = Math.max(fontSize + padding * 2, minHeight)

  const cacheKey = [
    text,
    fontSize,
    fontFamily,
    padding,
    backgroundColor,
    textColor,
    borderRadius,
    minWidth,
    minHeight,
    pixelWidth,
  ].join("|")

  const cached = labelTextureCache.get(cacheKey)
  if (cached) return cached

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
    <rect x="0" y="0" width="${svgWidth}" height="${svgHeight}" rx="${borderRadius}" ry="${borderRadius}" fill="${backgroundColor}" />
    <text x="50%" y="50%" fill="${textColor}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="700" dominant-baseline="middle" text-anchor="middle">${escapeXml(
      text,
    )}</text>
  </svg>`

  const heightForPixels = Math.round((svgHeight / svgWidth) * pixelWidth)

  const dataUrl = await svgToPngDataUrl(svg, {
    width: pixelWidth,
    height: heightForPixels,
    background: "transparent",
  })

  labelTextureCache.set(cacheKey, dataUrl)

  return dataUrl
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
