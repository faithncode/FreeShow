import { describe, expect, it, vi } from "vitest"
import { createNumpadGuard, getNumpadFunction, isNumpadBackspace } from "./numpadKeys"

// mocked Raw Input data: [virtual key, scan code, flags]
const press = (scanCode: number, flags = 0) => [0, scanCode, flags]

const keyEvent = (code: string, extra: object = {}) => ({ code, target: null, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), ...extra })

function setup(options: { enabled?: boolean; typing?: boolean } = {}) {
    let time = 1000
    const pending: (() => void)[] = []
    const redispatch = vi.fn()
    const guard = createNumpadGuard({
        isEnabled: () => options.enabled !== false,
        isTyping: () => !!options.typing,
        redispatch,
        now: () => time,
        delay: (callback) => pending.push(callback)
    })

    return { guard, redispatch, advance: (ms: number) => (time += ms), flush: () => pending.splice(0).forEach((a) => a()) }
}

describe("numpad layout", () => {
    it("maps all 18 keys", () => {
        const keys = [press(69), press(53, 2), press(55), press(74), press(71), press(72), press(73), press(78), press(75), press(76), press(77), press(14), press(79), press(80), press(81), press(28, 2), press(82), press(83)]
        const result = keys.map((data) => {
            const action = getNumpadFunction(data)
            return action?.type === "peek" ? action.key : action?.type
        })

        expect(result).toEqual(["menu", "previous", "next", "interlude", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "a", "s", "b"])
    })

    it("accepts an extended NumLock", () => {
        expect(getNumpadFunction(press(69, 2))?.type).toBe("menu")
    })

    it("ignores other keys", () => {
        expect(getNumpadFunction(press(30))).toBeNull() // A
        expect(getNumpadFunction(press(28))).toBeNull() // main Enter
        expect(getNumpadFunction(press(71, 2))).toBeNull() // dedicated Home
        expect(getNumpadFunction([])).toBeNull()
    })

    it("detects Backspace", () => {
        expect(isNumpadBackspace(press(14))).toBe(true)
        expect(isNumpadBackspace(press(83))).toBe(false)
    })
})

describe("numpad keyboard guard", () => {
    it("blocks number pad keys", () => {
        const { guard } = setup()
        for (const code of ["Numpad9", "NumpadDecimal", "NumpadEnter", "NumLock"]) {
            const e = keyEvent(code)
            guard.keydown(e)
            expect(e.stopImmediatePropagation).toHaveBeenCalled()
        }
    })

    it("leaves other keys, shortcuts, and a disabled numpad alone", () => {
        const events = [keyEvent("ArrowLeft"), keyEvent("Delete"), keyEvent("NumpadAdd", { ctrlKey: true })]
        const { guard } = setup()
        events.forEach(guard.keydown)

        const disabled = keyEvent("Numpad1")
        setup({ enabled: false }).guard.keydown(disabled)

        for (const e of [...events, disabled]) expect(e.preventDefault).not.toHaveBeenCalled()
    })

    it("drops a Backspace sent by the numpad, in either order", () => {
        const { guard, redispatch, advance, flush } = setup()

        guard.keydown(keyEvent("Backspace"))
        advance(10)
        guard.numpadBackspace()
        flush()

        advance(1000)
        guard.numpadBackspace()
        advance(10)
        guard.keydown(keyEvent("Backspace"))
        flush()

        expect(redispatch).not.toHaveBeenCalled()
    })

    it("re-sends a Backspace from the main keyboard", () => {
        const { guard, redispatch, advance, flush } = setup()
        guard.numpadBackspace()
        advance(1000)

        const e = keyEvent("Backspace")
        guard.keydown(e)
        expect(e.preventDefault).toHaveBeenCalled()
        flush()
        expect(redispatch).toHaveBeenCalledWith(e)
    })

    it("does not delay Backspace while typing, and passes released events", () => {
        const typing = keyEvent("Backspace")
        setup({ typing: true }).guard.keydown(typing)

        const released = keyEvent("Backspace")
        const { guard } = setup()
        guard.release(released)
        guard.keydown(released)

        for (const e of [typing, released]) expect(e.preventDefault).not.toHaveBeenCalled()
    })
})
