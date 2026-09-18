/* eslint-disable no-shadow */
import { presetShapes } from "./powerpointPresetShapes"

    const normalizeX = (x) => (width ? (x - x1) / width : 0.5)
    const normalizeY = (y) => (height ? (y - y1) / height : 0.5)

// DrawingML angles are in 60000ths of a degree
const toRadians = (angle: number) => ((angle / 60000) * Math.PI) / 180

// arcTo: the current point is on the ellipse at the start angle
// angles are visual angles, converted to the ellipse parameter angle
export function getArcSegments(current: { x: number; y: number }, wR: number, hR: number, stAng: number, swAng: number) {
    const toParam = (angle: number) => Math.atan2(wR * Math.sin(angle), hR * Math.cos(angle))
    const st = toRadians(stAng)
    const sw = toRadians(swAng)

    const p1 = toParam(st)
    let dp = toParam(st + sw) - p1
    if (Math.abs(sw) >= Math.PI * 2 - 1e-9) dp = Math.sign(sw) * Math.PI * 2
    else if (sw > 0 && dp < 0) dp += Math.PI * 2
    else if (sw < 0 && dp > 0) dp -= Math.PI * 2

    const cx = current.x - wR * Math.cos(p1)
    const cy = current.y - hR * Math.sin(p1)

    // svg can't draw a full ellipse with one arc
    const count = Math.max(1, Math.ceil(Math.abs(dp) / Math.PI - 1e-9))
    const segments: { x: number; y: number; sweep: number }[] = []
    for (let i = 1; i <= count; i++) {
        const angle = p1 + (dp * i) / count
        segments.push({ x: cx + wR * Math.cos(angle), y: cy + hR * Math.sin(angle), sweep: dp > 0 ? 1 : 0 })
    }
    return segments
}

const shadeModes: { [key: string]: { color: string; opacity: number } } = {
    darken: { color: "#000000", opacity: 0.4 },
    darkenLess: { color: "#000000", opacity: 0.2 },
    lighten: { color: "#FFFFFF", opacity: 0.4 },
    lightenLess: { color: "#FFFFFF", opacity: 0.2 }
}

// evaluate a preset shape definition, returns paths normalized to 0..1
export function getPresetShapePaths(prstGeom: string, width: number, height: number, adjustments: { [key: string]: number } = {}): ShapePath[] | null {
    const definition = presetShapes[prstGeom]
    if (!definition) return null
    const [avLst, gdLst, pathLst] = definition

    const w = width
    const h = height
    const ss = Math.min(w, h)
    const values: { [key: string]: number } = { w, h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, ss, ls: Math.max(w, h), cd2: 10800000, cd4: 5400000, cd8: 2700000, "3cd4": 16200000, "3cd8": 8100000, "5cd8": 13500000, "7cd8": 18900000 }
    ;[2, 3, 4, 5, 6, 8, 10, 12, 16, 32].forEach((n) => {
        values["wd" + n] = w / n
        values["hd" + n] = h / n
        values["ssd" + n] = ss / n
    })

    const getValue = (token: string) => (token in values ? values[token] : Number(token))
    const split = (list: string) => (list ? list.split(";").map((item) => [item.slice(0, item.indexOf("=")), item.slice(item.indexOf("=") + 1)]) : [])

    split(avLst).forEach(([name, value]) => {
        const custom = adjustments[name] ?? (name === "adj" ? adjustments.adj1 : name === "adj1" ? adjustments.adj : undefined)
        values[name] = custom ?? Number(value)
    })

    split(gdLst).forEach(([name, formula]) => {
        const [op, ...args] = formula.split(" ")
        const [x, y, z] = args.map(getValue)
        let result = 0
        if (op === "*/") result = (x * y) / z
        else if (op === "+-") result = x + y - z
        else if (op === "+/") result = (x + y) / z
        else if (op === "?:") result = x > 0 ? y : z
        else if (op === "abs") result = Math.abs(x)
        else if (op === "at2") result = ((Math.atan2(y, x) * 180) / Math.PI) * 60000
        else if (op === "cat2") result = x * Math.cos(Math.atan2(z, y))
        else if (op === "cos") result = x * Math.cos(toRadians(y))
        else if (op === "max") result = Math.max(x, y)
        else if (op === "min") result = Math.min(x, y)
        else if (op === "mod") result = Math.sqrt(x * x + y * y + z * z)
        else if (op === "pin") result = y < x ? x : y > z ? z : y
        else if (op === "sat2") result = x * Math.sin(Math.atan2(z, y))
        else if (op === "sin") result = x * Math.sin(toRadians(y))
        else if (op === "sqrt") result = Math.sqrt(x)
        else if (op === "tan") result = x * Math.tan(toRadians(y))
        else if (op === "val") result = x
        values[name] = result
    })

    const fmt = (n: number) => String(Number(n.toFixed(5)))
    const paths: ShapePath[] = []

    for (const pathDef of pathLst) {
        const parts = pathDef.split("|")
        const commands = parts.pop()!.split(" ")
        const flags = parts

        const pathW = Number(flags.find((f) => f.startsWith("w"))?.slice(1)) || 0
        const pathH = Number(flags.find((f) => f.startsWith("h"))?.slice(1)) || 0
        const fillMode = flags.find((f) => f.startsWith("f"))?.slice(1) || ""

        // path coordinates (in path space) to normalized 0..1
        const scaleX = pathW ? 1 / pathW : w ? 1 / w : 0
        const scaleY = pathH ? 1 / pathH : h ? 1 / h : 0
        const nx = (x: number) => (scaleX ? x * scaleX : 0.5)
        const ny = (y: number) => (scaleY ? y * scaleY : 0.5)

        let current = { x: 0, y: 0 }
        let start = { x: 0, y: 0 }
        let d = ""
        let i = 0
        const next = () => getValue(commands[++i])

        for (; i < commands.length; i++) {
            const cmd = commands[i]
            if (cmd === "M" || cmd === "L") {
                current = { x: next(), y: next() }
                if (cmd === "M") start = current
                d += `${cmd} ${fmt(nx(current.x))} ${fmt(ny(current.y))} `
            } else if (cmd === "Q" || cmd === "C") {
                const count = cmd === "Q" ? 2 : 3
                const pts: string[] = []
                for (let p = 0; p < count; p++) {
                    current = { x: next(), y: next() }
                    pts.push(`${fmt(nx(current.x))} ${fmt(ny(current.y))}`)
                }
                d += `${cmd} ${pts.join(" ")} `
            } else if (cmd === "A") {
                const wR = next()
                const hR = next()
                const stAng = next()
                const swAng = next()
                if (!wR || !hR || !swAng) continue
                getArcSegments(current, wR, hR, stAng, swAng).forEach((seg) => {
                    d += `A ${fmt(nx(wR))} ${fmt(ny(hR))} 0 0 ${seg.sweep} ${fmt(nx(seg.x))} ${fmt(ny(seg.y))} `
                    current = { x: seg.x, y: seg.y }
                })
            } else if (cmd === "Z") {
                current = start
                d += "Z "
            }
        }

        if (d.includes("NaN") || d.includes("Infinity")) return null
        if (d.trim()) paths.push({ d: d.trim(), noFill: fillMode === "none", noStroke: flags.includes("s0"), shade: shadeModes[fillMode] })
    }

    return paths.length ? paths : null
}

export function getPresetShapePath(prstGeom: string, x1: number, y1: number, width: number, height: number, adjustments: { [key: string]: number } = {}) {
    const normalizeX = (x: number) => (width ? (x - x1) / width : 0.5)
    const normalizeY = (y: number) => (height ? (y - y1) / height : 0.5)
    const pointsToPath = (points: { x: number; y: number }[]) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${normalizeX(p.x)} ${normalizeY(p.y)}`).join(" ") + " Z"
    const adj = adjustments.adj ?? adjustments.adj1 ?? 50000

    switch (prstGeom) {
        case "diagStripe": {
            // ✓
            const a = adj / 100000
            const points = [
                { x: x1 + width * a, y: y1 },
                { x: x1 + width, y: y1 },
                { x: x1, y: y1 + height },
                { x: x1, y: y1 + height * a }
            ]
            path = pointsToPath(points)
            break
        }
        case "triangle":
            path = pointsToPath([
                { x: x1 + width / 2, y: y1 },
                { x: x1, y: y1 + height },
                { x: x1 + width, y: y1 + height }
            ])
            break
        case "rtTriangle":
            // should be right angle

            // const a = width / (width + height) // make it a right angle triangle
            // path = pointsToPath([
            //     { x: x1, y: y1 + height },
            //     { x: x1, y: y1 },
            //     { x: x1 + width, y: y1 + height * a }
            // ])

            path = pointsToPath([
                { x: x1, y: y1 + height },
                { x: x1, y: y1 },
                { x: x1 + width, y: y1 + height }
            ])
            break
        case "round1Rect":
            // path = pointsToPath([
            //     { x: x1 + width * 0.1, y: y1 },
            //     { x: x1 + width * 0.9, y: y1 },
            //     { x: x1 + width, y: y1 + height * 0.1 },
            //     { x: x1 + width, y: y1 + height * 0.9 },
            //     { x: x1 + width * 0.9, y: y1 + height },
            //     { x: x1 + width * 0.1, y: y1 + height },
            //     { x: x1, y: y1 + height * 0.9 },
            //     { x: x1, y: y1 + height * 0.1 }
            // ])

            const r = 0.2 // normalized radius (0..1)
            const pathPoints = [
                { x: r, y: 0 }, // start after top-left curve
                { x: 1, y: 0 }, // top-right
                { x: 1, y: 1 }, // bottom-right
                { x: 0, y: 1 }, // bottom-left
                { x: 0, y: r }, // left before curve
                { x: 0, y: 0, q: true }, // top-left control point for quadratic curve
                { x: r, y: 0 } // back to start
            ]

            // Convert to path with quadratic handling
            path =
                pathPoints
                    .map((p, i) => {
                        if (i === 0) return `M ${p.x} ${p.y}`
                        if (p.q) {
                            const prev = pathPoints[i - 1]
                            return `Q ${prev.x} ${prev.y} ${p.x} ${p.y}`
                        }
                        return `L ${p.x} ${p.y}`
                    })
                    .join(" ") + " Z"
            break
        case "diamond":
            path = pointsToPath([
                { x: x1 + width / 2, y: y1 },
                { x: x1 + width, y: y1 + height / 2 },
                { x: x1 + width / 2, y: y1 + height },
                { x: x1, y: y1 + height / 2 }
            ])
            break
        case "pentagon":
            path = pointsToPath([
                { x: x1 + width / 2, y: y1 },
                { x: x1 + width, y: y1 + 0.3771 * height },
                { x: x1 + 0.808 * width, y: y1 + height },
                { x: x1 + 0.192 * width, y: y1 + height },
                { x: x1, y: y1 + 0.3771 * height }
            ])
            break
        case "hexagon":
            path = pointsToPath([
                { x: x1 + 0.25 * width, y: y1 },
                { x: x1 + 0.75 * width, y: y1 },
                { x: x1 + width, y: y1 + height / 2 },
                { x: x1 + 0.75 * width, y: y1 + height },
                { x: x1 + 0.25 * width, y: y1 + height },
                { x: x1, y: y1 + height / 2 }
            ])
            break
        case "octagon":
            path = pointsToPath([
                { x: x1 + 0.29 * width, y: y1 },
                { x: x1 + 0.71 * width, y: y1 },
                { x: x1 + width, y: y1 + 0.29 * height },
                { x: x1 + width, y: y1 + 0.71 * height },
                { x: x1 + 0.71 * width, y: y1 + height },
                { x: x1 + 0.29 * width, y: y1 + height },
                { x: x1, y: y1 + 0.71 * height },
                { x: x1, y: y1 + 0.29 * height }
            ])
            break
        case "ellipse":
            // path = `M ${normalizeX(x1 + width / 2)} ${normalizeY(y1)}
            //         A ${normalizeX(width / 2)} ${normalizeY(height / 2)} 0 1 0 ${normalizeX(x1 + width / 2)} ${normalizeY(y1 + height)}
            //         A ${normalizeX(width / 2)} ${normalizeY(height / 2)} 0 1 0 ${normalizeX(x1 + width / 2)} ${normalizeY(y1)} Z`
            // break

            const steps = 64 // increase for smoother ellipse
            const pts: any[] = []
            for (let i = 0; i < steps; i++) {
                const theta = (i / steps) * Math.PI * 2
                const px = x1 + (0.5 + 0.5 * Math.cos(theta)) * width
                const py = y1 + (0.5 + 0.5 * Math.sin(theta)) * height
                pts.push({ x: px, y: py })
            }
            path = pointsToPath(pts) // pointsToPath will call normalizeX/normalizeY
            break
        case "flowChartProcess":
            path = pointsToPath([
                { x: x1, y: y1 },
                { x: x1 + width, y: y1 },
                { x: x1 + width, y: y1 + height },
                { x: x1, y: y1 + height }
            ])
            break
        case "roundRect": {
            const minDim = Math.min(width, height)
            const r = Math.min(minDim / 2, Math.max(0, ((adj || 16667) / 100000) * minDim))
            path = `M ${normalizeX(x1 + r)} ${normalizeY(y1)} 
                    L ${normalizeX(x1 + width - r)} ${normalizeY(y1)}
                    Q ${normalizeX(x1 + width)} ${normalizeY(y1)} ${normalizeX(x1 + width)} ${normalizeY(y1 + r)}
                    L ${normalizeX(x1 + width)} ${normalizeY(y1 + height - r)}
                    Q ${normalizeX(x1 + width)} ${normalizeY(y1 + height)} ${normalizeX(x1 + width - r)} ${normalizeY(y1 + height)}
                    L ${normalizeX(x1 + r)} ${normalizeY(y1 + height)}
                    Q ${normalizeX(x1)} ${normalizeY(y1 + height)} ${normalizeX(x1)} ${normalizeY(y1 + height - r)}
                    L ${normalizeX(x1)} ${normalizeY(y1 + r)}
                    Q ${normalizeX(x1)} ${normalizeY(y1)} ${normalizeX(x1 + r)} ${normalizeY(y1)}
                    Z`
            break
        }
        case "round2SameRect": {
            const minDim = Math.min(width, height)
            const r = Math.min(minDim / 2, Math.max(0, ((adj || 50000) / 100000) * minDim))
            path = `M ${normalizeX(x1 + r)} ${normalizeY(y1)} 
                    L ${normalizeX(x1 + width - r)} ${normalizeY(y1)}
                    Q ${normalizeX(x1 + width)} ${normalizeY(y1)} ${normalizeX(x1 + width)} ${normalizeY(y1 + r)}
                    L ${normalizeX(x1 + width)} ${normalizeY(y1 + height - r)}
                    Q ${normalizeX(x1 + width)} ${normalizeY(y1 + height)} ${normalizeX(x1 + width - r)} ${normalizeY(y1 + height)}
                    L ${normalizeX(x1 + r)} ${normalizeY(y1 + height)}
                    Q ${normalizeX(x1)} ${normalizeY(y1 + height)} ${normalizeX(x1)} ${normalizeY(y1 + height - r)}
                    L ${normalizeX(x1)} ${normalizeY(y1 + r)}
                    Q ${normalizeX(x1)} ${normalizeY(y1)} ${normalizeX(x1 + r)} ${normalizeY(y1)}
                    Z`
            break
        }
        case "parallelogram": {
            const a = (adj / 100000) * Math.min(width, height)
            path = pointsToPath([
                { x: x1 + a, y: y1 },
                { x: x1 + width, y: y1 },
                { x: x1 + width - a, y: y1 + height },
                { x: x1, y: y1 + height }
            ])
            break
        }
        case "trapezoid": {
            const a = (adj / 100000) * Math.min(width, height)
            path = pointsToPath([
                { x: x1 + a, y: y1 },
                { x: x1 + width - a, y: y1 },
                { x: x1 + width, y: y1 + height },
                { x: x1, y: y1 + height }
            ])
            break
        }
        case "bevel": {
            // Simple 3D beveled rectangle
            const b = (adj / 100000) * Math.min(width, height)
            path = `M ${normalizeX(x1 + b)} ${normalizeY(y1)}
                L ${normalizeX(x1 + width - b)} ${normalizeY(y1)}
                L ${normalizeX(x1 + width)} ${normalizeY(y1 + b)}
                L ${normalizeX(x1 + width)} ${normalizeY(y1 + height - b)}
                L ${normalizeX(x1 + width - b)} ${normalizeY(y1 + height)}
                L ${normalizeX(x1 + b)} ${normalizeY(y1 + height)}
                L ${normalizeX(x1)} ${normalizeY(y1 + height - b)}
                L ${normalizeX(x1)} ${normalizeY(y1 + b)}
                Z`
            break
        }
        case "can": {
            // Cylinder shape
            const r = width / 2
            const h = height
            path = `M ${normalizeX(x1)} ${normalizeY(y1 + h)}
                L ${normalizeX(x1)} ${normalizeY(y1 + h / 4)}
                A ${normalizeX(r)} ${normalizeY(h / 8)} 0 0 1 ${normalizeX(x1 + width)} ${normalizeY(y1 + h / 4)}
                L ${normalizeX(x1 + width)} ${normalizeY(y1 + h)}
                Z`
            break
        }
        case "bracePair": {
            // Brace with approximate cubic curves
            path = `M ${normalizeX(x1)} ${normalizeY(y1)}
                C ${normalizeX(x1 + 0.1 * width)} ${normalizeY(y1 + 0.25 * height)} 
                  ${normalizeX(x1 + 0.1 * width)} ${normalizeY(y1 + 0.75 * height)} 
                  ${normalizeX(x1)} ${normalizeY(y1 + height)}
                M ${normalizeX(x1 + width)} ${normalizeY(y1)}
                C ${normalizeX(x1 + 0.9 * width)} ${normalizeY(y1 + 0.25 * height)} 
                  ${normalizeX(x1 + 0.9 * width)} ${normalizeY(y1 + 0.75 * height)} 
                  ${normalizeX(x1 + width)} ${normalizeY(y1 + height)}`
            break
        }
        case "frame": {
            // Picture frame or rectangle with thick border
            const border = (adj / 100000) * Math.min(width, height)
            path = pointsToPath([
                { x: x1 + border, y: y1 + border },
                { x: x1 + width - border, y: y1 + border },
                { x: x1 + width - border, y: y1 + height - border },
                { x: x1 + border, y: y1 + height - border }
            ])
            break
        }
        case "pie": {
            // Pie slice
            const startAngle = 0 // could be based on adjustment
            const endAngle = Math.PI * 2 * (adj / 100000)
            const cx = x1 + width / 2
            const cy = y1 + height / 2
            const rx = width / 2
            const ry = height / 2
            const xStart = cx + rx * Math.cos(startAngle)
            const yStart = cy + ry * Math.sin(startAngle)
            const xEnd = cx + rx * Math.cos(endAngle)
            const yEnd = cy + ry * Math.sin(endAngle)
            const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

            path = `M ${normalizeX(cx)} ${normalizeY(cy)}
                L ${normalizeX(xStart)} ${normalizeY(yStart)}
                A ${normalizeX(rx)} ${normalizeY(ry)} 0 ${largeArc} 1 ${normalizeX(xEnd)} ${normalizeY(yEnd)}
                Z`
            break
        }
        case "arc": {
            // Arc shape
            const startAngle = 0
            const endAngle = Math.PI * 2 * (adj / 100000)
            const cx = x1 + width / 2
            const cy = y1 + height / 2
            const rx = width / 2
            const ry = height / 2
            const xStart = cx + rx * Math.cos(startAngle)
            const yStart = cy + ry * Math.sin(startAngle)
            const xEnd = cx + rx * Math.cos(endAngle)
            const yEnd = cy + ry * Math.sin(endAngle)
            const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

            path = `M ${normalizeX(xStart)} ${normalizeY(yStart)}
                A ${normalizeX(rx)} ${normalizeY(ry)} 0 ${largeArc} 1 ${normalizeX(xEnd)} ${normalizeY(yEnd)}`
            break
        }
        case "line":
        case "straightConnector1": {
            // Simple straight line
            path = `M ${normalizeX(x1)} ${normalizeY(y1)}
                L ${normalizeX(x1 + width)} ${normalizeY(y1 + height)}`
            break
        }
        case "connector":
        case "bentConnector2":
        case "bentConnector3":
        case "curvedConnector2":
        case "curvedConnector3": {
            // Straight or elbow connector
            path = `M ${normalizeX(x1)} ${normalizeY(y1)}
                L ${normalizeX(x1 + width)} ${normalizeY(y1)}
                L ${normalizeX(x1 + width)} ${normalizeY(y1 + height)}`
            break
        }
        case "chord": {
            // Chord is like a pie slice without the center point
            const startAngle = 0
            const endAngle = Math.PI * 2 * (adj / 100000)
            const cx = x1 + width / 2
            const cy = y1 + height / 2
            const rx = width / 2
            const ry = height / 2
            const xStart = cx + rx * Math.cos(startAngle)
            const yStart = cy + ry * Math.sin(startAngle)
            const xEnd = cx + rx * Math.cos(endAngle)
            const yEnd = cy + ry * Math.sin(endAngle)
            const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

            path = `M ${normalizeX(xStart)} ${normalizeY(yStart)}
                A ${normalizeX(rx)} ${normalizeY(ry)} 0 ${largeArc} 1 ${normalizeX(xEnd)} ${normalizeY(yEnd)}
                L ${normalizeX(xStart)} ${normalizeY(yStart)} Z`
            break
        }
        case "donut": {
            // Donut = outer ellipse minus inner ellipse
            const outerR = { rx: width / 2, ry: height / 2 }
            const innerR = { rx: width / 4, ry: height / 4 }
            const cx = x1 + width / 2
            const cy = y1 + height / 2

            path = `M ${normalizeX(cx + outerR.rx)} ${normalizeY(cy)}
                A ${normalizeX(outerR.rx)} ${normalizeY(outerR.ry)} 0 1 1 ${normalizeX(cx - outerR.rx)} ${normalizeY(cy)}
                A ${normalizeX(outerR.rx)} ${normalizeY(outerR.ry)} 0 1 1 ${normalizeX(cx + outerR.rx)} ${normalizeY(cy)}
                M ${normalizeX(cx + innerR.rx)} ${normalizeY(cy)}
                A ${normalizeX(innerR.rx)} ${normalizeY(innerR.ry)} 0 1 0 ${normalizeX(cx - innerR.rx)} ${normalizeY(cy)}
                A ${normalizeX(innerR.rx)} ${normalizeY(innerR.ry)} 0 1 0 ${normalizeX(cx + innerR.rx)} ${normalizeY(cy)}
                Z`
            break
        }
        case "blockArc": {
            // Arc with thickness
            const cx = x1 + width / 2
            const cy = y1 + height / 2
            const startAngle = 0
            const endAngle = Math.PI * (adj / 100000)
            const innerR = Math.min(width, height) / 4
            const outerR = Math.min(width, height) / 2

            const x1Outer = cx + outerR * Math.cos(startAngle)
            const y1Outer = cy + outerR * Math.sin(startAngle)
            const x2Outer = cx + outerR * Math.cos(endAngle)
            const y2Outer = cy + outerR * Math.sin(endAngle)
            const x2Inner = cx + innerR * Math.cos(endAngle)
            const y2Inner = cy + innerR * Math.sin(endAngle)
            const x1Inner = cx + innerR * Math.cos(startAngle)
            const y1Inner = cy + innerR * Math.sin(startAngle)
            const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

            path = `M ${normalizeX(x1Outer)} ${normalizeY(y1Outer)}
                A ${normalizeX(outerR)} ${normalizeY(outerR)} 0 ${largeArc} 1 ${normalizeX(x2Outer)} ${normalizeY(y2Outer)}
                L ${normalizeX(x2Inner)} ${normalizeY(y2Inner)}
                A ${normalizeX(innerR)} ${normalizeY(innerR)} 0 ${largeArc} 0 ${normalizeX(x1Inner)} ${normalizeY(y1Inner)}
                Z`
            break
        }
        case "star": {
            // 5-pointed star
            const cx = x1 + width / 2
            const cy = y1 + height / 2
            const rOuter = width / 2
            const rInner = rOuter * 0.5
            const pts: any[] = []
            for (let i = 0; i < 10; i++) {
                const r = i % 2 === 0 ? rOuter : rInner
                const angle = (Math.PI / 5) * i - Math.PI / 2
                pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
            }
            path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${normalizeX(p.x)} ${normalizeY(p.y)}`).join(" ") + " Z"
            break
        }
        case "banner": {
            const hOffset = (adj / 100000) * height
            return pointsToPath([
                { x: x1, y: y1 + hOffset },
                { x: x1 + width, y: y1 },
                { x: x1 + width, y: y1 + height - hOffset },
                { x: x1, y: y1 + height }
            ])
        }
        case "callout": {
            const pointerW = width * 0.15
            const pointerH = height * 0.2
            return pointsToPath([
                { x: x1, y: y1 },
                { x: x1 + width - pointerW, y: y1 },
                { x: x1 + width, y: y1 + pointerH },
                { x: x1 + width, y: y1 + height },
                { x: x1, y: y1 + height }
            ])
        }
        default:
            return pointsToPath([
                { x: x1, y: y1 },
                { x: x1 + width, y: y1 },
                { x: x1 + width, y: y1 + height },
                { x: x1, y: y1 + height }
            ])
    }
}
// scale an absolute svg path (M, L, C, Q, A, Z commands) from its own coordinate space to pixels
export function scalePath(d: string, sx: number, sy: number) {
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || []
    const fmt = (n: number) => String(Number(n.toFixed(3)))

    let out = ""
    let command = ""
    let index = 0 // parameter index within the current command
    for (const token of tokens) {
        if (/[a-zA-Z]/.test(token)) {
            command = token.toUpperCase()
            index = 0
            out += command + " "
            continue
        }

        const n = Number(token)
        if (command === "A") {
            // rx ry rotation large-arc sweep x y
            const i = index % 7
            out += (i === 0 || i === 5 ? fmt(n * sx) : i === 1 || i === 6 ? fmt(n * sy) : token) + " "
        } else {
            out += fmt(index % 2 === 0 ? n * sx : n * sy) + " "
        }
        index++
    }

    return out.trim()
}

// path list from <a:custGeom><a:pathLst>, each <a:path> has its own coordinate space (w/h)
export function getCustomShapePath(pathList: any[], fallbackSize: { w: number; h: number }): { paths: { d: string; noFill?: boolean; noStroke?: boolean }[]; vbWidth: number; vbHeight: number } | null {
    const pathNodes = pathList.filter((node) => node?.["a:path"])
    if (!pathNodes.length) return null

    const firstAttrs = pathNodes[0][":@"] || {}
    const boxWidth = parseFloat(firstAttrs.w) || fallbackSize.w || 1
    const boxHeight = parseFloat(firstAttrs.h) || fallbackSize.h || 1
    const aspect = boxWidth / boxHeight
    let vbWidth = 1
    let vbHeight = 1
    if (aspect >= 1) {
        vbWidth = 1
        vbHeight = 1 / aspect
    } else {
        vbWidth = aspect
        vbHeight = 1
    }

    const paths: { d: string; noFill?: boolean; noStroke?: boolean }[] = []

    pathNodes.forEach((pathNode) => {
        const pathAttrs = pathNode[":@"] || {}
        // path coordinates are in EMU when no size is defined
        const pathGridW = parseFloat(pathAttrs.w) || parseFloat(firstAttrs.w) || fallbackSize.w * 9525 || 1
        const pathGridH = parseFloat(pathAttrs.h) || parseFloat(firstAttrs.h) || fallbackSize.h * 9525 || 1

        const scaleX = vbWidth / pathGridW
        const scaleY = vbHeight / pathGridH
        const fmt = (n: number) => Number(n.toFixed(5))
        const point = (x: number, y: number) => `${fmt(x * scaleX)} ${fmt(y * scaleY)}`
        const getPoints = (cmd: any[]) =>
            (Array.isArray(cmd) ? cmd : [])
                .map((pt) => pt?.[":@"])
                .filter(Boolean)
                .map((pt) => ({ x: parseFloat(pt.x) || 0, y: parseFloat(pt.y) || 0 }))

        // current point (in path units), needed for arcs
        let current = { x: 0, y: 0 }
        let start = { x: 0, y: 0 }
        let d = ""

        for (const cmdNode of pathNode["a:path"] || []) {
            const key = Object.keys(cmdNode || {}).find((k) => k !== ":@")
            if (!key) continue
            const cmd = cmdNode[key]

            if (key === "a:moveTo") {
                const [pt] = getPoints(cmd)
                if (!pt) continue
                current = start = pt
                d += `M ${point(pt.x, pt.y)} `
            } else if (key === "a:lnTo") {
                const [pt] = getPoints(cmd)
                if (!pt) continue
                current = pt
                d += `L ${point(pt.x, pt.y)} `
            } else if (key === "a:quadBezTo") {
                const pts = getPoints(cmd)
                if (pts.length < 2) continue
                current = pts[1]
                d += `Q ${point(pts[0].x, pts[0].y)} ${point(pts[1].x, pts[1].y)} `
            } else if (key === "a:cubicBezTo") {
                const pts = getPoints(cmd)
                if (pts.length < 3) continue
                current = pts[2]
                d += `C ${point(pts[0].x, pts[0].y)} ${point(pts[1].x, pts[1].y)} ${point(pts[2].x, pts[2].y)} `
            } else if (key === "a:arcTo") {
                const attrs = cmdNode[":@"] || {}
                const wR = parseFloat(attrs.wR) || 0
                const hR = parseFloat(attrs.hR) || 0
                const swAng = parseFloat(attrs.swAng) || 0
                if (!wR || !hR || !swAng) continue

                getArcSegments(current, wR, hR, parseFloat(attrs.stAng) || 0, swAng).forEach((seg) => {
                    d += `A ${fmt(wR * scaleX)} ${fmt(hR * scaleY)} 0 0 ${seg.sweep} ${point(seg.x, seg.y)} `
                    current = { x: seg.x, y: seg.y }
                })
            } else if (key === "a:close") {
                current = start
                d += "Z "
            }
        }

        if (d.trim()) paths.push({ d: d.trim(), noFill: pathAttrs.fill === "none", noStroke: pathAttrs.stroke === "0" || pathAttrs.stroke === "false" })
    })

    return { paths, vbWidth, vbHeight }
}
