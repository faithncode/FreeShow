<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import type { LayoutRef, Line } from "../../../types/Show"
    import { getLayoutRef } from "../helpers/show"
    import { getItemText } from "../helpers/textStyle"
    import { send } from "../util/socket"
    import { output, peekStanza, showsCache, showStanzaMenu } from "../util/stores"

    interface StanzaInfo {
        groupId: string
        firstSlideIndex: number
        name: string
        label: string
        hotkey: string
        type: "chorus" | "intro" | "bridge" | "verse"
        badgeColor: string
        lines: string[]
        isCurrent: boolean
        isSeen: boolean
    }

    const VERSE_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "["]

    const HOTKEY_META: Record<string, { label: string; type: "chorus" | "intro" | "bridge" | "verse"; color: string }> = {
        a: { label: "Chorus", type: "chorus", color: "#FFB400" },
        s: { label: "Intro", type: "intro", color: "#5B9BD5" },
        b: { label: "Bridge", type: "bridge", color: "#B07FD4" }
    }
    VERSE_KEYS.forEach((k, i) => {
        HOTKEY_META[k] = { label: `Verse ${i + 1}`, type: "verse", color: "#94A3B8" }
    })

    // Track seen groups
    let seenGroupIds = new Set<string>()
    let lastTrackShowId: string | null = null

    $: currentSlide = $output?.out?.slide
    $: slideIndex = currentSlide && currentSlide.index !== undefined && currentSlide.id !== "temp" ? currentSlide.index : null
    $: showRef = currentSlide?.id && currentSlide.id !== "temp" ? getLayoutRef(currentSlide.id, currentSlide.layout, $showsCache) : []

    $: trackSeen(currentSlide?.id, slideIndex, showRef)

    function trackSeen(showId: string | undefined, idx: number | null, refs: LayoutRef[]) {
        if (!showId || showId === "temp") return
        if (showId !== lastTrackShowId) {
            seenGroupIds = new Set()
            lastTrackShowId = showId
        }
        if (idx !== null && idx !== undefined && refs[idx]) {
            const currentRef = refs[idx]
            const gId = currentRef.type === "child" ? currentRef.parent?.id : currentRef.id
            if (gId) {
                seenGroupIds.add(gId)
                const allGroupIds = [...new Set(refs.map((r) => (r.type === "child" ? r.parent?.id : r.id)).filter(Boolean))] as string[]
                if (allGroupIds.length > 0 && allGroupIds.every((id) => seenGroupIds.has(id))) {
                    seenGroupIds = new Set([gId])
                } else {
                    seenGroupIds = new Set(seenGroupIds)
                }
            }
        }
    }

    function containsTamil(text: string): boolean {
        return /[\u0B80-\u0BFF]/.test(text)
    }
    function getLineTextValue(line: Line): string {
        return (line.text || []).map((t) => t.value || "").join("")
    }

    // Extract stanzas from current song
    let stanzas: StanzaInfo[] = []

    $: {
        if (!currentSlide?.id || currentSlide.id === "temp" || !showRef.length || !$showsCache[currentSlide.id]) {
            stanzas = []
        } else {
            stanzas = computeStanzas(currentSlide.id, showRef, $showsCache[currentSlide.id], slideIndex, seenGroupIds)
        }
    }

    function computeStanzas(showId: string, refs: LayoutRef[], show: any, activeIdx: number | null, seen: Set<string>): StanzaInfo[] {
        if (!refs?.length || !show?.slides) return []

        const activeGroupId = activeIdx !== null && refs[activeIdx] ? (refs[activeIdx].type === "child" ? refs[activeIdx].parent?.id : refs[activeIdx].id) : null

        // Map group parent IDs to their refs
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

        let verseCount = 0
        const result: StanzaInfo[] = []

        groupOrder.forEach((gId) => {
            const gRefs = groupRefsMap.get(gId) || []
            const firstRef = gRefs[0]
            const slide = show.slides[gId]
            if (!slide) return

            const rawGroupName = (slide.group || "").trim()
            const lowerName = rawGroupName.toLowerCase()

            // 1. Check explicit slide shortcut
            let explicitKey: string | null = null
            for (const r of gRefs) {
                const k = r.data?.actions?.slide_shortcut?.key || slide.actions?.slide_shortcut?.key
                if (k) {
                    explicitKey = k.toLowerCase()
                    break
                }
            }

            // 2. Derive hotkey and label
            let hotkey = explicitKey || ""
            let label = rawGroupName || "Stanza"
            let type: "chorus" | "intro" | "bridge" | "verse" = "verse"

            if (lowerName.startsWith("chorus") || lowerName === "c" || explicitKey === "a") {
                hotkey = hotkey || "a"
                label = "Chorus"
                type = "chorus"
            } else if (lowerName.startsWith("intro") || lowerName === "i" || explicitKey === "s") {
                hotkey = hotkey || "s"
                label = "Intro"
                type = "intro"
            } else if (lowerName.startsWith("bridge") || lowerName === "b" || explicitKey === "b") {
                hotkey = hotkey || "b"
                label = "Bridge"
                type = "bridge"
            } else {
                // Verse
                type = "verse"
                const match = lowerName.match(/verse\s*(\d+)/i)
                if (match) {
                    const num = parseInt(match[1])
                    label = `Verse ${num}`
                    hotkey = hotkey || VERSE_KEYS[num - 1] || VERSE_KEYS[VERSE_KEYS.length - 1]
                } else {
                    verseCount++
                    label = rawGroupName || `Verse ${verseCount}`
                    hotkey = hotkey || VERSE_KEYS[verseCount - 1] || VERSE_KEYS[VERSE_KEYS.length - 1]
                }
            }

            const meta = HOTKEY_META[hotkey.toLowerCase()]
            const badgeColor = meta ? meta.color : "#94A3B8"

            // 3. Extract first lines
            const allLines: string[] = []
            gRefs.forEach((r) => {
                const s = show.slides[r.id]
                if (!s?.items) return
                s.items.forEach((item: any) => {
                    if ((item.type || "text") !== "text") return
                    const lines = item.lines || []
                    lines.forEach((line: Line) => {
                        const val = getLineTextValue(line).trim()
                        if (val) allLines.push(val)
                    })
                })
            })

            // Take first 2 non-empty lines
            const first2 = allLines.slice(0, 2)

            result.push({
                groupId: gId,
                firstSlideIndex: firstRef.layoutIndex ?? 0,
                name: rawGroupName,
                label,
                hotkey: hotkey.toLowerCase(),
                type,
                badgeColor,
                lines: first2,
                isCurrent: gId === activeGroupId,
                isSeen: seen.has(gId)
            })
        })

        return result
    }

    // ── Menu open & 5-Second auto-close countdown ──
    let isOpen = false
    $: isOpen = $showStanzaMenu

    let countdownSeconds = 5
    let countdownInterval: any = null
    let autoCloseTimer: any = null

    function openMenu() {
        if (!stanzas.length) {
            toast("No stanzas found for current song")
            return
        }
        showStanzaMenu.set(true)
        startCountdown(5)
    }

    function closeMenu() {
        showStanzaMenu.set(false)
        clearTimeout(autoCloseTimer)
        clearInterval(countdownInterval)
    }

    function startCountdown(seconds: number) {
        clearTimeout(autoCloseTimer)
        clearInterval(countdownInterval)
        countdownSeconds = seconds

        countdownInterval = setInterval(() => {
            countdownSeconds = Math.max(0, countdownSeconds - 1)
            if (countdownSeconds <= 0) clearInterval(countdownInterval)
        }, 1000)

        autoCloseTimer = setTimeout(() => {
            closeMenu()
        }, seconds * 1000)
    }

    // ── Stanza Trigger / Peek ──
    function triggerStanza(stanza: StanzaInfo) {
        const until = Date.now() + 7000
        peekStanza.set({
            groupId: stanza.groupId,
            layoutIndex: stanza.firstSlideIndex,
            until,
            slideIndexAtPeek: slideIndex ?? undefined,
            key: stanza.hotkey
        })

        // Relay to FreeShow server / controller
        send("STAGE_JUMP", {
            index: stanza.firstSlideIndex,
            key: stanza.hotkey,
            groupId: stanza.groupId
        })

        toast(`⌨ ${stanza.label}`)
        closeMenu()
    }

    // ── Toast feedback ──
    let toastMessage = ""
    let toastTimeout: any = null

    function toast(msg: string) {
        toastMessage = msg
        if (toastTimeout) clearTimeout(toastTimeout)
        toastTimeout = setTimeout(() => {
            toastMessage = ""
        }, 1800)
    }

    // ── Global Keyboard Listener ──
    function handleKeyDown(e: KeyboardEvent) {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return

        const key = e.key

        // MENU toggle
        if (key === "NumLock" || key === "/" || key.toLowerCase() === "m") {
            e.preventDefault()
            if (isOpen) closeMenu()
            else openMenu()
            return
        }

        if (key === "Escape") {
            if (isOpen) {
                e.preventDefault()
                closeMenu()
                return
            }
        }

        // Slide navigation: < (ArrowLeft), > (ArrowRight)
        if (key === "ArrowLeft" || key === "<") {
            e.preventDefault()
            send("RUN_ACTION", { id: "previous_slide" })
            return
        }
        if (key === "ArrowRight" || key === ">") {
            e.preventDefault()
            send("RUN_ACTION", { id: "next_slide" })
            return
        }

        // Stanza hotkeys
        const lk = key.toLowerCase()
        const match = stanzas.find((s) => s.hotkey === lk)
        if (match) {
            e.preventDefault()
            triggerStanza(match)
            return
        }
    }

    onMount(() => {
        window.addEventListener("keydown", handleKeyDown)
    })

    onDestroy(() => {
        window.removeEventListener("keydown", handleKeyDown)
        clearTimeout(autoCloseTimer)
        clearInterval(countdownInterval)
        clearTimeout(toastTimeout)
    })
</script>

<!-- Floating MENU button (bottom-right of stage monitor) -->
{#if stanzas.length > 0}
    <button class="stage-menu-fab" class:active={isOpen} on:click={openMenu} title="Stanza Menu (NumLock / /)">
        <span class="fab-icon">⌨</span>
        <span class="fab-text">MENU</span>
    </button>
{/if}

<!-- Toast Feedback -->
{#if toastMessage}
    <div class="stage-toast">{toastMessage}</div>
{/if}

<!-- Stanza Numpad Overlay -->
{#if isOpen && stanzas.length > 0}
    <div class="stanza-overlay" on:click|self={closeMenu} role="dialog" aria-modal="true">
        <div class="stanza-modal">
            <!-- Modal Header with countdown bar -->
            <div class="modal-header">
                <div class="title-wrap">
                    <span class="numpad-icon">⌨</span>
                    <span class="modal-title">STANZA MAP</span>
                    <span class="song-sub">{stanzas.length} stanzas</span>
                </div>

                <div class="countdown-wrap" title="Auto-closes in {countdownSeconds}s">
                    <div class="countdown-bar-outer">
                        <div class="countdown-bar-inner" style="animation-duration: 5s;" />
                    </div>
                    <span class="countdown-num">{countdownSeconds}s</span>
                </div>

                <button class="modal-close-btn" on:click={closeMenu} title="Close (ESC)">✕</button>
            </div>

            <!-- Numpad Grid -->
            <div class="numpad-grid">
                {#each stanzas as stanza (stanza.groupId)}
                    <button
                        type="button"
                        class="numpad-card type-{stanza.type}"
                        class:active={stanza.isCurrent}
                        class:seen={stanza.isSeen && !stanza.isCurrent}
                        on:click={() => triggerStanza(stanza)}
                    >
                        <div class="card-top-row">
                            <span class="key-pill" style="--badge-color: {stanza.badgeColor};">
                                {stanza.hotkey.toUpperCase()}
                            </span>
                            <span class="stanza-label">{stanza.label}</span>
                            {#if stanza.isCurrent}
                                <span class="live-dot" title="Active stanza" />
                            {/if}
                        </div>

                        <div class="card-preview">
                            {#if stanza.lines.length}
                                {#each stanza.lines as line}
                                    <div class="preview-line">{line}</div>
                                {/each}
                            {:else}
                                <div class="preview-line empty">—</div>
                            {/if}
                        </div>
                    </button>
                {/each}
            </div>

            <!-- Footer hint -->
            <div class="modal-footer">
                <span>Press key or tap stanza to peek for 5s • Auto-closes in {countdownSeconds}s</span>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ── Floating MENU FAB Button ── */
    .stage-menu-fab {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 60px;
        height: 60px;
        border-radius: 16px;
        background: rgba(18, 18, 24, 0.9);
        border: 2px solid rgba(255, 255, 255, 0.22);
        color: #fff;
        cursor: pointer;
        user-select: none;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
        transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
    }
    .stage-menu-fab:hover,
    .stage-menu-fab.active {
        transform: scale(1.06);
        background: rgba(45, 45, 60, 0.95);
        border-color: #ffd700;
        color: #ffd700;
    }
    .stage-menu-fab:active {
        transform: scale(0.96);
    }
    .fab-icon {
        font-size: 20px;
        line-height: 1;
    }
    .fab-text {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 1px;
        margin-top: 2px;
    }

    /* ── Toast ── */
    .stage-toast {
        position: fixed;
        bottom: 92px;
        right: 20px;
        z-index: 100000;
        background: rgba(20, 20, 28, 0.95);
        border: 1.5px solid #ffd700;
        color: #ffd700;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0.5px;
        padding: 8px 16px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8);
        animation: toastIn 0.18s ease-out;
        pointer-events: none;
    }
    @keyframes toastIn {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    /* ── Fullscreen Overlay ── */
    .stanza-overlay {
        position: fixed;
        inset: 0;
        z-index: 99998;
        background: rgba(0, 0, 0, 0.82);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        box-sizing: border-box;
    }

    /* ── Modal Window ── */
    .stanza-modal {
        background: rgba(16, 17, 24, 0.97);
        border: 1.5px solid rgba(255, 255, 255, 0.16);
        border-radius: 22px;
        width: 100%;
        max-width: 860px;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.92);
        animation: modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes modalIn {
        from {
            opacity: 0;
            transform: scale(0.96);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }

    /* ── Header ── */
    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        gap: 12px;
    }
    .title-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .numpad-icon {
        font-size: 18px;
    }
    .modal-title {
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 1.5px;
        color: #fff;
    }
    .song-sub {
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.4);
        margin-left: 6px;
    }

    .countdown-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .countdown-bar-outer {
        width: 90px;
        height: 6px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
        overflow: hidden;
    }
    .countdown-bar-inner {
        height: 100%;
        background: #ffd700;
        border-radius: 3px;
        animation: shrink linear forwards;
    }
    @keyframes shrink {
        from {
            width: 100%;
        }
        to {
            width: 0%;
        }
    }
    .countdown-num {
        font-size: 12px;
        font-weight: 800;
        color: #ffd700;
        min-width: 22px;
        text-align: right;
    }

    .modal-close-btn {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.7);
        width: 32px;
        height: 32px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
    }
    .modal-close-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
    }

    /* ── Numpad Grid ── */
    .numpad-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        padding: 20px;
        overflow-y: auto;
        max-height: calc(90vh - 120px);
    }
    @media (max-width: 740px) {
        .numpad-grid {
            grid-template-columns: repeat(2, 1fr);
            padding: 14px;
            gap: 10px;
        }
    }

    /* ── Numpad Card ── */
    .numpad-card {
        background: rgba(255, 255, 255, 0.05);
        border: 1.5px solid rgba(255, 255, 255, 0.12);
        border-radius: 14px;
        padding: 12px 14px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: left;
        min-height: 88px;
        transition: background 0.12s ease, border-color 0.12s ease, transform 0.1s ease;
        -webkit-tap-highlight-color: transparent;
    }
    .numpad-card:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.35);
        transform: translateY(-2px);
    }
    .numpad-card:active {
        transform: translateY(0);
        background: rgba(255, 255, 255, 0.18);
    }

    /* Card Types */
    .numpad-card.type-chorus {
        border-color: rgba(255, 180, 0, 0.35);
    }
    .numpad-card.type-intro {
        border-color: rgba(91, 155, 213, 0.35);
    }
    .numpad-card.type-bridge {
        border-color: rgba(176, 127, 212, 0.35);
    }

    /* Active & Seen States */
    .numpad-card.active {
        border-color: #ffd700 !important;
        background: rgba(255, 215, 0, 0.12) !important;
        box-shadow: 0 0 16px rgba(255, 215, 0, 0.3);
    }
    .numpad-card.seen {
        opacity: 0.55;
    }

    .card-top-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .key-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 22px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 900;
        background: rgba(255, 255, 255, 0.12);
        color: var(--badge-color, #fff);
        border: 1px solid var(--badge-color, rgba(255, 255, 255, 0.2));
        padding: 0 6px;
    }
    .stanza-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.85);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ffd700;
        box-shadow: 0 0 8px #ffd700;
    }

    .card-preview {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.7);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        word-break: break-word;
    }
    .preview-line.empty {
        color: rgba(255, 255, 255, 0.25);
    }

    /* ── Footer ── */
    .modal-footer {
        padding: 10px 20px;
        background: rgba(255, 255, 255, 0.02);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.35);
    }
</style>

