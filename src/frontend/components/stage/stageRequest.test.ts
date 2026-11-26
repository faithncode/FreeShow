import { describe, expect, it, vi } from "vitest"
import { createStageRequests, type LiveStanza } from "./stageRequest"

const chorus = { showId: "song", groupId: "chorus", layoutIndex: 3 }
const bridge = { showId: "song", groupId: "bridge", layoutIndex: 4 }

// mocked song layout, verse 1 has a single slide like the others
const song = ["verse1", "verse2", "verse3", "chorus", "bridge"].map((id, layoutIndex) => ({ id, layoutIndex }))

// mocked main screen and displays
function setup(groupId = "verse1", refs: any[] = song) {
    const stanza = (id: string, showId = "song") => ({ showId, groupId: id, index: refs.findIndex((a) => a.id === id), refs })
    let live: LiveStanza = stanza(groupId)
    const publish = vi.fn()
    const requests = createStageRequests({ getLive: () => live, publish })
    requests.outputChanged()

    return {
        requests,
        publish,
        stanza,
        shown: () => publish.mock.calls[publish.mock.calls.length - 1][0],
        mainShows: (next: LiveStanza) => {
            live = next
            requests.outputChanged()
        }
    }
}

describe("stage stanza requests", () => {
    it("queues a request, and next makes it current", () => {
        const { requests, shown } = setup()

        requests.request(chorus)
        expect(shown().state).toBe("queued")

        requests.next()
        expect(shown().state).toBe("live")
        expect(shown().groupId).toBe("chorus")
    })

    it("makes a stanza current when requested again", () => {
        const { requests, publish, shown } = setup()

        requests.request(chorus)
        requests.request(chorus)
        expect(shown().state).toBe("live")

        // a third press changes nothing
        requests.request(chorus)
        expect(publish).toHaveBeenCalledTimes(2)
    })

    it("next steps through the next unseen stanzas without a request", () => {
        const { requests, shown } = setup()

        for (const groupId of ["verse2", "verse3", "chorus", "bridge"]) {
            requests.next()
            expect(shown().groupId).toBe(groupId)
            expect(shown().state).toBe("live")
        }
    })

    it("next goes round again after the last stanza", () => {
        const { requests, shown } = setup()
        const stage = () => {
            requests.next()
            return shown()?.groupId || "main screen"
        }

        const round = ["verse2", "verse3", "chorus", "bridge", "main screen"]
        expect([...round, ...round].map(() => stage())).toEqual([...round, ...round])
    })

    it("next keeps cycling after requests and a moving main screen", () => {
        const { requests, shown, stanza, mainShows } = setup()
        mainShows(stanza("verse2"))
        requests.request(chorus)
        requests.next()

        const stage: string[] = []
        for (let i = 0; i < 20; i++) {
            requests.next()
            stage.push(shown()?.groupId || "main screen")
        }

        // it never gets stuck on one
        expect(stage.some((a, i) => a === stage[i - 1])).toBe(false)
    })

    it("next skips what the main screen has already shown", () => {
        const { requests, shown, stanza, mainShows } = setup()
        mainShows(stanza("verse2"))

        requests.next()
        expect(shown().groupId).toBe("verse3")
    })

    it("next continues in order after a requested stanza", () => {
        const { requests, shown } = setup()
        requests.request(chorus)
        requests.next()
        requests.next()

        expect(shown().groupId).toBe("verse2")
        expect(shown().shown).toEqual(["chorus", "verse2"])
    })

    it("keeps the stage text while another stanza is queued", () => {
        const { requests, shown, stanza, mainShows } = setup()
        requests.next() // verse 2 on stage
        requests.request(bridge)
        expect(shown().state).toBe("queued")
        expect(shown().held).toBe(1)

        mainShows(stanza("verse2"))
        expect(shown().held).toBe(undefined)
        expect(shown().groupId).toBe("bridge")
    })

    it("steps slide by slide through a song with one stanza", () => {
        const refs = [{ id: "all", layoutIndex: 0 }, ...[1, 2].map((layoutIndex) => ({ id: "child" + layoutIndex, type: "child", parent: { id: "all" }, layoutIndex }))]
        const { requests, shown, mainShows } = setup("all", refs)

        requests.next()
        expect(shown().layoutIndex).toBe(1)
        requests.next()
        expect(shown().layoutIndex).toBe(2)

        mainShows({ showId: "song", groupId: "all", index: 2, refs })
        expect(shown()).toBe(null)
    })

    it("starts a one stanza song again after its last slide", () => {
        const refs = [{ id: "all", layoutIndex: 0 }, ...[1, 2].map((layoutIndex) => ({ id: "child" + layoutIndex, type: "child", parent: { id: "all" }, layoutIndex }))]
        const { requests, shown } = setup("all", refs)
        const stage = () => {
            requests.next()
            return shown()?.layoutIndex ?? "main screen"
        }

        expect([1, 2, 3, 4, 5, 6].map(stage)).toEqual([1, 2, "main screen", 1, 2, "main screen"])
    })

    it("syncs when the main screen reaches the stanza", () => {
        const { requests, shown, stanza, mainShows } = setup()
        requests.request(chorus)
        requests.next()

        mainShows(stanza("verse2"))
        expect(shown().state).toBe("live")

        mainShows(stanza("chorus"))
        expect(shown()).toBe(null)
    })

    it("syncs a queued request, a song change, but not a cleared screen", () => {
        for (const [groupId, showId] of [["chorus", "song"], ["verse1", "other"]]) {
            const { requests, shown, stanza, mainShows } = setup()
            requests.request(chorus)
            mainShows(stanza(groupId, showId))
            expect(shown()).toBe(null)
        }

        const { requests, shown, mainShows } = setup()
        requests.request(chorus)
        mainShows(null)
        expect(shown().state).toBe("queued")
    })

    it("syncs manually, and starts again from the main screen", () => {
        const { requests, shown } = setup()
        requests.next()
        requests.next()
        requests.sync()
        expect(shown()).toBe(null)

        requests.next()
        expect(shown().groupId).toBe("verse2")
    })

    it("ignores a request for the stanza already on the main screen", () => {
        const { requests, shown } = setup("chorus")
        requests.request(chorus)
        expect(shown()).toBe(null)
    })
})
