import { get } from "svelte/store"
import { OUTPUT, STAGE } from "../../../types/Channels"
import { outputs, stagePeekStanza } from "../../stores"
import { send } from "../../utils/request"
import { getActiveOutputs } from "../helpers/output"
import { _show } from "../helpers/shows"
import { createStageRequests, type LiveStanza } from "./stageRequest"

// the stanza currently on the main screen
function getLiveStanza(): LiveStanza {
    const allOutputs = get(outputs)
    // getActiveOutputs creates a default output if there are none yet
    if (!Object.keys(allOutputs).length) return null
    const activeIds = getActiveOutputs(allOutputs, false, true, true)
    const slide = allOutputs[activeIds[0]]?.out?.slide
    if (!slide?.id) return null

    const refs: any[] = slide.id === "temp" ? [] : _show(slide.id).layouts(slide.layout ? [slide.layout] : "active").ref()?.[0] || []
    const ref = refs[slide.index ?? -1]
    return { showId: slide.id, groupId: (ref?.type === "child" ? ref.parent?.id : ref?.id) || null, index: slide.index ?? -1, refs }
}

export const stageRequests = createStageRequests({
    getLive: getLiveStanza,
    publish: (request) => {
        stagePeekStanza.set(request)
        send(STAGE, ["PEEK_STANZA"], request)
        send(OUTPUT, ["STAGE_PEEK_STANZA"], request)
    }
})

// called on startup: subscribing while the modules are still loading stops the app from opening
export function initStageRequests() {
    outputs.subscribe(() => stageRequests.outputChanged())
}
