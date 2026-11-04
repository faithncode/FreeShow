<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import type { LayoutRef, Line } from "../../../types/Show"
    import { getLayoutRef } from "../helpers/show"
    import { send } from "../util/socket"
    import { output, showsCache, showStanzaMenu } from "../util/stores"

    // ── Constants ─────────────────────────────────────────────────────────────
    // Verse hotkeys: 1-11 -> Q, W, E, R, T, Y, U, I, O, P, [
    const VERSE_KEYS = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "["]
    const PEEK_DURATION_MS = 7000
    const MENU_AUTO_CLOSE_S = 5

    interface StanzaInfo {
        groupId: string
        firstSlideIndex: number
        label: string
        hotkey: string
        type: "chorus" | "intro" | "bridge" | "verse"
        badgeColor: string
        lines: string[]
        isCurrent: boolean
        isSeen: boolean
    }

    const HOTKEY_META: Record<string, { label: string; type: "chorus" | "intro" | "bridge" | "verse"; color: string }> = {
        a: { label: "CHORUS", type: "chorus", color: "#FFB400" },
        s: { label: "INTRO", type: "intro", color: "#5B9BD5" },
        b: { label: "BRIDGE", type: "bridge", color: "#B07FD4" }
    }
    VERSE_KEYS.forEach((k, i) => {
        HOTKEY_META[k] = { label: `Verse ${i + 1}`, type: "verse", color: "#94A3B8" }
    })

    // ── State ─────────────────────────────────────────────────────────────────
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
            const ref = refs[idx]
            const gId = ref.type === "child" ? ref.parent?.id : ref.id
            if (gId) {
                seenGroupIds.add(gId)
                const allIds = [...new Set(refs.map((r) => (r.type === "child" ? r.parent?.id : r.id)).filter(Boolean))] as string[]
                if (allIds.length > 0 && allIds.every((id) => seenGroupIds.has(id))) {
                    seenGroupIds = new Set([gId])
                } else {
                    seenGroupIds = new Set(seenGroupIds)
                }
            }
        }
    }

    function getLineText(line: Line): string {
        return (line.text || []).map((t) => t.value || "").join("")
    }

    let stanzas: StanzaInfo[] = []

    $: {
        if (!currentSlide?.id || currentSlide.id === "temp" || !showRef.length || !$showsCache[currentSlide.id]) {
            stanzas = []
        } else {
            stanzas = computeStanzas(showRef, $showsCache[currentSlide.id], slideIndex, seenGroupIds)
        }
    }

    function computeStanzas(refs: LayoutRef[], show: any, activeIdx: number | null, seen: Set<string>): StanzaInfo[] {
        if (!refs?.length || !show?.slides) return []

        const activeGroupId =
            activeIdx !== null && refs[activeIdx] ? (refs[activeIdx].type === "child" ? refs[activeIdx].parent?.id : refs[activeIdx].id) : null

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

            const rawName = (slide.group || "").trim()
            const lowerName = rawName.toLowerCase()

            let explicitKey: string | null = null
            for (const r of gRefs) {
                const k = r.data?.actions?.slide_shortcut?.key || slide.actions?.slide_shortcut?.key
                if (k) { explicitKey = k.toLowerCase(); break }
            }

            let hotkey = explicitKey || ""
            let label = rawName || "Stanza"
            let type: "chorus" | "intro" | "bridge" | "verse" = "verse"

            if (lowerName.startsWith("chorus") || lowerName === "c" || explicitKey === "a" || lowerName.includes("pallavi")) {
                hotkey = hotkey || "a"; label = "CHORUS"; type = "chorus"
            } else if (lowerName.startsWith("intro") || lowerName === "i" || explicitKey === "s") {
                hotkey = hotkey || "s"; label = "INTRO"; type = "intro"
            } else if (lowerName.startsWith("bridge") || lowerName === "b" || explicitKey === "b" || lowerName.includes("anupallavi")) {
                hotkey = hotkey || "b"; label = "BRIDGE"; type = "bridge"
            } else {
                type = "verse"
                const match = lowerName.match(/(?:verse|stanza|saranam|charanam)\s*(\d+)/i)
                if (match) {
                    const num = parseInt(match[1])
                    label = `Verse ${num}`
                    hotkey = hotkey || VERSE_KEYS[num - 1] || VERSE_KEYS[VERSE_KEYS.length - 1]
                } else {
                    verseCount++
                    label = `Verse ${verseCount}`
                    hotkey = hotkey || VERSE_KEYS[verseCount - 1] || VERSE_KEYS[VERSE_KEYS.length - 1]
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
                        if (val) allLines.push(val)
                    })
                })
            })

            result.push({
                groupId: gId,
                firstSlideIndex: firstRef.layoutIndex ?? 0,
                label,
                hotkey: hotkey.toLowerCase(),
                type,
                badgeColor,
                lines: allLines.slice(0, 2),
                isCurrent: gId === activeGroupId,
                isSeen: seen.has(gId)
            })
        })

        return result
    }

    function getStanzaByHotkey(key: string): StanzaInfo | undefined {
        return stanzas.find((s) => s.hotkey === key)
    }

    function verseKey(n: number): string {
        return VERSE_KEYS[n - 1] || ""
    }

    $: chorusStanza = getStanzaByHotkey("a")
    $: introStanza = getStanzaByHotkey("s")
    $: bridgeStanza = getStanzaByHotkey("b")

    // ── Peeking ───────────────────────────────────────────────────────────────
    let lastPeekedKey = ""
    let peekRemainingSec = 0
    let peekTimer: any = null
    let peekInterval: any = null

    function triggerPeek(key: string) {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
            try { navigator.vibrate(30) } catch (e) {}
        }

        const stanza = stanzas.find((s) => s.hotkey === key)
        lastPeekedKey = key
        peekRemainingSec = Math.round(PEEK_DURATION_MS / 1000)

        clearInterval(peekInterval)
        clearTimeout(peekTimer)

        peekInterval = setInterval(() => {
            peekRemainingSec = Math.max(0, peekRemainingSec - 1)
            if (peekRemainingSec <= 0) clearInterval(peekInterval)
        }, 1000)

        peekTimer = setTimeout(() => {
            lastPeekedKey = ""
            peekRemainingSec = 0
            clearInterval(peekInterval)
        }, PEEK_DURATION_MS)

        // Broadcast to stage displays & FreeShow
        send("PEEK_STANZA", {
            groupId: stanza?.groupId,
            layoutIndex: stanza?.firstSlideIndex,
            until: Date.now() + PEEK_DURATION_MS,
            slideIndexAtPeek: slideIndex ?? undefined,
            key: key
        })

        const label = stanza?.label || (HOTKEY_META[key]?.label ?? key.toUpperCase())
        flashToast(`Showing ${label} on stage (${Math.round(PEEK_DURATION_MS / 1000)}s)`)
        closeMenu()
    }

    function prevSlide() { send("RUN_ACTION", { id: "previous_slide" }) }
    function nextSlide() { send("RUN_ACTION", { id: "next_slide" }) }

    // ── Stanza Guide Menu ─────────────────────────────────────────────────────
    // MENU button toggles the guide panel on stage monitors (80% lyrics / 20% guides).
    // The server is the source of truth, and updates $showStanzaMenu across all clients.
    function openMenu() {
        send("MENU_TOGGLE")
    }

    let hasMountedMenuToast = false
    $: if (typeof $showStanzaMenu === "boolean") {
        if (!hasMountedMenuToast) {
            hasMountedMenuToast = true
        } else {
            flashToast($showStanzaMenu ? "Guide on stage (20%) →" : "Guide closed")
        }
    }

    function closeMenu() {
        if ($showStanzaMenu) send("MENU_TOGGLE", { open: false })
    }

    // ── Toast ─────────────────────────────────────────────────────────────────
    let toastMsg = ""
    let toastTimer: any = null
    function flashToast(msg: string) {
        toastMsg = msg
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => { toastMsg = "" }, 2500)
    }

    // ── Keyboard support (hardware HID or laptop testing) ────────────────────
    function handleKey(e: KeyboardEvent) {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return
        const key = e.key.toLowerCase()

        if (key === "escape") { e.preventDefault(); return }
        if (key === "arrowleft") { e.preventDefault(); prevSlide(); return }
        if (key === "arrowright") { e.preventDefault(); nextSlide(); return }
        if (key === "m" || e.key === "NumLock" || key === "/") {
            e.preventDefault()
            openMenu()
            return
        }

        const allKeys = [...VERSE_KEYS, "a", "s", "b"]
        if (allKeys.includes(key)) {
            e.preventDefault()
            triggerPeek(key)
        }
    }

    onMount(() => { window.addEventListener("keydown", handleKey) })
    onDestroy(() => {
        window.removeEventListener("keydown", handleKey)
        clearTimeout(peekTimer)
        clearInterval(peekInterval)
        clearTimeout(toastTimer)
    })
</script>

<div class="numpad-wrapper">
    <!-- Top stand curvature imitating physical numpad stand -->
    <div class="numpad-stand-top">
        <div class="stand-shine"></div>
    </div>

    <div class="numpad-device">
        <!-- Header status bar -->
        <div class="np-header">
            <div class="header-left">
                <span class="brand-tag">FREESHOW</span>
                <span class="device-tag">SINGER CONTROLLER</span>
            </div>
            <div class="header-right">
                {#if peekRemainingSec > 0}
                    <span class="peek-badge">PEEKING {peekRemainingSec}s</span>
                {:else if currentSlide?.id && currentSlide.id !== "temp"}
                    <span class="song-title">{$showsCache[currentSlide.id]?.name || "Active Show"}</span>
                {:else}
                    <span class="song-title idle">Waiting for show…</span>
                {/if}
            </div>
        </div>

        <!-- ══════════════════════════════════════════════════════════════════
             PHYSICAL NUMPAD GRID (Exact 4-column layout from device image)
             ══════════════════════════════════════════════════════════════════ -->
        <div class="numpad-matrix">

            <!-- ── ROW 1: MENU | < | > | INTERLUDE ────────────────────────── -->
            <button class="key top-action menu-btn" on:click={openMenu} title="MENU (Guidance overlay)">
                <span class="primary-text">MENU</span>
                <span class="legend-text">GUIDE</span>
            </button>

            <button class="key top-action nav-btn" on:click={prevSlide} title="Previous slide (<)">
                <span class="primary-text">◀</span>
                <span class="legend-text">&lt;</span>
            </button>

            <button class="key top-action nav-btn" on:click={nextSlide} title="Next slide (>)">
                <span class="primary-text">▶</span>
                <span class="legend-text">&gt;</span>
            </button>

            <button class="key top-action interlude-btn" title="Interlude (reserved)">
                <span class="primary-text interlude-txt">INTERLUDE</span>
                <span class="legend-text">—</span>
            </button>

            <!-- ── ROW 2: 1 | 2 | 3 | 4 ────────────────────────────────────── -->
            {#each [1, 2, 3, 4] as n}
                {@const k = verseKey(n)}
                {@const stanza = getStanzaByHotkey(k)}
                <button
                    class="key verse-btn"
                    class:active={stanza?.isCurrent || lastPeekedKey === k}
                    class:seen={stanza?.isSeen && !stanza?.isCurrent}
                    on:click={() => triggerPeek(k)}
                    title={stanza ? `Verse ${n} (${k.toUpperCase()}): ${stanza.lines[0] || ""}` : `Verse ${n}`}
                >
                    <span class="primary-text num">{n}</span>
                    <span class="key-sub">{k.toUpperCase()}</span>
                    {#if stanza?.isCurrent}<span class="live-dot" title="Current live stanza"></span>{/if}
                </button>
            {/each}

            <!-- ── ROW 3: 5 | 6 | 7 | 8 ────────────────────────────────────── -->
            {#each [5, 6, 7, 8] as n}
                {@const k = verseKey(n)}
                {@const stanza = getStanzaByHotkey(k)}
                <button
                    class="key verse-btn"
                    class:active={stanza?.isCurrent || lastPeekedKey === k}
                    class:seen={stanza?.isSeen && !stanza?.isCurrent}
                    on:click={() => triggerPeek(k)}
                    title={stanza ? `Verse ${n} (${k.toUpperCase()}): ${stanza.lines[0] || ""}` : `Verse ${n}`}
                >
                    <span class="primary-text num">{n}</span>
                    <span class="key-sub">{k.toUpperCase()}</span>
                    {#if stanza?.isCurrent}<span class="live-dot" title="Current live stanza"></span>{/if}
                </button>
            {/each}

            <!-- ── ROW 4: 9 | 10 | 11 | CHORUS (spans 2 rows) ─────────────── -->
            {#each [9, 10, 11] as n}
                {@const k = verseKey(n)}
                {@const stanza = getStanzaByHotkey(k)}
                <button
                    class="key verse-btn"
                    class:active={stanza?.isCurrent || lastPeekedKey === k}
                    class:seen={stanza?.isSeen && !stanza?.isCurrent}
                    on:click={() => triggerPeek(k)}
                    title={stanza ? `Verse ${n} (${k.toUpperCase()}): ${stanza.lines[0] || ""}` : `Verse ${n}`}
                >
                    <span class="primary-text num">{n}</span>
                    <span class="key-sub">{k.toUpperCase()}</span>
                    {#if stanza?.isCurrent}<span class="live-dot" title="Current live stanza"></span>{/if}
                </button>
            {/each}

            <!-- CHORUS: Enter key position, spans row 4 and 5 in column 4 -->
            <button
                class="key special-btn chorus-btn"
                class:active={chorusStanza?.isCurrent || lastPeekedKey === "a"}
                class:seen={chorusStanza?.isSeen && !chorusStanza?.isCurrent}
                on:click={() => triggerPeek("a")}
                title={chorusStanza ? `Chorus (A): ${chorusStanza.lines[0] || ""}` : "Chorus (A)"}
            >
                <span class="primary-text special-word">CHORUS</span>
                <span class="key-sub hotkey-badge">A</span>
                {#if chorusStanza?.isCurrent}<span class="live-dot" title="Current live stanza"></span>{/if}
            </button>

            <!-- ── ROW 5: INTRO (spans 2 cols) | BRIDGE | (CHORUS is col 4) ─ -->
            <!-- INTRO: 0 key position, spans cols 1-2 in row 5 -->
            <button
                class="key special-btn intro-btn"
                class:active={introStanza?.isCurrent || lastPeekedKey === "s"}
                class:seen={introStanza?.isSeen && !introStanza?.isCurrent}
                on:click={() => triggerPeek("s")}
                title={introStanza ? `Intro (S): ${introStanza.lines[0] || ""}` : "Intro (S)"}
            >
                <div class="intro-content">
                    <span class="key-sub hotkey-badge">S</span>
                    <span class="primary-text special-word">INTRO</span>
                </div>
                {#if introStanza?.isCurrent}<span class="live-dot" title="Current live stanza"></span>{/if}
            </button>

            <!-- BRIDGE: . / Del key position, col 3 in row 5 -->
            <button
                class="key special-btn bridge-btn"
                class:active={bridgeStanza?.isCurrent || lastPeekedKey === "b"}
                class:seen={bridgeStanza?.isSeen && !bridgeStanza?.isCurrent}
                on:click={() => triggerPeek("b")}
                title={bridgeStanza ? `Bridge (B): ${bridgeStanza.lines[0] || ""}` : "Bridge (B)"}
            >
                <span class="primary-text special-word">BRIDGE</span>
                <span class="key-sub hotkey-badge">B</span>
                {#if bridgeStanza?.isCurrent}<span class="live-dot" title="Current live stanza"></span>{/if}
            </button>

        </div><!-- /numpad-matrix -->

        <!-- Bottom status hint -->
        <div class="np-status-bar">
            <span class="hint-text">Stage peek: 7s auto-revert • Syncs with next slide</span>
        </div>
    </div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════
     TOAST
     ══════════════════════════════════════════════════════════════════════ -->
{#if toastMsg}
    <div class="toast">{toastMsg}</div>
{/if}

<style>
    /* ── Wrapper & Stand Design ────────────────────────────────────────────── */
    .numpad-wrapper {
        position: fixed;
        inset: 0;
        background: #080808;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #fff;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
        overflow: hidden;
    }

    /* Ergonomic curved top stand imitating the physical numpad */
    .numpad-stand-top {
        width: 100%;
        max-width: 440px;
        height: 28px;
        background: linear-gradient(180deg, #2b2b2e 0%, #17171a 70%, #0d0d0f 100%);
        border-radius: 20px 20px 0 0;
        margin-top: 6px;
        position: relative;
        box-shadow: 0 4px 12px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.18);
        flex-shrink: 0;
    }
    .stand-shine {
        position: absolute;
        top: 3px;
        left: 20%;
        right: 20%;
        height: 2px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
        border-radius: 2px;
    }

    /* ── Device Body ───────────────────────────────────────────────────────── */
    .numpad-device {
        width: 100%;
        max-width: 440px;
        flex: 1;
        display: flex;
        flex-direction: column;
        background: linear-gradient(180deg, #131316 0%, #0d0d0f 100%);
        border: 1px solid #242429;
        border-top: none;
        border-radius: 0 0 24px 24px;
        box-shadow: 0 12px 36px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.05);
        padding: 10px 14px 16px;
        box-sizing: border-box;
        overflow: hidden;
    }

    /* ── Header ────────────────────────────────────────────────────────────── */
    .np-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 6px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        flex-shrink: 0;
        gap: 8px;
    }
    .header-left {
        display: flex;
        flex-direction: column;
        gap: 1px;
    }
    .brand-tag {
        font-size: 8px;
        font-weight: 900;
        letter-spacing: 1.5px;
        color: #e5a93c;
    }
    .device-tag {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.8px;
        color: rgba(255,255,255,0.6);
    }
    .header-right {
        display: flex;
        align-items: center;
        max-width: 55%;
    }
    .song-title {
        font-size: 12px;
        font-weight: 600;
        color: rgba(255,255,255,0.85);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: right;
    }
    .song-title.idle { color: rgba(255,255,255,0.3); font-style: italic; }
    .peek-badge {
        font-size: 11px;
        font-weight: 800;
        color: #000;
        background: #ffd700;
        padding: 3px 8px;
        border-radius: 10px;
        letter-spacing: 0.5px;
        box-shadow: 0 0 12px rgba(255,215,0,0.5);
        animation: pulse 1s infinite alternate;
    }
    @keyframes pulse {
        from { opacity: 0.85; }
        to { opacity: 1; }
    }

    /* ── 4-Column Numpad Matrix ────────────────────────────────────────────── */
    .numpad-matrix {
        flex: 1;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: minmax(48px, 0.8fr) repeat(4, minmax(56px, 1fr));
        gap: 10px;
        padding-top: 10px;
        box-sizing: border-box;
    }

    /* ── Base Keycap Design ────────────────────────────────────────────────── */
    .key {
        position: relative;
        background: linear-gradient(180deg, #25252a 0%, #19191d 100%);
        border: 1.5px solid #33333d;
        border-radius: 12px;
        color: #fff;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 6px 4px;
        transition: transform 0.06s ease, background 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease;
        -webkit-tap-highlight-color: transparent;
        box-shadow: 0 4px 0 #09090b, 0 5px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
    }
    .key:active:not(:disabled) {
        transform: translateY(3px);
        box-shadow: 0 1px 0 #09090b, inset 0 1px 0 rgba(255,255,255,0.05);
        background: #2a2a30;
    }
    .key:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        box-shadow: 0 2px 0 #09090b;
        background: #151518;
        border-color: #222227;
    }

    /* ── Key Typography ────────────────────────────────────────────────────── */
    .primary-text {
        font-weight: 800;
        line-height: 1;
        pointer-events: none;
    }
    .primary-text.num {
        font-size: 1.65rem;
        letter-spacing: -0.5px;
        color: #f5f5f7;
    }
    .key-sub {
        font-size: 9px;
        font-weight: 700;
        color: rgba(255,255,255,0.35);
        margin-top: 3px;
        letter-spacing: 0.5px;
    }
    .hotkey-badge {
        font-size: 9px;
        background: rgba(255,255,255,0.1);
        padding: 1px 5px;
        border-radius: 4px;
        color: rgba(255,255,255,0.7);
        font-weight: 800;
    }
    .special-word {
        font-size: 0.8rem;
        font-weight: 900;
        letter-spacing: 0.8px;
    }

    /* ── Top Row Keys ──────────────────────────────────────────────────────── */
    .top-action {
        background: linear-gradient(180deg, #1c1c20 0%, #141417 100%);
        border-color: #2b2b33;
    }
    .menu-btn {
        border-color: rgba(255,215,0,0.3);
    }
    .menu-btn .primary-text {
        font-size: 0.82rem;
        letter-spacing: 0.5px;
        color: #ffd700;
    }
    .legend-text {
        font-size: 8px;
        font-weight: 700;
        color: rgba(255,255,255,0.35);
        margin-top: 2px;
        letter-spacing: 0.5px;
    }
    .nav-btn .primary-text {
        font-size: 1.1rem;
        color: rgba(255,255,255,0.85);
    }
    .interlude-btn {
        opacity: 0.45;
        cursor: default;
    }
    .interlude-txt {
        font-size: 0.62rem;
        letter-spacing: 0.5px;
        color: rgba(255,255,255,0.6);
    }

    /* ── Special Keys (Chorus, Intro, Bridge) ──────────────────────────────── */
    /* CHORUS spans Row 4 and Row 5 in Column 4 (Enter key) */
    .chorus-btn {
        grid-column: 4;
        grid-row: 4 / 6;
        background: linear-gradient(180deg, rgba(255,180,0,0.18) 0%, rgba(255,180,0,0.08) 100%), #1a1917;
        border-color: rgba(255,180,0,0.5);
        color: #ffbe2e;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
    }
    .chorus-btn:hover:not(:disabled) {
        border-color: #ffbe2e;
        background: linear-gradient(180deg, rgba(255,180,0,0.25) 0%, rgba(255,180,0,0.12) 100%), #1a1917;
    }

    /* INTRO spans Column 1 and 2 in Row 5 (0 key) */
    .intro-btn {
        grid-column: 1 / 3;
        grid-row: 5;
        background: linear-gradient(180deg, rgba(91,155,213,0.18) 0%, rgba(91,155,213,0.08) 100%), #161a20;
        border-color: rgba(91,155,213,0.5);
        color: #72b2f0;
    }
    .intro-btn:hover:not(:disabled) {
        border-color: #72b2f0;
        background: linear-gradient(180deg, rgba(91,155,213,0.25) 0%, rgba(91,155,213,0.12) 100%), #161a20;
    }
    .intro-content {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* BRIDGE is Column 3 in Row 5 (. / Del key) */
    .bridge-btn {
        grid-column: 3;
        grid-row: 5;
        background: linear-gradient(180deg, rgba(176,127,212,0.18) 0%, rgba(176,127,212,0.08) 100%), #1c1722;
        border-color: rgba(176,127,212,0.5);
        color: #cca4e8;
    }
    .bridge-btn:hover:not(:disabled) {
        border-color: #cca4e8;
        background: linear-gradient(180deg, rgba(176,127,212,0.25) 0%, rgba(176,127,212,0.12) 100%), #1c1722;
    }

    /* ── Active / Seen / Live Status ───────────────────────────────────────── */
    .key.active {
        border-color: #ffd700 !important;
        background: linear-gradient(180deg, rgba(255,215,0,0.25) 0%, rgba(255,215,0,0.1) 100%), #242216 !important;
        box-shadow: 0 4px 0 #09090b, 0 0 20px rgba(255,215,0,0.4) !important;
    }
    .key.seen {
        opacity: 0.45;
    }
    .live-dot {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #ffd700;
        box-shadow: 0 0 8px #ffd700;
    }

    /* ── Bottom Status Bar ─────────────────────────────────────────────────── */
    .np-status-bar {
        padding-top: 10px;
        text-align: center;
        flex-shrink: 0;
        border-top: 1px solid rgba(255,255,255,0.05);
    }
    .hint-text {
        font-size: 10px;
        font-weight: 600;
        color: rgba(255,255,255,0.3);
        letter-spacing: 0.3px;
    }

    /* ══════════════════════════════════════════════════════════════════════
       TOAST
       ══════════════════════════════════════════════════════════════════════ */
    .toast {
        position: fixed;
        bottom: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255,215,0,0.95);
        color: #000;
        font-size: 12px;
        font-weight: 800;
        padding: 8px 18px;
        border-radius: 20px;
        z-index: 200;
        pointer-events: none;
        white-space: nowrap;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
        animation: toastFade 0.2s ease;
    }
    @keyframes toastFade {
        from { opacity: 0; transform: translate(-50%, 8px); }
        to   { opacity: 1; transform: translate(-50%, 0); }
    }
</style>
