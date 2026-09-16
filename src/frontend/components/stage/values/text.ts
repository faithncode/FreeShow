import { splitIntoRows, textSections, type EditBoxSection } from "../../edit/values/boxes"

export const slideTextSections: { [key: string]: EditBoxSection } = {
    default: {
        inputs: splitIntoRows([
            { id: "slideOffset", type: "number", value: 0, values: { label: "edit.slide_offset", min: -10, max: 20 } },
            { id: "lineCount", type: "number", value: 0, values: { label: "edit.max_lines" } },
            { id: "includeMedia", type: "checkbox", value: false, values: { label: "edit.includeMedia" } },
            { id: "keepStyle", type: "checkbox", value: false, values: { label: "edit.keepStyle" } },
            { id: "itemNumber", type: "number", value: 0, values: { label: "edit.item_number" } },
            { id: "invertItems", type: "checkbox", value: false, values: { label: "edit.invert_items" } },
            // ── Current-slide group mode ──────────────────────────────────────
            { id: "showGroupLines", type: "checkbox", value: false, values: { label: "stage.show_group_lines" } },
            { id: "highlightCurrentLine", type: "checkbox", value: true, values: { label: "stage.highlight_current_line" } },
            // ── Next unseen stanza mode (whole item becomes a separate preview box)
            { id: "showNextUnseen", type: "checkbox", value: false, values: { label: "stage.show_next_unseen" } },
            { id: "nextStanzaLines", type: "number", value: 2, values: { label: "stage.next_stanza_lines", min: 1, max: 10 } },
            // ── Language filter (applies to both modes) ───────────────────────
            {
                id: "lineFilter",
                type: "dropdown",
                value: "both",
                values: {
                    label: "stage.line_filter",
                    options: [
                        { value: "both", label: "stage.filter_both" },
                        { value: "tamil", label: "stage.filter_tamil" },
                        { value: "tanglish", label: "stage.filter_tanglish" }
                    ]
                }
            }
        ])
    },
    font: {
        noReset: true,
        inputs: textSections.default.inputs
    },
    align: textSections.align,
    text: textSections.text,
    // lines: textSections.lines,
    outline: textSections.outline,
    shadow: textSections.shadow,
    chords: textSections.chords,
    special: textSections.special,
    CSS: textSections.CSS
}
