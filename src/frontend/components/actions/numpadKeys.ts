// Singer numpad: pure key mapping and keyboard blocking logic (no app imports, so it can be tested)

export type NumpadFunction = { type: "menu" } | { type: "previous" } | { type: "next" } | { type: "interlude" } | { type: "peek"; key: string }

// Raw Input flag for extended keys (Numpad "/" and "Enter")
const E0 = 2

const verse = (key: string): NumpadFunction => ({ type: "peek", key })

// Keyed by scan code, which identifies the physical key regardless of the NumLock state
// "<scan code>" or "<scan code>e" for extended keys
const LAYOUT: { [id: string]: NumpadFunction } = {
    "69": { type: "menu" }, // NumLock
    "53e": { type: "previous" }, // /
    "55": { type: "next" }, // *
    "74": { type: "interlude" }, // -

    "71": verse("q"), // 7: verse 1
    "72": verse("w"), // 8: verse 2
    "73": verse("e"), // 9: verse 3
    "78": verse("r"), // +: verse 4

    "75": verse("t"), // 4: verse 5
    "76": verse("y"), // 5: verse 6
    "77": verse("u"), // 6: verse 7
    "14": verse("i"), // Backspace: verse 8

    "79": verse("o"), // 1: verse 9
    "80": verse("p"), // 2: verse 10
    "81": verse("["), // 3: verse 11
    "28e": verse("a"), // Enter: chorus

    "82": verse("s"), // 0: intro
    "83": verse("b") // .: bridge
}

const NUMLOCK_SCAN_CODE = 69
const BACKSPACE_SCAN_CODE = 14

// data from the Raw Input helper: [virtual key, scan code, flags]
export function getNumpadFunction(data: number[]): NumpadFunction | null {
    if (data.length < 3) return null

    const scanCode = data[1]
    // NumLock is reported both with and without the extended flag
    const extended = scanCode !== NUMLOCK_SCAN_CODE && !!(data[2] & E0)
    return LAYOUT[`${scanCode}${extended ? "e" : ""}`] || null
}

export function isNumpadBackspace(data: number[]): boolean {
    return data[1] === BACKSPACE_SCAN_CODE && !(data[2] & E0)
}

// how long a Backspace press waits for the numpad to claim it
export const BACKSPACE_WAIT_MS = 150
// the numpad signal can also arrive just before the key event
const BACKSPACE_EARLY_MS = 300

type GuardOptions = {
    isEnabled: () => boolean
    isTyping: (target: any) => boolean
    redispatch: (e: any) => void
    now?: () => number
    delay?: (callback: () => void, ms: number) => void
}

// The numpad is also a normal keyboard to the OS, so its key presses have to be stopped from triggering shortcuts
export function createNumpadGuard(options: GuardOptions) {
    const now = options.now || (() => Date.now())
    const delay = options.delay || ((callback: () => void, ms: number) => void setTimeout(callback, ms))
    const released = new WeakSet<object>()
    let numpadBackspaceAt = -Infinity

    function block(e: any) {
        e.preventDefault()
        e.stopImmediatePropagation()
    }

    function keydown(e: any) {
        if (released.has(e) || !options.isEnabled()) return
        if (e.ctrlKey || e.metaKey || e.altKey) return

        // "code" is the physical key, so this includes navigation keys with NumLock off
        const code: string = e.code || ""
        if (code.startsWith("Numpad") || code === "NumLock") return block(e)

        // Backspace looks the same as on the main keyboard, so wait to see if the numpad sent it
        if (code !== "Backspace" || options.isTyping(e.target)) return

        block(e)
        const pressedAt = now()
        delay(() => {
            if (numpadBackspaceAt >= pressedAt - BACKSPACE_EARLY_MS) return
            options.redispatch(e)
        }, BACKSPACE_WAIT_MS)
    }

    return {
        keydown,
        numpadBackspace: () => {
            numpadBackspaceAt = now()
        },
        // let a re-sent event pass through
        release: (e: object) => {
            released.add(e)
        }
    }
}
