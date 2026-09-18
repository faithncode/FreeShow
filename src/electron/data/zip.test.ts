import fs from "fs"
import os from "os"
import path from "path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

// Host the temporary folder setup so it runs before imports are resolved
const h = vi.hoisted(() => {
    const fs = require("fs")
    const os = require("os")
    const path = require("path")
    return { tempRoot: fs.mkdtempSync(path.join(os.tmpdir(), "freeshow-zip-")) }
})

vi.mock("../IPC/main", () => ({ sendMain: vi.fn(), sendToMain: vi.fn(), requestMain: vi.fn() }))

// utils/files.ts pulls in electron and the whole store/IPC chain, which is not what
// is being tested here — these are the two thin helpers zip.ts actually uses
vi.mock("../utils/files", () => {
    const fs = require("fs")
    const path = require("path")
    return {
        createFolder: (folderPath: string) => {
            fs.mkdirSync(folderPath, { recursive: true })
            return folderPath
        },
        getExtension: (name: string) => path.extname(name).substring(1).toLowerCase()
    }
})

import { compressToZip, decompressZipStream } from "./zip"

const zipPath = path.join(h.tempRoot, "out.zip")

function writeTempFile(name: string, content: string) {
    const filePath = path.join(h.tempRoot, name)
    fs.writeFileSync(filePath, content)
    return filePath
}

describe("compressToZip", () => {
    beforeEach(() => {
        fs.rmSync(zipPath, { force: true })
    })

    it("skips a store that has no file on disk instead of failing the whole zip", async () => {
        // electron-store only writes a store's file on the first set(), so a store
        // that never got any value (e.g. OVERLAYS) has no file at all — see backup.ts
        const entries = [
            { name: "SYNCED_SETTINGS.json", filePath: writeTempFile("settings_synced.json", JSON.stringify({ a: 1 })) },
            { name: "OVERLAYS.json", filePath: path.join(h.tempRoot, "overlays.json") },
            { name: "SHOWS/Test.show", filePath: writeTempFile("Test.show", JSON.stringify(["id", { name: "Test" }])) }
        ]

        await expect(compressToZip(entries, zipPath)).resolves.toBeUndefined()

        const files = await decompressZipStream(zipPath)
        expect(files.map((a) => a.name).sort()).toEqual(["SHOWS/Test.show", "SYNCED_SETTINGS.json"])
    })

    it("skips a folder, yazl refuses to add those", async () => {
        const folderPath = path.join(h.tempRoot, "a_folder")
        fs.mkdirSync(folderPath, { recursive: true })

        const entries = [
            { name: "SYNCED_SETTINGS.json", filePath: writeTempFile("settings_synced.json", "{}") },
            { name: "OVERLAYS.json", filePath: folderPath }
        ]

        await expect(compressToZip(entries, zipPath)).resolves.toBeUndefined()

        const files = await decompressZipStream(zipPath)
        expect(files.map((a) => a.name)).toEqual(["SYNCED_SETTINGS.json"])
    })

    it("rejects and removes the truncated zip if a file disappears while zipping", async () => {
        const filePath = writeTempFile("vanishing.show", JSON.stringify(["id", { name: "Vanishing" }]))
        const entries = [{ name: "SHOWS/vanishing.show", filePath }]

        const promise = compressToZip(entries, zipPath)
        // the entry passed the existence check, but is gone before yazl streams it
        fs.rmSync(filePath, { force: true })

        await expect(promise).rejects.toThrow()
        expect(fs.existsSync(zipPath)).toBe(false)
    })

    it("rejects if the zip itself can't be written", async () => {
        const unwritablePath = path.join(h.tempRoot, "missing_folder", "out.zip")

        await expect(compressToZip([{ name: "OVERLAYS.json", content: "{}" }], unwritablePath)).rejects.toThrow()
    })

    it("keeps a successfully written zip", async () => {
        const entries = [{ name: "OVERLAYS.json", content: "{}" }]

        await compressToZip(entries, zipPath)

        const files = await decompressZipStream(zipPath)
        expect(files.map((a) => a.name)).toEqual(["OVERLAYS.json"])
        expect(files[0].content).toBe("{}")

        // nothing should remove it after the fact
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(fs.existsSync(zipPath)).toBe(true)
    })
})

describe("decompressZip & decompressZipManual", () => {
    beforeEach(() => {
        fs.rmSync(zipPath, { force: true })
    })

    it("decompressZip returns entries with zipName", async () => {
        const { decompressZip } = await import("./zip")
        const entries = [
            { name: "Song1.pro6", content: "<RVPresentationDocument />" },
            { name: "data.pro6pl", content: "<RVPlaylistDocument />" }
        ]
        await compressToZip(entries, zipPath)

        const files = await decompressZip([zipPath])
        expect(files.length).toBe(2)
        expect(files[0].zipName).toBe("out")
        expect(files[0].name).toBe("Song1.pro6")
        expect(files[0].extension).toBe("pro6")
        expect(files[0].content).toBe("<RVPresentationDocument />")
    })

    it("decompressZipManual extracts entries without crashing", async () => {
        const { decompressZipManual } = await import("./zip")
        const entries = [
            { name: "Folder/Song1.pro6", content: "hello world pro6" },
            { name: "Folder/data.pro6pl", content: "playlist xml content" }
        ]
        await compressToZip(entries, zipPath)

        const files = decompressZipManual(zipPath)
        expect(files.length).toBe(2)
        expect(files.map((f) => f.name).sort()).toEqual(["Folder/Song1.pro6", "Folder/data.pro6pl"].sort())
        expect(files.find((f) => f.name === "Folder/Song1.pro6")?.content).toBe("hello world pro6")
    })

    it("decompressZip automatically recovers via manual fallback when central directory is corrupted", async () => {
        const { decompressZip } = await import("./zip")
        const entries = [{ name: "MyPlaylist/Song.pro6", content: "<RVPresentationDocument />" }]
        await compressToZip(entries, zipPath)

        // Corrupt the central directory by truncating the last 80 bytes
        const originalBytes = fs.readFileSync(zipPath)
        const corruptPath = path.join(h.tempRoot, "corrupted.pro6plx")
        fs.writeFileSync(corruptPath, originalBytes.subarray(0, originalBytes.length - 80))

        const files = await decompressZip([corruptPath])
        expect(files.length).toBe(1)
        expect(files[0].name).toBe("MyPlaylist/Song.pro6")
        expect(files[0].content).toBe("<RVPresentationDocument />")
        expect(files[0].zipName).toBe("corrupted")
    })

    afterAll(() => {
        fs.rmSync(h.tempRoot, { recursive: true, force: true })
    })
})
