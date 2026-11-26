// Singer numpad: pure key mapping and keyboard blocking logic (no app imports, so it can be tested)

export type NumpadFunction = { type: "menu" } | { type: "previous" } | { type: "next" } | { type: "peek"; key: string }

// Raw Input flag for extended keys (Numpad "/" and "Enter")
const E0 = 2

const verse = (key: string): NumpadFunction => ({ type: "peek", key })

// Keyed by scan code, which identifies the physical key regardless of the NumLock state
// "<scan code>" or "<scan code>e" for extended keys
const LAYOUT: { [id: string]: NumpadFunction } = {
    // verses 1-12 run left to right, top to bottom
    "69": verse("q"), // NumLock: verse 1
    "53e": verse("w"), // /: verse 2
    "55": verse("e"), // *: verse 3

    "71": verse("r"), // 7: verse 4
    "72": verse("t"), // 8: verse 5
    "73": verse("y"), // 9: verse 6

    "75": verse("u"), // 4: verse 7
    "76": verse("i"), // 5: verse 8
    "77": verse("o"), // 6: verse 9

    "79": verse("p"), // 1: verse 10
    "80": verse("["), // 2: verse 11
    "81": verse("]"), // 3: verse 12

    "74": { type: "menu" }, // -
    "78": { type: "previous" }, // +: sync
    "14": { type: "next" }, // Backspace

    "28e": verse("a"), // Enter: chorus

    "82": verse("s"), // 0: intro
    "83": verse("b") // .: bridge
}

// what is printed on the numpad sticker for a stanza key
export function getStanzaKeyLabel(key: string): string {
    const verseNumber = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]"].indexOf(key.toLowerCase()) + 1
    if (verseNumber) return String(verseNumber)

    return { a: "C", s: "I", b: "B" }[key.toLowerCase()] || key.toUpperCase()
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

// used to detect which device is the numpad: 1-9, 0, ".", "-" and "+"
// (these scan codes are only shared with the navigation keys, which are extended)
export function isNumpadDigit(data: number[]): boolean {
    return data.length >= 3 && data[1] >= 71 && data[1] <= 83 && !(data[2] & E0)
}

// the vendor, product and interface part of a device path, which stays the same in another USB port
const getHardwareId = (path: string) => path.toLowerCase().match(/vid_[0-9a-f]{4}&pid_[0-9a-f]{4}(&mi_[0-9a-f]{2})?(&col[0-9a-f]+)?/)?.[0]

// the saved path changes when the device is plugged into another port
export function findNumpadDevice(savedPath: string, paths: string[]): string {
    if (paths.some((a) => a.toLowerCase() === savedPath.toLowerCase())) return savedPath

    const id = getHardwareId(savedPath)
    const matches = id ? paths.filter((a) => getHardwareId(a) === id) : []
    // two of the same model can't be told apart
    return matches.length === 1 ? matches[0] : savedPath
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
