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
 * Parse CSS transform (scaleX, scaleY, rotate) from an item style string.
 */
function parseItemTransform(style: string = ""): { scaleX: number; scaleY: number; rotate: number } {
    const res = { scaleX: 1, scaleY: 1, rotate: 0 }
    const match = style.match(/(?:^|;)\s*transform\s*:\s*([^;]+)/i)
    if (!match) return res
    const val = match[1]
    const sx = val.match(/scaleX\(\s*(-?[\d.]+)\s*\)/i)
    if (sx) res.scaleX = parseFloat(sx[1])
    const sy = val.match(/scaleY\(\s*(-?[\d.]+)\s*\)/i)
    if (sy) res.scaleY = parseFloat(sy[1])
    const rot = val.match(/rotate\(\s*(-?[\d.]+)deg\s*\)/i)
    if (rot) res.rotate = parseFloat(rot[1])
    return res
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

// ─────────────────────────────────────────────────────────────────────────────
// Core canvas drawing helper — shared by both export functions.
// ─────────────────────────────────────────────────────────────────────────────

async function drawItemsOntoContext(
    ctx: CanvasRenderingContext2D,
    items: any[],
    targetWidth: number,
    targetHeight: number,
    bgColor: string | null | undefined,
    masterBgColor: string | null | undefined,
    bgItemsOnly: boolean
): Promise<void> {
    // 1. Draw base background fill
    const bgFill = bgColor || masterBgColor || ""
    if (bgFill && bgFill !== "transparent") {
        ctx.fillStyle = bgFill
        ctx.fillRect(0, 0, targetWidth, targetHeight)
    }

    // 2. Iterate items in their natural z-order
    for (const item of items || []) {
        // In bg-only mode, only include MEDIA items (the full-canvas slide/master photo
        // and master decoration pictures like watermarks/logos).
        // Shapes (rounded rectangles, lines, icons) belong to the slide layer, NEVER
        // baked into the common background image.
        if (bgItemsOnly) {
            if (item.type !== "media") continue
            const isDecoration = !!item.decoration
            const pos = parseItemPosition(item)
            const isFullCanvas = pos.left === 0 && pos.top === 0 && pos.width >= 1900 && pos.height >= 1060
            if (!isDecoration && !isFullCanvas) continue
        }

        if (item.type === "media" && item.src) {
            // Skip video elements
            const ext = (item.src.split(".").pop() || "").toLowerCase()
            if (["mp4", "webm", "mov", "mkv", "avi"].includes(ext) || item.loop !== undefined) continue

            const img = await loadImage(item.src)
            if (!img) continue

            const iw = img.naturalWidth || 1
            const ih = img.naturalHeight || 1
            const crop = getItemCrop(item)

            let sx = 0,
                sy = 0,
                sWidth = iw,
                sHeight = ih

            if (crop.left + crop.right < 1 && crop.top + crop.bottom < 1) {
                sx = Math.round(iw * crop.left)
                sy = Math.round(ih * crop.top)
                sWidth = Math.max(1, Math.round(iw * (1 - crop.left - crop.right)))
                sHeight = Math.max(1, Math.round(ih * (1 - crop.top - crop.bottom)))
            }

            const pos = parseItemPosition(item)
            const opacity = parseItemOpacity(item.style)
            const transform = parseItemTransform(item.style)

            ctx.save()
            if (opacity < 1) ctx.globalAlpha = opacity
            if (transform.scaleX !== 1 || transform.scaleY !== 1 || transform.rotate !== 0) {
                const cx = pos.left + pos.width / 2
                const cy = pos.top + pos.height / 2
                ctx.translate(cx, cy)
                if (transform.scaleX !== 1 || transform.scaleY !== 1) ctx.scale(transform.scaleX, transform.scaleY)
                if (transform.rotate !== 0) ctx.rotate((transform.rotate * Math.PI) / 180)
                ctx.translate(-cx, -cy)
            }
            ctx.drawImage(img, sx, sy, sWidth, sHeight, pos.left, pos.top, pos.width, pos.height)
            ctx.restore()
        } else if (item.type === "icon" && item.customSvg) {
            // Render SVG icon shape
            const svgUrl = "data:image/svg+xml;utf8," + encodeURIComponent(item.customSvg)
            const img = await loadImage(svgUrl)
            if (img) {
                const pos = parseItemPosition(item)
                const opacity = parseItemOpacity(item.style)
                const transform = parseItemTransform(item.style)

                ctx.save()
                if (opacity < 1) ctx.globalAlpha = opacity
                if (transform.scaleX !== 1 || transform.scaleY !== 1 || transform.rotate !== 0) {
                    const cx = pos.left + pos.width / 2
                    const cy = pos.top + pos.height / 2
                    ctx.translate(cx, cy)
                    if (transform.scaleX !== 1 || transform.scaleY !== 1) ctx.scale(transform.scaleX, transform.scaleY)
                    if (transform.rotate !== 0) ctx.rotate((transform.rotate * Math.PI) / 180)
                    ctx.translate(-cx, -cy)
                }
                ctx.drawImage(img, 0, 0, img.naturalWidth || pos.width, img.naturalHeight || pos.height, pos.left, pos.top, pos.width, pos.height)
                ctx.restore()
            }
        }
    }
}

/**
 * Save a canvas as a PNG to disk (or return base64 if no folder given).
 */
async function saveCanvasToDisk(canvas: HTMLCanvasElement, contentFolder: string, fileName: string): Promise<string> {
    const base64 = canvas.toDataURL("image/png")
    if (!contentFolder) return base64

    // Detect the separator used by the OS from the folder path itself.
    // On Windows contentFolder arrives as a native backslash path; always
    // joining with "/" produces mixed separators that break Electron's
    // file-URL encoding on Windows.
    const sep = contentFolder.includes("\\") ? "\\" : "/"
    const targetPath = `${contentFolder.replace(/[/\\]+$/, "")}${sep}${fileName}`
    try {
        const savedPath = await requestMain(Main.SAVE_IMAGE, { path: targetPath, base64, format: "png" })
        return savedPath || targetPath
    } catch (e) {
        console.warn("Could not save composited slide image to disk, falling back to base64:", e)
        return base64
    }
}

/**
 * Composite a no-text (or mixed image+text) PowerPoint slide into a single PNG.
 *
 * Merges:
 *  1. Slide / Layout / Master background fill color or gradient.
 *  2. Master slide template background picture.
 *  3. Master / Layout decoration pictures.
 *  4. ALL slide picture shapes (PNGs, etc.) with exact positioning, opacity, and PPT crops.
 *
 * Use for: pure image slides, or slides where you want the whole visual composited.
 * Saves the PNG to the presentation's import media folder and returns its path.
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

    await drawItemsOntoContext(ctx, slide.items, targetWidth, targetHeight, slide.bgColor, slide.masterBgColor, false)

    const fileName = `slide_${slideIndex + 1}_bg_${uid(6)}.png`
    return saveCanvasToDisk(canvas, contentFolder, fileName)
}

/**
 * Composite ONLY the background / master template layers of a slide into a PNG,
 * skipping all text-box items. This produces the "template background" image that
 * can be set as the FreeShow slide background so the text overlay renders on top.
 *
 * Merges:
 *  1. bgColor / masterBgColor fill.
 *  2. Full-canvas bgImage (the slide or master background blip image).
 *  3. Decoration items from master / layout (item.decoration === true).
 *
 * The result is deduplicated per layout: the caller should check `layoutBgCache`
 * before calling this and store the result back into it.
 *
 * @param slide        - The converted slide object from PowerPointHelper.
 * @param contentFolder - Folder path where the PNG is saved on disk.
 * @param layoutKey    - A unique string identifying this layout (e.g. "layout_2").
 *                       Used only for the filename — dedup is handled by the caller.
 * @param targetWidth  - Canvas width (default 1920).
 * @param targetHeight - Canvas height (default 1080).
 */
export async function compositeBackgroundOnly(
    slide: {
        items: any[]
        bgColor?: string | null
        masterBgColor?: string | null
        bgImage?: string | null
        layoutNumber?: number
    },
    contentFolder: string,
    layoutKey: string,
    targetWidth = 1920,
    targetHeight = 1080
): Promise<string> {
    const canvas = document.createElement("canvas")
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""

    await drawItemsOntoContext(ctx, slide.items, targetWidth, targetHeight, slide.bgColor, slide.masterBgColor, true)

    const fileName = `layout_bg_${layoutKey}_${uid(6)}.png`
    return saveCanvasToDisk(canvas, contentFolder, fileName)
}
