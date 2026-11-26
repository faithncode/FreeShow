// A stanza shown on stage ahead of the main screen (pure logic, no app imports, so it can be tested)
// queued: shown in the "next unseen" box
// live: shown as the current text on stage (requested twice, or "next")
// Nothing here changes the main screen. It all ends when the main screen reaches the same stanza,
// or when synced manually, and it never changes which stanzas count as seen.

export type StageRequest = {
    showId: string
    groupId: string
    layoutIndex: number
    key?: string
    state: "queued" | "live"
    // stays current on stage while another stanza is queued
    held?: number
    // stanzas already shown as current, "next unseen" moves past these
    shown?: string[]
    // a song with only one stanza is stepped through slide by slide
    bySlide?: boolean
}

type SlideRef = { id: string; type?: string; parent?: { id?: string; layoutIndex?: number }; layoutIndex?: number; data?: { disabled?: boolean } }

export type LiveStanza = { showId: string; groupId: string | null; index: number; refs: SlideRef[] } | null

export type NextStanza = { groupId: string; layoutIndex: number; bySlide?: boolean } | null

const getGroupId = (ref: SlideRef | undefined) => (ref ? (ref.type === "child" ? ref.parent?.id : ref.id) || null : null)
const getGroupOrder = (ref: SlideRef) => (ref.type === "child" ? ref.parent?.layoutIndex : undefined) ?? ref.layoutIndex ?? 0
const getGroupIds = (refs: SlideRef[]) => [...new Set(refs.map(getGroupId).filter(Boolean))] as string[]

// the same choice as the "next unseen" box makes (see SlideText.svelte)
export function getNextStanza(refs: SlideRef[], seen: Set<string>, activeIndex: number, skip: string[] = [], fromSlide?: number): NextStanza {
    const groupIds = getGroupIds(refs)

    if (groupIds.length === 1) {
        let index = (fromSlide ?? activeIndex) + 1
        while (refs[index]?.data?.disabled) index++
        return refs[index] ? { groupId: groupIds[0], layoutIndex: index, bySlide: true } : null
    }

    const currentGroupId = getGroupId(refs[activeIndex])
    const currentOrder = refs[activeIndex] ? getGroupOrder(refs[activeIndex]) : -1
    const order = (groupId: string) => getGroupOrder(refs.find((a) => getGroupId(a) === groupId)!)

    const unseen = groupIds.sort((a, b) => order(a) - order(b)).filter((a) => !seen.has(a) && a !== currentGroupId && !skip.includes(a))
    const groupId = unseen.find((a) => order(a) > currentOrder) || unseen[0]

    return groupId ? { groupId, layoutIndex: refs.findIndex((a) => getGroupId(a) === groupId) } : null
}

export function isRequestSynced(request: Pick<StageRequest, "showId" | "groupId" | "layoutIndex" | "bySlide">, live: LiveStanza): boolean {
    // nothing on the main screen (e.g. cleared) keeps the request
    if (!live) return false
    if (live.showId !== request.showId) return true
    return request.bySlide ? live.index === request.layoutIndex : live.groupId === request.groupId
}

type Options = {
    getLive: () => LiveStanza
    publish: (request: StageRequest | null) => void
}

export function createStageRequests(options: Options) {
    let current: StageRequest | null = null

    // stanzas that have been on the main screen
    let seen = new Set<string>()
    let seenShowId = ""

    function trackSeen(live: LiveStanza) {
        if (!live) return
        if (live.showId !== seenShowId) {
            seen = new Set()
            seenShowId = live.showId
        }
        if (!live.groupId) return

        seen.add(live.groupId)
        // starts over when everything has been seen
        if (getGroupIds(live.refs).every((a) => seen.has(a))) seen = new Set([live.groupId])
    }

    function update(request: StageRequest) {
        current = request
        options.publish(current)
    }

    function sync() {
        current = null
        // always sent, so every display is cleared
        options.publish(null)
    }

    // show the queued stanza as current on stage
    function promote() {
        if (!current || current.state === "live") return

        update({ ...current, state: "live", held: undefined, shown: [...(current.shown || []), current.groupId] })
    }

    return {
        request(data: Pick<StageRequest, "showId" | "groupId" | "layoutIndex" | "key">) {
            // already on the main screen
            if (isRequestSynced(data, options.getLive())) return sync()

            const previous = current?.showId === data.showId ? current : null
            // requested again
            if (previous && previous.groupId === data.groupId && !previous.bySlide) return promote()

            update({ ...data, state: "queued", held: previous?.state === "live" ? previous.layoutIndex : previous?.held, shown: previous?.shown })
        },
        // moves what is in the "next unseen" box to current on stage
        next() {
            if (current?.state === "queued") return promote()

            const live = options.getLive()
            if (!live) return

            const shown = current?.shown || []
            const target = getNextStanza(live.refs, seen, live.index, shown, current?.bySlide ? current.layoutIndex : undefined)
            if (!target) return

            update({ ...target, showId: live.showId, state: "live", shown: [...shown, target.groupId] })
        },
        sync,
        outputChanged() {
            const live = options.getLive()
            trackSeen(live)

            if (!current || !live) return
            if (isRequestSynced(current, live)) return sync()

            // the main screen reached the stanza that was held on stage
            if (current.held !== undefined && getGroupId(live.refs[current.held]) === live.groupId) update({ ...current, held: undefined })
        }
    }
}
