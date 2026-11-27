// A stanza shown on stage ahead of the main screen (pure logic, no app imports, so it can be tested)
// queued: shown in the "next unseen" box
// live: shown as the current text on stage ("next")
// synced: nothing is ahead, only used to highlight the current text
// Nothing here changes the main screen. It all ends when the main screen reaches the same stanza,
// when synced manually, or when the singer has been idle, and it never changes the point the main screen has reached.

export type StageRequest = {
    showId: string
    groupId: string
    layoutIndex: number
    key?: string
    state: "queued" | "live" | "synced"
    // stays current on stage while another stanza is queued
    held?: number
    // furthest stanza reached with the stage ahead, replaces what the main screen reached
    mark?: number
    // a song with only one stanza is stepped through slide by slide
    bySlide?: boolean
    // changes when the stanza already current on stage is requested
    flash?: number
}

type SlideRef = { id: string; type?: string; parent?: { id?: string; layoutIndex?: number }; layoutIndex?: number; data?: { disabled?: boolean } }

export type LiveStanza = { showId: string; groupId: string | null; index: number; refs: SlideRef[] } | null

export type NextStanza = { groupId: string; layoutIndex: number; bySlide?: boolean } | null

// how long without any singer input before the stage returns to the main screen
export const IDLE_SYNC_MS = 20000

const getGroupId = (ref: SlideRef | undefined) => (ref ? (ref.type === "child" ? ref.parent?.id : ref.id) || null : null)
const getGroupOrder = (ref: SlideRef) => (ref.type === "child" ? ref.parent?.layoutIndex : undefined) ?? ref.layoutIndex ?? 0

// stanzas in song order
function getGroups(refs: SlideRef[]) {
    const groups = new Map<string, number>()
    refs.forEach((ref) => {
        const groupId = getGroupId(ref)
        if (groupId && !groups.has(groupId)) groups.set(groupId, getGroupOrder(ref))
    })
    return [...groups].map(([id, order]) => ({ id, order })).sort((a, b) => a.order - b.order)
}

// "mark" is the furthest point reached in the song: going back (like to a chorus) does not move it,
// only the first stanza starts the song again
export function advanceMark(refs: SlideRef[], mark: number, groupId: string | null): number {
    const groups = getGroups(refs)
    const order = groups.find((a) => a.id === groupId)?.order
    if (order === undefined) return mark

    return order === groups[0].order ? order : Math.max(mark, order)
}

// the same choice as the "next unseen" box makes (see SlideText.svelte):
// the stanza after the furthest one reached, otherwise from the beginning again
export function getNextStanza(refs: SlideRef[], mark: number, fromIndex: number): NextStanza {
    const groups = getGroups(refs)

    if (groups.length === 1) {
        const enabledFrom = (index: number) => {
            while (refs[index]?.data?.disabled) index++
            return index
        }

        let index = enabledFrom(fromIndex + 1)
        if (!refs[index]) index = enabledFrom(0)

        return refs[index] && index !== fromIndex ? { groupId: groups[0].id, layoutIndex: index, bySlide: true } : null
    }

    const currentGroupId = getGroupId(refs[fromIndex])
    const target = groups.find((a) => a.order > mark && a.id !== currentGroupId) || groups.find((a) => a.id !== currentGroupId)
    if (!target) return null

    return { groupId: target.id, layoutIndex: refs.findIndex((a) => getGroupId(a) === target.id) }
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
    // returns a function that cancels the timer
    schedule?: (callback: () => void, ms: number) => () => void
}

const startTimer = (callback: () => void, ms: number) => {
    const timeout = setTimeout(callback, ms)
    return () => clearTimeout(timeout)
}

export function createStageRequests(options: Options) {
    let current: StageRequest | null = null
    let cancelIdle: (() => void) | null = null
    let flashCount = 0

    // furthest stanza reached on the main screen
    let mainMark = -1
    let markShowId = ""

    function trackMain(live: LiveStanza) {
        if (!live) return
        if (live.showId !== markShowId) {
            mainMark = -1
            markShowId = live.showId
        }
        mainMark = advanceMark(live.refs, mainMark, live.groupId)
    }

    function update(request: StageRequest) {
        current = request
        options.publish(current)
    }

    function sync() {
        cancelIdle?.()
        current = null
        // always sent, so every display is cleared
        options.publish(null)
    }

    // restarted by any singer input
    function touch() {
        cancelIdle?.()
        cancelIdle = (options.schedule || startTimer)(() => {
            if (current) sync()
        }, IDLE_SYNC_MS)
    }

    // show the queued stanza as current on stage
    function promote() {
        if (!current || current.state === "live") return

        const live = options.getLive()
        const mark = live ? advanceMark(live.refs, current.mark ?? mainMark, current.groupId) : current.mark

        update({ ...current, state: "live", held: undefined, mark })
    }

    // where the stage is ahead of the main screen, if it is
    const getStageIndex = () => (current?.state === "live" ? current.layoutIndex : current?.held)

    return {
        touch,
        request(data: Pick<StageRequest, "showId" | "groupId" | "layoutIndex" | "key">) {
            touch()

            const live = options.getLive()
            const previous = current?.showId === data.showId ? current : null
            const stageIndex = previous ? getStageIndex() : undefined

            // already current on stage: only highlight it
            const stageGroupId = stageIndex !== undefined && live ? getGroupId(live.refs[stageIndex]) : live?.groupId
            if (live?.showId === data.showId && stageGroupId === data.groupId) {
                const shown = current || { showId: data.showId, groupId: data.groupId, layoutIndex: data.layoutIndex, state: "synced" as const }
                // the count makes two presses at the same moment differ as well
                options.publish({ ...shown, flash: Date.now() + ++flashCount })
                return
            }

            // already on the main screen
            if (isRequestSynced(data, live)) return sync()
            update({ ...data, state: "queued", held: stageIndex, mark: previous?.mark })
        },
        // moves what is in the "next unseen" box to current on stage
        next() {
            touch()
            if (current?.state === "queued") return promote()

            const live = options.getLive()
            if (!live) return

            const mark = current?.mark ?? mainMark
            const target = getNextStanza(live.refs, mark, getStageIndex() ?? live.index)
            if (!target) return
            // gone all the way round to what is on the main screen
            if (isRequestSynced({ ...target, showId: live.showId }, live)) return sync()

            update({ ...target, showId: live.showId, state: "live", mark: advanceMark(live.refs, mark, target.groupId) })
        },
        sync,
        outputChanged() {
            const live = options.getLive()
            trackMain(live)

            if (!current || !live) return
            if (isRequestSynced(current, live)) return sync()

            // the main screen reached the stanza that was held on stage
            if (current.held !== undefined && getGroupId(live.refs[current.held]) === live.groupId) update({ ...current, held: undefined })
        }
    }
}
