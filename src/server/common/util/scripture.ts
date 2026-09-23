export function sanitizeVerseText(input: unknown): string {
    if (input === null || input === undefined) return ""

    let text = typeof input === "string" ? input : String(input)
    text = text.replace(/\r?\n/g, "<br>")
    const normalizedSpaces = text.replace(/\u00a0/g, " ")
    const withQuotes = normalizedSpaces.replace(/<q>(.*?)<\/q>/g, "“$1”")
    const replacedUndertitles = withQuotes.replace(/<h4[^>]*>(.*?)<\/h4>\s*/g, '<span class="undertitle">$1 </span>')
    const withoutMultipleSpaces = replacedUndertitles.replace(/[^\S\r\n]{2,}/g, " ")

    return withoutMultipleSpaces.trim()
}
