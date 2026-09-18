<script lang="ts">
    import type { Item, LayoutRef, Line, OutSlide } from "../../../types/Show"
    import { getStyleResolution } from "../../common/util/getStyleResolution"
    import { clone } from "../../common/util/helpers"
    import Main from "../components/Main.svelte"
    import Textbox from "../components/Textbox.svelte"
    import Zoomed from "../components/Zoomed.svelte"
    import { getLayoutRef } from "../helpers/show"
    import { getItemText } from "../helpers/textStyle"
    import { showsCache } from "../util/stores"

    export let currentSlide: OutSlide
    export let slideOffset: number = 0
    export let stageItem: any

    export let chords: boolean = false
    export let autoSize: boolean = false
    export let autoStage: boolean = true
    export let fontSize: number = 0

    export let style: boolean = false
    export let textStyle: string = ""

    $: showRef = currentSlide ? getLayoutRef(currentSlide.id, currentSlide.layout, $showsCache) : []

    $: slideIndex = currentSlide && currentSlide.index !== undefined && currentSlide.id !== "temp" ? currentSlide.index : null
    let customOffset: number | null = null
    $: if (slideOffset > 0 && slideIndex !== null && showRef) {
        let layoutOffset = slideIndex
        let offsetFromCurrentExcludingDisabled = 0
        while (offsetFromCurrentExcludingDisabled < slideOffset && layoutOffset <= showRef.length) {
            layoutOffset++
            if (!showRef[layoutOffset]?.data?.disabled) offsetFromCurrentExcludingDisabled++
        }
        customOffset = layoutOffset
    } else if (slideOffset < 0 && slideIndex !== null && showRef) {
        let layoutOffset = slideIndex
        let offsetFromCurrentExcludingDisabled = 0
        while (offsetFromCurrentExcludingDisabled > slideOffset && layoutOffset >= 0) {
            layoutOffset--
            if (!showRef[layoutOffset]?.data?.disabled) offsetFromCurrentExcludingDisabled--
        }
        customOffset = layoutOffset
    }

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

    $: items = stageItem?.showNextUnseen
        ? getNextUnseenItems(showRef, seenGroupIds, targetIndex, langFilter)
        : groupRefs.length
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

    // ── Mode 2: all group lines merged, current highlighted ──────────────────
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

        oneItem.lines = filteredLines
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

        return oneItem ? [oneItem as Item] : []
    }

    // ── Seen GROUP tracking ───────────────────────────────────────────────────
    // "Stanza" = a whole parent group (Verse 1, Chorus, etc.).
    // When any slide within Verse 1 is active, the entire "Verse 1" group is seen.
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
            const groupId = getGroupParentId(refList[idx])
            if (!groupId) return

            seenGroupIds.add(groupId)

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
    function getNextUnseenItems(refList: LayoutRef[], seen: Set<string>, activeIndex: number | null, filter: string): Item[] {
        if (!refList.length) return []
        const previewLines = stageItem?.nextStanzaLines ?? 2

        const currentGroupId = activeIndex !== null && refList[activeIndex] ? getGroupParentId(refList[activeIndex]) : null
        const currentGroupLayoutIndex = activeIndex !== null && refList[activeIndex] ? getGroupParentLayoutIndex(refList[activeIndex]) : -1

        const groupMap = new Map<string, { layoutIndex: number }>()
        refList.forEach((ref) => {
            const gId = getGroupParentId(ref)
            const gLI = getGroupParentLayoutIndex(ref)
            if (gId && !groupMap.has(gId)) groupMap.set(gId, { layoutIndex: gLI })
        })
        const sortedGroups = [...groupMap.entries()].sort((a, b) => a[1].layoutIndex - b[1].layoutIndex)

        let nextGroupId: string | null = null
        // Forward: find next unseen group after current
        for (const [gId, { layoutIndex }] of sortedGroups) {
            if (seen.has(gId) || gId === currentGroupId) continue
            if (layoutIndex <= currentGroupLayoutIndex) continue
            nextGroupId = gId; break
        }
        // Cyclic: wrap from beginning
        if (!nextGroupId) {
            for (const [gId] of sortedGroups) {
                if (seen.has(gId) || gId === currentGroupId) continue
                nextGroupId = gId; break
            }
        }
        if (!nextGroupId) return []

        // All slides within that next group, in order
        const nextGroupRefs = refList
            .filter((ref) => getGroupParentId(ref) === nextGroupId)
            .sort((a, b) => a.layoutIndex - b.layoutIndex)

        // Collect lines from slides (up to previewLines total)
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

    $: clickRevealed = slideOffset === 0 && !!currentSlide?.itemClickReveal
    $: revealed = slideOffset === 0 ? (currentSlide?.revealCount || 0) - 1 : -1
    $: slideResolution = (slide as any)?.settings?.resolution || { width: 1920, height: 1080 }
</script>

{#if stageItem?.showNextUnseen}
    <!--
        NEXT UNSEEN STANZA BOX
        "Stanza" = next unseen GROUP (e.g. Verse 2 when currently on Verse 1).
        Lines collected across slides within that group up to "Preview lines".
    -->
    {#each items as item}
        <Textbox showId={currentSlide.id} {item} style={false} customStyle={textStyle} {chords} {stageItem} {autoSize} {fontSize} {autoStage} {clickRevealed} {revealed} />
    {/each}
{:else if slide || (groupRefs.length && items.length)}
    {#if style}
        <Main let:width let:height>
            <Zoomed show={{ settings: { resolution: slideResolution } }} dynamicResolution={false} style={getStyleResolution(slideResolution, width, height, "fit")} center>
                {#each items as item, i}
                    {#if !itemNumber || itemNumber - 1 === i}
                        <Textbox showId={currentSlide.id} {item} originalStyle customStyle={textStyle} {chords} {stageItem} maxLines={Number(slideOffset !== 0 && stageItem.lineCount)} autoSize={(item.textFit !== "none" || item.auto) && autoSize} fontSize={0} {autoStage} {clickRevealed} {revealed} />
                    {/if}
                {/each}
            </Zoomed>
        </Main>
    {:else}
        {#each items as item}
            <Textbox showId={currentSlide.id} {item} style={false} customStyle={textStyle} {chords} {stageItem} maxLines={Number(slideOffset !== 0 && stageItem.lineCount)} {autoSize} {fontSize} {autoStage} {clickRevealed} {revealed} />
        {/each}
    {/if}
{/if}
