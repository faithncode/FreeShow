import { get } from "svelte/store"
import { showStanzaMenu, special } from "../../stores"
import { isTypingTarget } from "../../utils/shortcutsHelper"
import { stageRequests } from "../stage/stageRequests"
import { peekStanzaAction, toggleStageMenuAction } from "./apiHelper"
import { createNumpadGuard, getNumpadFunction, isNumpadBackspace } from "./numpadKeys"

// device path of the enabled singer numpad
export function getNumpadDevice(): string {
    const numpad = get(special).numpad
    return numpad?.enabled ? numpad.device || "" : ""
}

const guard = createNumpadGuard({
    isEnabled: () => !!getNumpadDevice(),
    isTyping: (target) => isTypingTarget(target instanceof Element ? target : null),
    redispatch: (e: KeyboardEvent) => {
        const copy = new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, repeat: e.repeat, bubbles: true, cancelable: true })
        guard.release(copy)
        const target = e.target instanceof Node && e.target.isConnected ? e.target : document.body
        target.dispatchEvent(copy)
    }
})

export function initNumpadGuard() {
    window.addEventListener("keydown", guard.keydown, true)
}

export function receivedNumpad(data: number[]) {
    if (isNumpadBackspace(data)) guard.numpadBackspace()

    const action = getNumpadFunction(data)
    if (!action) return

    if (action.type === "menu") toggleStageMenuAction()
    // "previous" returns the stage to what is on the main screen
    else if (action.type === "previous") stageRequests.sync()
    else if (action.type === "next") stageRequests.next()
    else if (action.type === "peek") {
        peekStanzaAction({ key: action.key })
        if (get(showStanzaMenu)) toggleStageMenuAction(false)
    }
    // "interlude" is reserved
}
