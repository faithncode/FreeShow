import { describe, expect, it, vi } from "vitest"
import { createStageRequests, type LiveStanza } from "./stageRequest"

const chorus = { showId: "song", groupId: "chorus", layoutIndex: 3 }

// mocked main screen and displays
function setup(groupId = "verse1") {
    let live: LiveStanza = { showId: "song", groupId }
    const publish = vi.fn()
    const advance = vi.fn()
    const requests = createStageRequests({ getLive: () => live, publish, advance })

    return {
        requests,
        publish,
        advance,
        shown: () => publish.mock.calls[publish.mock.calls.length - 1][0],
        mainShows: (next: LiveStanza) => {
            live = next
            requests.outputChanged()
        }
    }
}

describe("stage stanza requests", () => {
    it("queues a request, and next makes it current without advancing", () => {
        const { requests, advance, shown } = setup()

        requests.request(chorus)
        expect(shown().state).toBe("queued")

        requests.next()
        expect(shown().state).toBe("live")

        requests.next()
        expect(shown().state).toBe("live")
        expect(advance).not.toHaveBeenCalled()
    })

    it("syncs when the main screen reaches the stanza", () => {
        const { requests, shown, mainShows } = setup()
        requests.request(chorus)
        requests.next()

        mainShows({ showId: "song", groupId: "verse2" })
        expect(shown().state).toBe("live")

        mainShows({ showId: "song", groupId: "chorus" })
        expect(shown()).toBe(null)
    })

    it("syncs a queued request, a song change, but not a cleared screen", () => {
        for (const live of [{ showId: "song", groupId: "chorus" }, { showId: "other", groupId: "verse1" }]) {
            const { requests, shown, mainShows } = setup()
            requests.request(chorus)
            mainShows(live)
            expect(shown()).toBe(null)
        }

        const { requests, shown, mainShows } = setup()
        requests.request(chorus)
        mainShows(null)
        expect(shown().state).toBe("queued")
    })

    it("syncs manually, and next advances when nothing is requested", () => {
        const { requests, advance, shown } = setup()
        requests.request(chorus)
        requests.sync()
        expect(shown()).toBe(null)

        requests.next()
        expect(advance).toHaveBeenCalled()
    })

    it("ignores a request for the stanza already on the main screen", () => {
        const { requests, shown } = setup("chorus")
        requests.request(chorus)
        expect(shown()).toBe(null)
    })
})
