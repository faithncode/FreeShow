<script lang="ts">
    import type { Item, LayoutRef, Line, OutSlide } from "../../../../types/Show"
    import type { StageItem } from "../../../../types/Stage"
    import { showsCache } from "../../../stores"
    import { getItemText } from "../../edit/scripts/textStyle"
    import { clone } from "../../helpers/array"
    import { _show } from "../../helpers/shows"
    import Textbox from "../../slide/Textbox.svelte"
    import Zoomed from "../../slide/Zoomed.svelte"
    import { getStyleResolution } from "../../slide/getStyleResolution"
    import Main from "../../system/Main.svelte"
    import { getStageTextLayoutOffset } from "../stage"

    export let currentSlide: OutSlide
    export let slideOffset = 0
    export let chords = false
    export let style = false
    export let textStyle = ""
    export let autoSize = false
    export let fontSize = 0
    export let stageItem: StageItem
    export let ref: {
        type?: "show" | "stage" | "overlay" | "template"
        showId?: string
        id: string
    }

    $: showRef = currentSlide?.id ? (_show(currentSlide.id).layouts(currentSlide.layout ? [currentSlide.layout] : "active").ref()?.[0] || []) : []

    $: slideIndex = currentSlide && currentSlide.index !== undefined && currentSlide.id !== "temp" ? currentSlide.index : null
    $: customOffset = getStageTextLayoutOffset(showRef, slideOffset, slideIndex)

    $: slideId = (customOffset !== null || slideIndex !== null) && showRef ? showRef[(customOffset ?? slideIndex)!]?.id || null : null
    $: slide = currentSlide?.id === "temp" ? getTempSlides(slideOffset) : currentSlide && slideId ? $showsCache[currentSlide?.id]?.slides?.[slideId] : null

    function getTempSlides(slideOffset: number) {
        if (slideOffset < 0) {
            let includeLength = (currentSlide.previousSlides || [])?.length
            return { items: currentSlide.previousSlides?.[includeLength - (slideOffset + 1 + includeLength)] }
        }
        if (slideOffset > 0) {
            return { items: currentSlide.nextSlides?.[slideOffset - 1] }
        }
        return { items: currentSlide.tempItems }
    }

    $: targetIndex = customOffset !== null ? customOffset : slideIndex

    // groupRefs: only used for showGroupLines (current-slide merged view)
    $: groupRefs = stageItem?.showGroupLines && targetIndex !== null && showRef && showRef[targetIndex] ? getGroupRefs(showRef, targetIndex) : []

    function getGroupRefs(refList: LayoutRef[], idx: number) {
        const targetRef = refList[idx]
        if (!targetRef) return []
        const parentId = targetRef.type === "child" ? targetRef.parent?.id : targetRef.id
        const parentLayoutIndex = targetRef.type === "child" ? targetRef.parent?.layoutIndex : targetRef.layoutIndex
        return refList.filter((ref) => {
            if (ref.id === parentId && (parentLayoutIndex === undefined || ref.layoutIndex === parentLayoutIndex)) return true
            if (ref.type === "child" && ref.parent?.id === parentId) {
                if (parentLayoutIndex !== undefined && ref.parent?.layoutIndex !== undefined) {
                    return ref.parent.layoutIndex === parentLayoutIndex
                }
                return true
            }
            return false
        })
    }

    $: itemNumber = Number(stageItem?.itemNumber || 0)
    $: reversedItems = !itemNumber && stageItem?.invertItems ? clone(slide?.items || []) : clone(slide?.items || []).reverse()
    $: langFilter = stageItem?.lineFilter || "both"

    // ── Single-group detection ───────────────────────────────────────────────
    // When a show has only ONE unique group split across child slides,
    // group-level navigation is meaningless. showGroupLines and showNextUnseen
    // both fall back to per-slide mode so singers see slide-sized chunks.
    function isSingleGroupShow(refList: LayoutRef[]): boolean {
        if (!refList?.length) return false
        const uniqueGroupIds = new Set(refList.map((r) => getGroupParentId(r)).filter(Boolean))
        return uniqueGroupIds.size === 1
    }

    // ── items ────────────────────────────────────────────────────────────
    $: items = stageItem?.showNextUnseen
        ? getNextUnseenItems(showRef, seenGroupIds, targetIndex, langFilter)
        : groupRefs.length && !isSingleGroupShow(showRef)
            ? getGroupSlideItems(groupRefs, slideId, targetIndex, langFilter)
            : style
                ? filterItemsLanguage(clone(slide?.items || []), langFilter)
                : combineSlideItems(reversedItems, langFilter)

    // ── Language filter helpers ──────────────────────────────────────────────
    function containsTamil(text: string): boolean {
        return /[\u0B80-\u0BFF]/.test(text)
    }
    function getLineTextValue(line: Line): string {
        return (line.text || []).map((t) => t.value || "").join("")
    }
    function normalizeLines(lines: Line[]): Line[] {
        const result: Line[] = []
        lines.forEach((line) => {
            const val = getLineTextValue(line)
            if (val.includes("\n") || val.includes("\r")) {
                const parts = val.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
                parts.forEach((part) => {
                    const trimmed = part.trim()
                    if (trimmed.length > 0) {
                        result.push({
                            ...line,
                            text: [{ style: line.text?.[0]?.style || "", value: trimmed }]
                        })
                    }
                })
            } else if (val.trim().length > 0) {
                result.push(line)
            }
        })
        return result
    }
    function filterLinesByMode(lines: Line[], mode: string): Line[] {
        if (!mode || mode === "both" || !lines?.length) return lines
        const normalized = normalizeLines(lines)
        const hasTamil = normalized.some((l) => containsTamil(getLineTextValue(l)))
        const hasNonTamil = normalized.some((l) => !containsTamil(getLineTextValue(l)) && getLineTextValue(l).trim().length > 0)

        // Only filter if the content is actually bilingual (has both Tamil and non-Tamil)
        if (!hasTamil || !hasNonTamil) return normalized

        return normalized.filter((line) => {
            const val = getLineTextValue(line).trim()
            if (!val) return false
            const isTam = containsTamil(val)
            return mode === "tamil" ? isTam : !isTam
        })
    }

    function filterItemsLanguage(itemsList: Item[], mode: string): Item[] {
        if (!mode || mode === "both" || !itemsList?.length) return itemsList
        return itemsList.map((item) => ({
            ...item,
            lines: filterLinesByMode(clone(item.lines || []), mode)
        }))
    }

    // ── Group key helpers (stanza = parent group, e.g. "Verse 1") ────────────
    function getGroupParentId(ref: LayoutRef): string | null {
        return ref.type === "child" ? (ref.parent?.id || null) : ref.id
    }
    function getGroupParentLayoutIndex(ref: LayoutRef): number {
        return ref.type === "child" ? (ref.parent?.layoutIndex ?? ref.layoutIndex) : ref.layoutIndex
    }

    // ── Mode 2: all lines of current group merged, active slide highlighted ──
    function getGroupSlideItems(refs: LayoutRef[], activeRefId: string | null, activeIndex: number | null, filter: string) {
        let oneItem: Item | null = null
        const highlight = stageItem?.highlightCurrentLine !== false

        const allGroupLines: (Line & { _isActive?: boolean })[] = []

        refs.forEach((gRef) => {
            const gSlide = $showsCache[currentSlide?.id]?.slides?.[gRef.id]
            if (!gSlide) return
            const isActive = activeIndex !== null && gRef.layoutIndex !== undefined ? gRef.layoutIndex === activeIndex : gRef.id === activeRefId

            const gItems = clone(gSlide.items || [])
                .filter((item) => (item?.type || "text") === "text" && (!item?.bindings?.length || item.bindings.includes("stage")))

            gItems.forEach((item, i) => {
                if (itemNumber && itemNumber - 1 !== i) return
                const text = getItemText(item)
                if (!itemNumber && !text.length) return

                if (!oneItem) oneItem = clone(item)

                const normalized = normalizeLines(clone(item.lines || []))
                normalized.forEach((l) => {
                    allGroupLines.push({ ...l, _isActive: isActive })
                })
            })
        })

        if (!oneItem) return []

        const filteredLines = filterLinesByMode(allGroupLines, filter)

        if (highlight) {
            filteredLines.forEach((line: any) => {
                const isActive = line._isActive
                line.customStyle = isActive ? "opacity: 1; color: #FFD700;" : "opacity: 1;"
                if (Array.isArray(line.text)) {
                    line.text.forEach((t: any) => {
                        t.style = (t.style || "") + (isActive ? ";opacity: 1; color: #FFD700 !important;" : ";opacity: 1;")
                    })
                }
                delete line._isActive
            })
        }

        ;(oneItem as Item).lines = filteredLines
        return [oneItem]
    }

    // ── Mode 3: default — current slide content ───────────────────────────────
    function combineSlideItems(items: Item[], filter: string) {
        let oneItem: Item | null = null
        if (!items.length) return []

        items
            .filter((item) => (item?.type || "text") === "text" && (!item?.bindings?.length || item.bindings.includes("stage")))
            .forEach((item, i) => {
                if (itemNumber && itemNumber - 1 !== i) return

                let text = getItemText(item)
                if (itemNumber || text.length) {
                    const filteredLines = filterLinesByMode(clone(item.lines || []), filter)
                    const filteredItem = { ...item, lines: filteredLines }
                    if (!oneItem) oneItem = filteredItem
                    else {
                        let EMPTY_LINE: Line = { align: "", text: [{ style: "", value: "" }] }
                        oneItem.lines!.push(EMPTY_LINE, ...(filteredItem.lines || []))
                    }
                }
            })

        if (!oneItem) return []
        return [oneItem as Item]
    }

    // ── Seen GROUP tracking (a "stanza" = the parent group, e.g. Verse 1) ────
    // When slide 3 of Verse 1 is active, the entire "Verse 1" group is considered seen.
    // Resets when the song changes. Cyclic: resets when ALL groups have been seen.
    let seenGroupIds: Set<string> = new Set()
    let lastTrackShowId: string | null = null

    $: trackSeenGroups(currentSlide?.id, targetIndex, showRef)

    function trackSeenGroups(showId: string | undefined, idx: number | null, refList: LayoutRef[]) {
        if (!showId) return
        if (showId !== lastTrackShowId) {
            seenGroupIds = new Set()
            lastTrackShowId = showId
        }
        if (idx !== null && idx !== undefined && refList[idx]) {
            const currentRef = refList[idx]
            const groupId = getGroupParentId(currentRef)
            if (!groupId) return

            seenGroupIds.add(groupId)

            // Cyclic reset: when all groups have been seen, start over
            const allGroupIds = [...new Set(refList.map((r) => getGroupParentId(r)).filter(Boolean))] as string[]
            if (allGroupIds.length > 0 && allGroupIds.every((gId) => seenGroupIds.has(gId))) {
                seenGroupIds = new Set([groupId])
            } else {
                seenGroupIds = new Set(seenGroupIds)
            }
        }
    }

    // ── Mode 1: next unseen stanza (separate box) ─────────────────────────────
    // "Stanza" = a whole GROUP (e.g. Verse 2), not a single slide within a group.
    // Collects lines from multiple slides within the next group (up to previewLines total).
    // Single-group shows fall back to per-slide mode via isSingleGroupShow().
    function getNextUnseenItems(refList: LayoutRef[], seen: Set<string>, activeIndex: number | null, filter: string): Item[] {
        if (!refList.length) return []
        const previewLines = stageItem?.nextStanzaLines ?? 2

        // Current group
        const currentGroupId = activeIndex !== null && refList[activeIndex] ? getGroupParentId(refList[activeIndex]) : null
        const currentGroupLayoutIndex = activeIndex !== null && refList[activeIndex] ? getGroupParentLayoutIndex(refList[activeIndex]) : -1

        // Build ordered list of unique groups (by parent layoutIndex)
        const groupMap = new Map<string, { layoutIndex: number }>()
        refList.forEach((ref) => {
            const gId = getGroupParentId(ref)
            const gLI = getGroupParentLayoutIndex(ref)
            if (gId && !groupMap.has(gId)) groupMap.set(gId, { layoutIndex: gLI })
        })
        const sortedGroups = [...groupMap.entries()].sort((a, b) => a[1].layoutIndex - b[1].layoutIndex)

        // Single-group fallback: no meaningful "next group" → show next slide instead
        if (isSingleGroupShow(refList)) {
            return getNextSlideItems(refList, activeIndex, filter, previewLines)
        }

        // Find next unseen group (forward, then cyclic)
        let nextGroupId: string | null = null
        for (const [gId, { layoutIndex }] of sortedGroups) {
            if (seen.has(gId) || gId === currentGroupId) continue
            if (layoutIndex <= currentGroupLayoutIndex) continue
            nextGroupId = gId; break
        }
        if (!nextGroupId) {
            for (const [gId] of sortedGroups) {
                if (seen.has(gId) || gId === currentGroupId) continue
                nextGroupId = gId; break
            }
        }
        if (!nextGroupId) return []

        // Collect all slides within that next group, sorted by layoutIndex
        const nextGroupRefs = refList
            .filter((ref) => getGroupParentId(ref) === nextGroupId)
            .sort((a, b) => a.layoutIndex - b.layoutIndex)

        // Merge lines from those slides (up to previewLines total)
        let oneItem: Item | null = null
        let linesLeft = previewLines

        for (const ref of nextGroupRefs) {
            if (linesLeft <= 0) break
            const gSlide = $showsCache[currentSlide?.id]?.slides?.[ref.id]
            if (!gSlide) continue

            const gItems = clone(gSlide.items || [])
                .filter((item: Item) => (item?.type || "text") === "text" && (!item?.bindings?.length || item.bindings.includes("stage")))

            gItems.forEach((item: Item, i: number) => {
                if (linesLeft <= 0) return
                if (itemNumber && itemNumber - 1 !== i) return
                const text = getItemText(item)
                if (!itemNumber && !text.length) return

                const filtered = filterLinesByMode(clone(item.lines || []), filter)
                const take = Math.min(linesLeft, filtered.length)
                const takenLines = filtered.slice(0, take)
                linesLeft -= take

                if (!oneItem) {
                    oneItem = { ...item, lines: takenLines }
                } else {
                    oneItem.lines!.push(...takenLines)
                }
            })
        }

        return oneItem ? [oneItem] : []
    }

    // ── Helper: show the immediate next (non-disabled) slide's content ─────────
    // Used by the single-group fallback so each slide acts as its own preview unit.
    function getNextSlideItems(refList: LayoutRef[], activeIndex: number | null, filter: string, previewLines: number): Item[] {
        if (activeIndex === null) return []

        // Walk forward from the current slide, skipping disabled slides
        let nextIdx = activeIndex + 1
        while (nextIdx < refList.length && refList[nextIdx]?.data?.disabled) nextIdx++
        if (nextIdx >= refList.length) return [] // no next slide — end of show

        const nextRef = refList[nextIdx]
        if (!nextRef) return []

        const nextSlide = $showsCache[currentSlide?.id]?.slides?.[nextRef.id]
        if (!nextSlide) return []

        const gItems = clone(nextSlide.items || [])
            .filter((item: Item) => (item?.type || "text") === "text" && (!item?.bindings?.length || item.bindings.includes("stage")))

        let oneItem: Item | null = null
        let linesLeft = previewLines

        gItems.forEach((item: Item, i: number) => {
            if (linesLeft <= 0) return
            if (itemNumber && itemNumber - 1 !== i) return
            const text = getItemText(item)
            if (!itemNumber && !text.length) return

            const filtered = filterLinesByMode(clone(item.lines || []), filter)
            const take = Math.min(linesLeft, filtered.length)
            const takenLines = filtered.slice(0, take)
            linesLeft -= take

            if (!oneItem) {
                oneItem = { ...item, lines: takenLines }
            } else {
                oneItem.lines!.push(...takenLines)
            }
        })

        return oneItem ? [oneItem] : []
    }

    // PRE LOAD SLIDE ITEMS (AUTO SIZE)

    let firstActive = false
    let items1: Item[] = []
    let items2: Item[] = []

    const waitDuration = 200
    let timeout: NodeJS.Timeout | null = null
    let prevItemsKey = ""
    $: itemsKey = `${slideId || currentSlide?.id || ""}_${slideOffset}_${itemNumber}_${stageItem?.invertItems ? 1 : 0}_${style ? 1 : 0}_${(slide?.items || []).length}_${stageItem?.showGroupLines ? 1 : 0}_${stageItem?.showGroupLines ? targetIndex : ""}_${stageItem?.highlightCurrentLine !== false ? 1 : 0}_${stageItem?.lineFilter || "both"}_${stageItem?.showNextUnseen ? 1 : 0}_${stageItem?.nextStanzaLines ?? 2}`
    $: if (items && itemsKey !== prevItemsKey) {
        prevItemsKey = itemsKey
        preloadItems()
    }
    function preloadItems() {
        if (firstActive) items2 = clone(items)
        else items1 = clone(items)

        let currentlyLoading = !firstActive

        if (timeout) clearTimeout(timeout)

        timeout = setTimeout(() => timeoutFinished(currentlyLoading), items?.length && stageItem?.auto !== false ? waitDuration : 0)
    }

    function timeoutFinished(newActive: boolean) {
        timeout = null
        firstActive = newActive

        if (firstActive) items2 = []
        else items1 = []
    }

    $: clickRevealed = slideOffset === 0 && !!currentSlide?.itemClickReveal
    $: revealed = slideOffset === 0 ? (currentSlide?.revealCount || 0) - 1 : -1

    $: useOriginalTextColor = typeof stageItem?.style === "string" && stageItem.style.includes("color:;")
</script>

{#if stageItem?.showNextUnseen}
    <!--
        NEXT UNSEEN STANZA BOX — shows the next GROUP (Verse/Chorus) not yet seen.
        A "stanza" = a whole parent group (e.g. Verse 2), not a single slide.
        Lines are collected across multiple slides within that group up to "Preview lines".
        Updates reactively; styled via this item's own Font/Text settings.
    -->
    {#each items as item}
        <Textbox {item} style={false} customStyle={textStyle} {stageItem} {chords} {ref} stageAutoSize={autoSize} {fontSize} {clickRevealed} {revealed} isStage {useOriginalTextColor} />
    {/each}
{:else if style}
    {#if slide}
        <Main let:resolution let:width let:height>
            <Zoomed background="transparent" style={getStyleResolution(resolution, width, height, "fit")} center>
                <div class:loading={items1 && !firstActive}>
                    {#each items1 as item, i}
                        {#if !itemNumber || slide?.items?.length === 1 || itemNumber - 1 === i}
                            <Textbox {item} customStyle={textStyle} {stageItem} {chords} {ref} maxLines={Number(slideOffset !== 0 && stageItem.lineCount)} maxLinesInvert={slideOffset < 0} stageAutoSize={(item.textFit !== "none" || item.auto) && autoSize} {fontSize} {clickRevealed} {revealed} isStage originalStyle />
                        {/if}
                    {/each}
                </div>
                <div class:loading={items2 && firstActive}>
                    {#each items2 as item, i}
                        {#if !itemNumber || slide?.items?.length === 1 || itemNumber - 1 === i}
                            <Textbox {item} customStyle={textStyle} {stageItem} {chords} {ref} maxLines={Number(slideOffset !== 0 && stageItem.lineCount)} maxLinesInvert={slideOffset < 0} stageAutoSize={(item.textFit !== "none" || item.auto) && autoSize} {fontSize} {clickRevealed} {revealed} isStage originalStyle />
                        {/if}
                    {/each}
                </div>
            </Zoomed>
        </Main>
    {/if}
{:else}
    <div class:loading={items1 && !firstActive}>
        {#each items1 as item}
            <Textbox {item} style={false} customStyle={textStyle} {stageItem} {chords} {ref} maxLines={Number(slideOffset !== 0 && stageItem.lineCount)} maxLinesInvert={slideOffset < 0} stageAutoSize={autoSize} {fontSize} {clickRevealed} {revealed} isStage {useOriginalTextColor} />
        {/each}
    </div>
    <div class:loading={items2 && firstActive}>
        {#each items2 as item}
            <Textbox {item} style={false} customStyle={textStyle} {stageItem} {chords} {ref} maxLines={Number(slideOffset !== 0 && stageItem.lineCount)} maxLinesInvert={slideOffset < 0} stageAutoSize={autoSize} {fontSize} {clickRevealed} {revealed} isStage {useOriginalTextColor} />
        {/each}
    </div>
{/if}

<style>
    div {
        width: 100%;
        height: 100%;
    }

    .loading {
        position: absolute;
        opacity: 0;
        top: 0;
        left: 0;
        pointer-events: none;
    }
</style>
