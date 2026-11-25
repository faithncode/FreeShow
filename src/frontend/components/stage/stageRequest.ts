// A stanza requested by a singer (pure logic, no app imports, so it can be tested)
// queued: shown in the "next unseen" box
// live: shown as the current text on stage
// The request ends when the main screen reaches the same stanza, or when synced manually.
// It never changes which stanzas count as seen, so "next unseen" returns to normal afterwards.

export type StageRequest = {
    showId: string
    groupId: string
    layoutIndex: number
    key?: string
    state: "queued" | "live"
}

export type LiveStanza = { showId: string; groupId: string | null } | null

export function isRequestSynced(request: StageRequest, live: LiveStanza): boolean {
    // nothing on the main screen (e.g. cleared) keeps the request
    if (!live) return false
    return live.showId !== request.showId || live.groupId === request.groupId
}

type Options = {
    getLive: () => LiveStanza
    publish: (request: StageRequest | null) => void
    advance: () => void
}

export function createStageRequests(options: Options) {
    let current: StageRequest | null = null

    function sync() {
        current = null
        // always sent, so every display is cleared
        options.publish(null)
    }

    return {
        request(data: Omit<StageRequest, "state">) {
            const request: StageRequest = { ...data, state: "queued" }
            // already on the main screen
            if (isRequestSynced(request, options.getLive())) return sync()

            current = request
            options.publish(current)
        },
        next() {
            if (!current) return options.advance()
            // a stanza already on stage waits for the main screen, so it is not skipped past by accident
            if (current.state === "live") return

            current = { ...current, state: "live" }
            options.publish(current)
        },
        sync,
        outputChanged() {
            if (current && isRequestSynced(current, options.getLive())) sync()
        }
    }
}
