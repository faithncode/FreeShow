<script lang="ts">
    import { onDestroy } from "svelte"
    import type { LayoutRef, Line } from "../../../types/Show"
    import { peekStanzaAction } from "../actions/apiHelper"
    import { getLayoutRef } from "../helpers/show"
    import { _show } from "../helpers/shows"
    import { getActiveOutputs, getFirstActiveOutput } from "../helpers/output"
    import { send } from "../../utils/request"
    import { OUTPUT, STAGE } from "../../../types/Channels"
    import { allOutputs, currentWindow, outputs, showsCache, showStanzaMenu, stagePeekStanza } from "../../stores"

    export let sourceOutputId: string = ""
    export let lineFilter: string = "both"

    const VERSE_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "["]
    const AUTO_CLOSE_S = 5

    interface StanzaInfo {
        groupId: string
        firstSlideIndex: number
        label: string
        hotkey: string
        displayKey: string
        type: "chorus" | "intro" | "bridge" | "verse"
        badgeColor: string
        lines: string[]
        isCurrent: boolean
    }

    const HOTKEY_META: Record<string, { label: string; color: string }> = {
        a: { label: "CHORUS", color: "#FFB400" },
        s: { label: "INTRO", color: "#5B9BD5" },
        b: { label: "BRIDGE", color: "#B07FD4" }
    }
    VERSE_KEYS.forEach((k, i) => {
        HOTKEY_META[k] = { label: `Verse ${i + 1}`, color: "#94A3B8" }
    })

    $: outputStores = $currentWindow === "output" ? $allOutputs : $outputs
    $: stageMainOutputId = sourceOutputId && outputStores[sourceOutputId] ? sourceOutputId : getActiveOutputs(outputStores, false, true, true)[0]
    $: currentOutput =
        outputStores[stageMainOutputId] ||
        Object.values(outputStores).find((o) => !o.stageOutput && o.out?.slide?.id && o.out.slide.id !== "temp") ||
        Object.values(outputStores).find((o) => o.out?.slide?.id && o.out.slide.id !== "temp") ||
        getFirstActiveOutput() ||
        {}
    $: currentSlide = currentOutput?.out?.slide
    $: slideIndex = currentSlide && currentSlide.index !== undefined && currentSlide.id !== "temp" ? currentSlide.index : null

    function resolveShowRef(slide: any, cache: any): LayoutRef[] {
        if (!slide?.id || slide.id === "temp") return []
        const show = cache?.[slide.id] || _show(slide.id).get()
        if (!show?.layouts) return []

        const targetLayout = slide.layout || show.settings?.activeLayout || Object.keys(show.layouts)[0]
        if (targetLayout && show.layouts[targetLayout]) {
            const ref = _show(slide.id).layouts([targetLayout]).ref()?.[0]
            if (ref && ref.length) return ref
        }

        const defaultRef = getLayoutRef(slide.id)
        if (defaultRef && defaultRef.length) return defaultRef

        const anyRef = _show(slide.id).layouts([]).ref()?.[0]
        return anyRef || []
    }

    $: showRef = resolveShowRef(currentSlide, $showsCache)

    function getLineText(line: Line): string {
        return (line.text || []).map((t) => t.value || "").join("")
    }

    let stanzas: StanzaInfo[] = []
    $: {
        if (!currentSlide?.id || currentSlide.id === "temp" || !showRef.length) {
            stanzas = []
        } else {
            const show = $showsCache[currentSlide.id] || _show(currentSlide.id).get()
            stanzas = computeStanzas(showRef, show, slideIndex, lineFilter)
        }
    }

    function computeStanzas(refs: LayoutRef[], show: any, activeIdx: number | null, lf: string): StanzaInfo[] {
        if (!refs?.length || !show?.slides) return []

        const activeGroupId = activeIdx !== null && refs[activeIdx] ? (refs[activeIdx].type === "child" ? refs[activeIdx].parent?.id : refs[activeIdx].id) : null

        const groupOrder: string[] = []
        const groupRefsMap = new Map<string, LayoutRef[]>()
        refs.forEach((ref) => {
            const gId = ref.type === "child" ? ref.parent?.id : ref.id
            if (!gId) return
            if (!groupRefsMap.has(gId)) {
                groupRefsMap.set(gId, [])
                groupOrder.push(gId)
            }
            groupRefsMap.get(gId)!.push(ref)
        })

        function containsTamil(text: string): boolean {
            return /[\u0B80-\u0BFF]/.test(text)
        }
        function keepLine(text: string): boolean {
            if (!lf || lf === "both") return true
            const hasTamil = containsTamil(text)
            if (lf === "tamil") return hasTamil
            if (lf === "english") return !hasTamil
            return true
        }

        let verseCount = 0
        let verseDisplayCount = 0
        const result: StanzaInfo[] = []

        groupOrder.forEach((gId) => {
            const gRefs = groupRefsMap.get(gId) || []
            const firstRef = gRefs[0]
            const slide = show.slides[gId]
            if (!slide) return

            const rawName = (slide.group || "").trim()
            const lowerName = rawName.toLowerCase()

            let explicitKey: string | null = null
            for (const r of gRefs) {
                const k = r.data?.actions?.slide_shortcut?.key || slide.actions?.slide_shortcut?.key
                if (k) {
                    explicitKey = k.toLowerCase()
                    break
                }
            }

            let hotkey = explicitKey || ""
            let label = rawName || "Stanza"
            let type: "chorus" | "intro" | "bridge" | "verse" = "verse"
            let displayKey = ""

            if (lowerName.startsWith("chorus") || lowerName === "c" || explicitKey === "a" || lowerName.includes("pallavi")) {
                hotkey = hotkey || "a"
                label = "CHORUS"
                type = "chorus"
                displayKey = "C"
            } else if (lowerName.startsWith("intro") || lowerName === "i" || explicitKey === "s") {
                hotkey = hotkey || "s"
                label = "INTRO"
                type = "intro"
                displayKey = "S"
            } else if (lowerName.startsWith("bridge") || lowerName === "b" || explicitKey === "b" || lowerName.includes("anupallavi")) {
                hotkey = hotkey || "b"
                label = "BRIDGE"
                type = "bridge"
                displayKey = "B"
            } else {
                type = "verse"
                const match = lowerName.match(/(?:verse|stanza|saranam|charanam)\s*(\d+)/i)
                if (match) {
                    const num = parseInt(match[1])
                    label = `Verse ${num}`
                    hotkey = hotkey || VERSE_KEYS[num - 1] || VERSE_KEYS[VERSE_KEYS.length - 1]
                    displayKey = String(num)
                } else {
                    verseCount++
                    label = `Verse ${verseCount}`
                    hotkey = hotkey || VERSE_KEYS[verseCount - 1] || VERSE_KEYS[VERSE_KEYS.length - 1]
                    displayKey = String(++verseDisplayCount)
                }
            }

            const meta = HOTKEY_META[hotkey.toLowerCase()]
            const badgeColor = meta ? meta.color : "#94A3B8"

            const allLines: string[] = []
            gRefs.forEach((r) => {
                const s = show.slides[r.id]
                if (!s?.items) return
                s.items.forEach((item: any) => {
                    if ((item.type || "text") !== "text") return
                    ;(item.lines || []).forEach((line: Line) => {
                        const val = getLineText(line).trim()
                        if (val && keepLine(val)) allLines.push(val)
                    })
                })
            })

            result.push({
                groupId: gId,
                firstSlideIndex: firstRef.layoutIndex ?? 0,
                label,
                hotkey: hotkey.toLowerCase(),
                displayKey,
                type,
                badgeColor,
                lines: allLines.slice(0, 2),
                isCurrent: gId === activeGroupId
            })
        })

        return result
    }

    $: peekKey = $stagePeekStanza?.key || ""

    let countdown = AUTO_CLOSE_S
    let countdownInterval: any = null
    let autoCloseTimer: any = null

    $: if ($showStanzaMenu) startCountdown()

    function startCountdown() {
        countdown = AUTO_CLOSE_S
        clearInterval(countdownInterval)
        clearTimeout(autoCloseTimer)

        countdownInterval = setInterval(() => {
            countdown = Math.max(0, countdown - 1)
            if (countdown <= 0) clearInterval(countdownInterval)
        }, 1000)

        autoCloseTimer = setTimeout(() => {
            closePanel()
        }, AUTO_CLOSE_S * 1000)
    }

    function closePanel() {
        showStanzaMenu.set(false)
        clearInterval(countdownInterval)
        clearTimeout(autoCloseTimer)
        send(STAGE, ["MENU_TOGGLE"], { open: false })
        send(OUTPUT, ["STAGE_SHOW_MENU"], false)
    }

    function triggerPeek(stanza: StanzaInfo) {
        peekStanzaAction({
            groupId: stanza.groupId,
            layoutIndex: stanza.firstSlideIndex,
            key: stanza.hotkey
        })
        closePanel()
    }

    onDestroy(() => {
        clearInterval(countdownInterval)
        clearTimeout(autoCloseTimer)
    })

    $: progressPct = (countdown / AUTO_CLOSE_S) * 100
</script>

<div class="guide-panel">
    <div class="guide-header">
        <div class="guide-title-block">
            <span class="guide-title">STANZA GUIDE</span>
            <span class="guide-sub">Keys &amp; Lyrics</span>
        </div>
        <div class="guide-timer">
            <div class="guide-progress-track">
                <div class="guide-progress-fill" style="width: {progressPct}%;"></div>
            </div>
            <span class="guide-countdown">{countdown}s</span>
        </div>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="close-btn" on:click={closePanel} role="button" tabindex="0" aria-label="Close guide">✕</div>
    </div>

    <div class="guide-scroll">
        {#if stanzas.length === 0}
            <div class="guide-empty">
                <span>No active song</span>
            </div>
        {:else}
            {#each stanzas as s}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                    class="guide-row"
                    class:is-current={s.isCurrent}
                    class:is-peeked={peekKey === s.hotkey}
                    on:click={() => triggerPeek(s)}
                    role="button"
                    tabindex="0"
                >
                    <span class="key-badge" style="border-color:{s.badgeColor}; color:{s.badgeColor};">
                        {s.displayKey}
                    </span>
                    <div class="row-text">
                        {#if s.isCurrent}
                            <div class="row-top">
                                <span class="live-pill">● LIVE</span>
                            </div>
                        {/if}
                        {#if s.lines[0]}
                            <span class="first-line">{s.lines[0]}</span>
                        {/if}
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .guide-panel {
        width: 100%;
        height: 100%;
        background: rgba(13, 13, 18, 0.98);
        border-left: 2px solid rgba(255, 215, 0, 0.35);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: system-ui, -apple-system, sans-serif;
        color: #f0f0ff;
        box-sizing: border-box;
    }

    .guide-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.04);
    }
    .guide-title-block {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .guide-title {
        font-size: clamp(12px, 1vw, 15px);
        font-weight: 900;
        letter-spacing: 1.2px;
        color: #ffd700;
        line-height: 1;
    }
    .guide-sub {
        font-size: clamp(9px, 0.75vw, 12px);
        color: rgba(255, 255, 255, 0.5);
        line-height: 1;
    }
    .guide-timer {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }
    .guide-progress-track {
        width: clamp(40px, 3.5vw, 60px);
        height: 6px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 3px;
        overflow: hidden;
    }
    .guide-progress-fill {
        height: 100%;
        background: #ffd700;
        border-radius: 3px;
        transition: width 0.9s linear;
    }
    .guide-countdown {
        font-size: clamp(12px, 0.95vw, 15px);
        font-weight: 900;
        color: #ffd700;
        min-width: 22px;
        text-align: right;
    }
    .close-btn {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: rgba(255, 255, 255, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.12s, color 0.12s;
    }
    .close-btn:hover {
        background: rgba(255, 255, 255, 0.22);
        color: #fff;
    }

    .guide-scroll {
        flex: 1;
        overflow-y: auto;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .guide-empty {
        padding: 40px 10px;
        color: rgba(255, 255, 255, 0.4);
        font-size: 13px;
        text-align: center;
    }

    .guide-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1.5px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.12s ease, border-color 0.12s ease;
        user-select: none;
    }
    .guide-row:hover {
        background: rgba(255, 255, 255, 0.11);
        border-color: rgba(255, 255, 255, 0.25);
    }
    .guide-row.is-current {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.15);
        box-shadow: 0 0 14px rgba(255, 215, 0, 0.25);
    }
    .guide-row.is-peeked {
        border-color: rgba(255, 215, 0, 0.7);
        background: rgba(255, 215, 0, 0.1);
    }

    .key-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: clamp(38px, 2.5vw, 48px);
        height: clamp(34px, 2.3vw, 44px);
        border-radius: 8px;
        font-size: clamp(16px, 1.25vw, 22px);
        font-weight: 900;
        background: rgba(0, 0, 0, 0.45);
        border: 2px solid currentColor;
        box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
        flex-shrink: 0;
    }

    .row-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        justify-content: center;
    }
    .row-top {
        display: flex;
        align-items: center;
        gap: 6px;
        /* only takes space when a pill is present */
    }
    .live-pill {
        font-size: clamp(8px, 0.65vw, 11px);
        font-weight: 900;
        color: #ffd700;
        background: rgba(255, 215, 0, 0.18);
        border: 1px solid rgba(255, 215, 0, 0.5);
        padding: 1px 5px;
        border-radius: 4px;
        letter-spacing: 0.5px;
    }
    .first-line {
        font-size: clamp(18px, 2.0vw, 28px);
        font-weight: 700;
        color: #ffffff;
        overflow: hidden;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.25;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    }
</style>

