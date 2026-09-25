import { uid } from "uid"
import { Main } from "../../../types/IPC/Main"
import { requestMain } from "../../IPC/main"
import { encodeFilePath } from "../../components/helpers/media"

/**
 * Load an image from a path or data URL into an HTMLImageElement asynchronously.
 */
function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        if (!src) return resolve(null)
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => resolve(img)
        img.onerror = (err) => {
            console.warn("Failed to load image for slide composite:", src, err)
            resolve(null)
        }
        img.src = encodeFilePath(src)
    })
}

/**
 * Extract pixel coordinates (left, top, width, height) from an item.
 * Prefers the raw _pos object if attached, otherwise falls back to parsing item.style.
 */
export function parseItemPosition(item: any): { left: number; top: number; width: number; height: number } {
    if (item._pos) {
        return {
            left: item._pos.left || 0,
            top: item._pos.top || 0,
            width: item._pos.width || 1920,
            height: item._pos.height || 1080
        }
    }
    const style = item.style || ""
    const parseProp = (prop: string, fallback: number) => {
        const match = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([\\d.-]+)px`, "i"))
        if (match && !isNaN(Number(match[1]))) {
            return parseFloat(match[1])
        }
        return fallback
    }
    return {
        left: parseProp("left", 0),
        top: parseProp("top", 0),
        width: parseProp("width", 1920),
        height: parseProp("height", 1080)
    }
}

/**
 * Parse opacity value (0..1) from an item style string.
 */
function parseItemOpacity(style: string = ""): number {
    const match = style.match(/(?:^|;)\s*opacity\s*:\s*([\d.]+)/i)
    if (match && !isNaN(Number(match[1]))) {
        return parseFloat(match[1])
    }
    return 1
}

/**
 * Extract normalized crop fractions (0..1) from item cropping configuration.
 */
function getItemCrop(item: any): { left: number; top: number; right: number; bottom: number } {
    if (!item.cropping) return { left: 0, top: 0, right: 0, bottom: 0 }
    const divisor = item.cropping.type === "ppt" ? 100 : 1
    const l = Math.max(0, (Number(item.cropping.left) || 0) / divisor)
    const t = Math.max(0, (Number(item.cropping.top) || 0) / divisor)
    const r = Math.max(0, (Number(item.cropping.right) || 0) / divisor)
    const b = Math.max(0, (Number(item.cropping.bottom) || 0) / divisor)
    return { left: l, top: t, right: r, bottom: b }
}

/**
 * Composite a no-text PowerPoint slide into a single high-quality PNG image.
 *
 * Merges:
 *  1. Slide / Layout / Master background fill color or gradient.
 *  2. Master slide template background picture (if present).
 *  3. Master / Layout decoration pictures.
 *  4. Slide picture shapes (PNGs, etc.) with exact positioning, dimensions, opacity, and PowerPoint crops (a:srcRect).
 *
 * Saves the composited PNG to the presentation's import media folder on disk and returns its path.
 */
export async function compositeSlideImage(
    slide: {
        items: any[]
        bgColor?: string | null
        masterBgColor?: string | null
        bgImage?: string | null
    },
    contentFolder: string,
    slideIndex: number,
    targetWidth = 1920,
    targetHeight = 1080
): Promise<string> {
    const canvas = document.createElement("canvas")
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""

    // 1. Draw base background fill (slide bgColor or master/layout fallback)
    const bgFill = slide.bgColor || slide.masterBgColor || ""
    if (bgFill && bgFill !== "transparent") {
        ctx.fillStyle = bgFill
        ctx.fillRect(0, 0, targetWidth, targetHeight)
    }

    // 2. Iterate through items in their natural z-order (master/bg items first, then slide pictures)
    for (const item of slide.items || []) {
        if (item.type === "media" && item.src) {
            // Skip video elements
            const ext = (item.src.split(".").pop() || "").toLowerCase()
            if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext) || item.loop !== undefined) {
                continue
            }

            const img = await loadImage(item.src)
            if (!img) continue

            const iw = img.naturalWidth || 1
            const ih = img.naturalHeight || 1
            const crop = getItemCrop(item)

            let sx = 0
            let sy = 0
            let sWidth = iw
            let sHeight = ih

            if (crop.left + crop.right < 1 && crop.top + crop.bottom < 1) {
                sx = Math.round(iw * crop.left)
                sy = Math.round(ih * crop.top)
                sWidth = Math.max(1, Math.round(iw * (1 - crop.left - crop.right)))
                sHeight = Math.max(1, Math.round(ih * (1 - crop.top - crop.bottom)))
            }

            const pos = parseItemPosition(item)
            const opacity = parseItemOpacity(item.style)

            ctx.save()
            if (opacity < 1) ctx.globalAlpha = opacity
            ctx.drawImage(img, sx, sy, sWidth, sHeight, pos.left, pos.top, pos.width, pos.height)
            ctx.restore()
        } else if (item.type === "icon" && item.customSvg) {
            // Render vector SVG shape if present
            const svgUrl = "data:image/svg+xml;utf8," + encodeURIComponent(item.customSvg)
            const img = await loadImage(svgUrl)
            if (img) {
                const pos = parseItemPosition(item)
                const opacity = parseItemOpacity(item.style)
                ctx.save()
                if (opacity < 1) ctx.globalAlpha = opacity
                ctx.drawImage(img, 0, 0, img.naturalWidth || pos.width, img.naturalHeight || pos.height, pos.left, pos.top, pos.width, pos.height)
                ctx.restore()
            }
        }
    }

    const base64 = canvas.toDataURL("image/png")
    if (!contentFolder) return base64

    // Save to disk in presentation's import media folder
    const fileName = `slide_${slideIndex + 1}_bg_${uid(6)}.png`
    const targetPath = `${contentFolder.replace(/[/\\]+$/, "")}/${fileName}`

    try {
        const savedPath = await requestMain(Main.SAVE_IMAGE, { path: targetPath, base64, format: "png" })
        return savedPath || targetPath
    } catch (e) {
        console.warn("Could not save composited slide image to disk, falling back to base64:", e)
        return base64
    }
}
