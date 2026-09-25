import { get } from "svelte/store"
import { uid } from "uid"
import type { Show, Slide, SlideData } from "../../../types/Show"
import { ShowObj } from "../../classes/Show"
import { checkName } from "../../components/helpers/show"
import { activePopup, alertMessage, drawerTabsData, special } from "../../stores"
import { translateText } from "../../utils/language"
import { createCategory, setTempShows } from "../importHelpers"
import { PowerPointPackage } from "./PowerPointHelper"
import { compositeSlideImage } from "./powerpointCompositor"

// missing shapes/tables/graphs
// item/line background, some text color incorrect
// extract embedded videos/audio

export function convertPowerpoint(files: any[]) {
    activePopup.set("alert")
    alertMessage.set("popup.importing")

    // use selected category (or Presentation if no specific is selected)
    let categoryId = get(drawerTabsData).shows?.activeSubTab
    if (categoryId === "all" || categoryId === "unlabeled") categoryId = createCategory("presentation", "presentation", { isDefault: true })

    const tempShows: any[] = []
    const shouldMergeNoTextSlides = get(special).pptMergeNoTextSlides ?? false

    setTimeout(async () => {
        for (const { name, content } of files) {
            // console.log("PPT", content)

            let pkg: PowerPointPackage
            try {
                pkg = new PowerPointPackage(content)
            } catch {
                continue
            }
            const presentationPart = pkg.getPresentation()
            if (!presentationPart) continue

            // load font faces
            const contentPaths = content.contentPaths || {}
            // loadAllFonts(contentPaths)
            const fonts = getAllFontNames(contentPaths)

            const contentFolder = content.contentFolder || (Object.values(contentPaths)[0] ? (Object.values(contentPaths)[0] as string).replace(/[/\\][^/\\]+$/, "") : "")

            const convertedSlides = pkg.getSlides()
            let slides: { [key: string]: Slide } = {}
            let layouts: SlideData[] = []
            let firstSlideId = ""
            const showMedia: Show["media"] = {}

            for (let slideIdx = 0; slideIdx < convertedSlides.length; slideIdx++) {
                const slide = convertedSlides[slideIdx]
                if (!slide) continue

                const id = uid()

                const slideData: Slide = {
                    group: !firstSlideId ? "." : null,
                    color: null,
                    settings: { color: slide.bgColor || "" },
                    notes: slide.notes,
                    items: slide.items
                }

                // ── Scripture / verse slide detection ───────────────────────────────
                // A slide is treated as a scripture slide when its PPTX layout is
                // named "verse", "scripture", or "bible" (case-insensitive), OR when
                // it contains a text block that matches the "Book chapter:verse"
                // pattern of a Bible reference.
                const scriptureValues = buildScriptureDynamicValues(slide)
                if (scriptureValues) {
                    slideData.customDynamicValues = scriptureValues
                    slideData.globalGroup = "scripture"
                }
                // ───────────────────────────────────────────────────────────────────

                const noTransition = { type: "none", duration: 0, easing: "linear" } as const
                const layoutData: SlideData = { id, transition: noTransition, mediaTransition: noTransition }

                // ── No-text slide background & PNG merging ─────────────────────────
                // When enabled, for slides with NO text content (and not scripture),
                // composite master/layout background and picture shapes into a single
                // background image. This eliminates transparent item transition flashes
                // (dip to black/white) and keeps the composited image as background.
                const textBlocks = extractTextBlocks(slide.items)
                const isNoTextSlide = textBlocks.length === 0 && !scriptureValues

                if (shouldMergeNoTextSlides && isNoTextSlide) {
                    const hasMedia = slide.items.some((i: any) => (i.type === "media" && i.src) || (i.type === "icon" && i.customSvg)) || !!slide.bgImage
                    if (hasMedia) {
                        try {
                            const mergedImagePath = await compositeSlideImage(slide, contentFolder, slideIdx)
                            if (mergedImagePath) {
                                const mediaId = uid()
                                showMedia[mediaId] = {
                                    name: `Slide ${slideIdx + 1}`,
                                    path: mergedImagePath,
                                    type: "image"
                                }
                                layoutData.background = mediaId
                                slideData.settings = { ...slideData.settings, color: "" }
                                slideData.items = []
                            }
                        } catch (err) {
                            console.error("Failed to composite no-text slide:", err)
                        }
                    }
                }
                // ───────────────────────────────────────────────────────────────────

                if (!firstSlideId) {
                    firstSlideId = id
                    slideData.children = []
                    layouts.push({ ...layoutData, children: {} })
                } else {
                    slides[firstSlideId].children!.push(id)
                    layouts[0].children![id] = layoutData
                }

                slides[id] = slideData
            }

            // create show
            const layoutID = uid()
            const show: Show = new ShowObj(false, categoryId, layoutID, 0, false)
            show.name = checkName(name)
            show.origin = "powerpoint"
            show.settings.customFonts = fonts
            show.media = showMedia

            const meta: any = content["docProps/core.xml"]?.["cp:coreProperties"]
            if (meta) {
                show.meta = {
                    title: meta["dc:title"]?.[0] || show.name,
                    artist: meta["dc:creator"]?.[0] || ""
                }
                show.timestamps = {
                    created: new Date(meta["dcterms:created"]?.[0]?._ || 0).getTime(),
                    modified: new Date(meta["dcterms:modified"]?.[0]?._ || 0).getTime(),
                    used: null
                }
            }

            show.slides = slides
            show.layouts = { [layoutID]: { name: translateText("example.default"), notes: "", slides: layouts } }

            tempShows.push({ id: uid(), show })
        }

        setTempShows(tempShows)
    }, 10)
}

// ── Scripture detection & dynamic-value builder ───────────────────────────────

/**
 * Layout names (lowercased, substring match) that identify a scripture slide.
 * These match the p:sldLayout @name attribute from the PPTX file.
 */
const SCRIPTURE_LAYOUT_KEYWORDS = ["verse", "scripture", "bible", "bibleverse", "scriptureverse"]

/**
 * Layout numbers that identify a verse slide in common PPT templates (e.g. layout 2).
 */
const SCRIPTURE_LAYOUT_NUMBERS = [2]

/**
 * Extract all plain-text blocks from a slide's items (text boxes only).
 * Each text box becomes one block; multi-line boxes are joined with newlines.
 */
function extractTextBlocks(items: any[]): string[] {
    const blocks: string[] = []
    for (const item of items) {
        if (item.type && item.type !== "text") continue
        const lines: string[] = []
        for (const line of item.lines || []) {
            const parts = (line.text || []).map((t: any) => t.value || "").join("")
            if (parts.trim()) lines.push(parts.trim())
        }
        const joined = lines.join("\n").trim()
        if (joined) blocks.push(joined)
    }
    return blocks
}

/**
 * Return true when the text looks like a Bible reference (e.g. "John 6:12", "யோவான் 6:12", "1 Kings 2:3").
 * Language-agnostic: checks for chapter:verse pattern ("\d+:\d+") in a short text block.
 */
function looksLikeReference(text: string): boolean {
    const t = text.trim()
    if (!t || t.length > 80) return false
    return /\b\d+:\d+/.test(t)
}

/**
 * Parse "Book 1:2-4" or "யோவான் 6:12" → { book, chapter, verses }.
 * Language-agnostic: splits by the colon, and extracts chapter from before the colon.
 */
function parseReference(ref: string): { book: string; chapter: string; verses: string } {
    const t = ref.trim()
    const colonIdx = t.lastIndexOf(":")
    if (colonIdx === -1) return { book: t, chapter: "", verses: "" }

    const afterColon = t.slice(colonIdx + 1).trim()
    const beforeColon = t.slice(0, colonIdx).trim()

    const lastSpaceIdx = beforeColon.lastIndexOf(" ")
    let book = ""
    let chapter = ""

    if (lastSpaceIdx !== -1) {
        chapter = beforeColon.slice(lastSpaceIdx + 1).trim()
        book = beforeColon.slice(0, lastSpaceIdx).trim()
    } else {
        const match = beforeColon.match(/^(.*?)(\d+)$/)
        if (match) {
            book = match[1].trim()
            chapter = match[2].trim()
        } else {
            book = beforeColon
            chapter = ""
        }
    }

    return { book: book || t, chapter, verses: afterColon }
}

/**
 * Safe grapheme abbreviation for books across all languages/scripts (e.g. Tamil).
 */
function getBookAbbreviation(book: string): string {
    if (!book) return ""
    if (typeof Intl !== "undefined" && (Intl as any).Segmenter) {
        const seg = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" })
        return Array.from(seg.segment(book)).map((s: any) => s.segment).slice(0, 3).join("")
    }
    return Array.from(book).slice(0, 3).join("")
}

/**
 * If `slide` looks like a scripture slide, return the full `customDynamicValues`
 * object that FreeShow's template engine (output.ts replaceScriptureValues)
 * expects; otherwise return null.
 *
 * Rules:
 *  - No database lookups or strict book dictionaries.
 *  - If the layout is a verse layout (e.g. layout 2), it DEFINITELY becomes a scripture slide.
 *  - Any short name, abbreviation, or language (Tamil, English, etc.) is preserved as-is.
 */
function buildScriptureDynamicValues(slide: { items: any[]; layoutName?: string; layoutNumber?: number }): { [key: string]: string | [string, string][] } | null {
    const layoutName = (slide.layoutName || "").toLowerCase()
    const layoutNumber = slide.layoutNumber || 0

    const byLayoutName = SCRIPTURE_LAYOUT_KEYWORDS.some((kw) => layoutName.includes(kw))
    const byLayoutNumber = SCRIPTURE_LAYOUT_NUMBERS.includes(layoutNumber)
    const byLayout = byLayoutName || byLayoutNumber

    const textBlocks = extractTextBlocks(slide.items)

    // Identify the reference block:
    // 1. Any block that contains a chapter:verse pattern (e.g. 6:12, 1:1) in any language
    let refIdx = textBlocks.findIndex(looksLikeReference)

    // 2. If it's a verse layout, definitely proceed!
    //    If there are 2 blocks, shorter block is the reference, larger is the verse
    if (refIdx === -1 && byLayout && textBlocks.length >= 2) {
        refIdx = textBlocks[0].length <= textBlocks[1].length ? 0 : 1
    }

    // If it's neither a verse layout nor does it have a reference block, skip
    if (!byLayout && refIdx === -1) return null

    const reference = refIdx !== -1 ? textBlocks[refIdx].trim() : ""

    // Verse text = every text block that is NOT the reference, joined.
    const verseText = textBlocks
        .filter((_, i) => i !== refIdx)
        .join("\n")
        .trim()

    // Parse book / chapter / verses directly from the string (no DB or dictionary check)
    const { book, chapter, verses } = reference ? parseReference(reference) : { book: "", chapter: "", verses: "" }
    const bookAbbr = getBookAbbreviation(book)

    // Verse-content array:  [verseNumber, verseText]
    //   verseNumber "0" → suppress the superscript in the template
    const scriptureTextContent: [string, string][] = [["0", verseText]]

    // Build the same customDynamicValues shape that scripture.ts produces:
    //   • string values       → simple {token} replacement in the template
    //   • [string,string][]   → verse-content arrays processed by replaceScriptureValues
    const dv: { [key: string]: string | [string, string][] } = {
        // ── version / name ────────────────────────────────────────────────────
        scripture_name: "",
        scripture1_name: "",

        // ── book ──────────────────────────────────────────────────────────────
        scripture_book: book,
        scripture_book_abbr: bookAbbr,
        scripture1_book: book,
        scripture1_book_abbr: bookAbbr,

        // ── chapter ───────────────────────────────────────────────────────────
        scripture_chapter: chapter,
        scripture1_chapter: chapter,

        // ── verse range ───────────────────────────────────────────────────────
        // {scripture_verses} = just the verse number(s), e.g. "1-3"
        scripture_verses: verses,
        scripture1_verses: verses,

        // ── full reference strings ─────────────────────────────────────────────
        // {scripture_reference}      = per-slide reference (e.g. "Genesis 1:1-3")
        // {scripture_reference_full} = across all slides in the show
        // {scripture_reference_last} = only shown on the last slide
        scripture_reference: reference,
        scripture1_reference: reference,
        scripture_reference_full: reference,
        scripture_reference_last: reference, // FreeShow clears this on non-last slides

        // ── verse text (array form, consumed by replaceScriptureValues) ────────
        scripture_text: scriptureTextContent,
        scripture1_text: scriptureTextContent,

        // ── empty placeholders for additional parallel bibles (2-4) ───────────
        // Keeps the shape identical to built-in scripture slides so
        // mergeWithTemplate never encounters undefined keys.
        scripture2_name: "",
        scripture2_book: "",
        scripture2_book_abbr: "",
        scripture2_chapter: "",
        scripture3_name: "",
        scripture3_book: "",
        scripture3_book_abbr: "",
        scripture3_chapter: "",
        scripture4_name: "",
        scripture4_book: "",
        scripture4_book_abbr: "",
        scripture4_chapter: ""
    }

    return dv
}

// ── Font helpers ───────────────────────────────────────────────────────────────

function getAllFontNames(contentPaths: Record<string, string>) {
    const fontNames: { name: string; path: string }[] = []
    Object.keys(contentPaths).forEach((key) => {
        if (key.startsWith("ppt/fonts/") && key.endsWith(".fntdata")) {
            const fileName = key.slice(key.lastIndexOf("/") + 1)
            const match = fileName.match(/^(.+?)-?(regular|bold|italic|boldItalic)?\.fntdata$/i)
            if (match) {
                const name = spaceOnUppercase(match[1])
                fontNames.push({ name, path: contentPaths[key] })
            }
        }
    })
    return fontNames
}

function spaceOnUppercase(str: string) {
    // should not have space if there are multiple uppercase in a row (e.g., "PT Sans" not "P T Sans")
    return str.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
}
