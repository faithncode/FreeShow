<script lang="ts">
    import { onDestroy } from "svelte"
    import { fly, scale } from "svelte/transition"
    import { singerAlert } from "../../stores"

    let alert: { stanza: string; key?: string; timestamp: number; until: number } | null = null
    let remainingSec = 7
    let timer: NodeJS.Timeout | null = null
    let interval: NodeJS.Timeout | null = null

    // Subscribe directly to store changes — NEVER in a reactive $: block,
    // to prevent timer re-assignment and premature cancellation.
    const unsubscribe = singerAlert.subscribe((val) => {
        if (interval) clearInterval(interval)
        if (timer) clearTimeout(timer)
        interval = null
        timer = null

        alert = val
        if (!val) {
            remainingSec = 7
            return
        }

        remainingSec = 7

        interval = setInterval(() => {
            remainingSec -= 1
            if (remainingSec <= 0) {
                close()
            }
        }, 1000)

        timer = setTimeout(() => {
            close()
        }, 7000)
    })

    function close() {
        if (interval) clearInterval(interval)
        if (timer) clearTimeout(timer)
        interval = null
        timer = null
        alert = null
        singerAlert.set(null)
    }

    onDestroy(() => {
        unsubscribe()
        if (interval) clearInterval(interval)
        if (timer) clearTimeout(timer)
    })

    $: displayKey = (alert?.key || alert?.stanza || "").toUpperCase()
</script>

{#if alert}
    <div
        class="singer-alert-card"
        in:fly={{ y: -30, x: 20, duration: 250 }}
        out:scale={{ duration: 180, start: 0.95 }}
        role="alert"
    >
        <!-- Top header row -->
        <div class="alert-top">
            <div class="beacon-wrap">
                <span class="beacon-dot"></span>
                <span class="beacon-ring"></span>
            </div>
            <span class="alert-tag">SINGER REQUEST</span>
            <span class="time-badge">{remainingSec}s</span>
            <button class="close-btn" on:click={close} aria-label="Dismiss alert">✕</button>
        </div>

        <!-- Main content row: shortcut key only -->
        <div class="alert-content">
            <div class="icon-wrap">
                <span class="mic-icon">🎤</span>
            </div>
            <div class="text-wrap">
                <div class="heading-row">
                    <span class="key-prefix">KEY:</span>
                    <span class="key-name">{displayKey}</span>
                </div>
            </div>
        </div>

        <!-- Animated countdown progress bar -->
        <div class="countdown-track">
            <div
                class="countdown-fill"
                style="animation-duration: 7s;"
            ></div>
        </div>
    </div>
{/if}

<style>
    .singer-alert-card {
        position: fixed;
        top: 18px;
        right: 22px;
        z-index: 999999;
        width: 220px;
        background: linear-gradient(135deg, rgba(24, 20, 14, 0.97) 0%, rgba(14, 14, 16, 0.98) 100%);
        border: 2px solid #ffd700;
        border-radius: 12px;
        padding: 9px 12px 8px;
        box-shadow:
            0 12px 36px rgba(0, 0, 0, 0.75),
            0 0 24px rgba(255, 215, 0, 0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.15);
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        user-select: none;
        overflow: hidden;
        backdrop-filter: blur(10px);
        animation: glowPulse 2s infinite alternate ease-in-out;
    }

    @keyframes glowPulse {
        from {
            border-color: #ffd700;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 18px rgba(255, 215, 0, 0.3);
        }
        to {
            border-color: #ffea75;
            box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 30px rgba(255, 215, 0, 0.55);
        }
    }

    /* ── Top Header Row ── */
    .alert-top {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
    }
    .beacon-wrap {
        position: relative;
        width: 8px;
        height: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .beacon-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ff4d4d;
        box-shadow: 0 0 6px #ff4d4d;
    }
    .beacon-ring {
        position: absolute;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1.5px solid #ff4d4d;
        opacity: 0.8;
        animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;
    }
    @keyframes ping {
        0% { transform: scale(0.6); opacity: 1; }
        100% { transform: scale(1.6); opacity: 0; }
    }
    .alert-tag {
        font-size: 9px;
        font-weight: 900;
        letter-spacing: 1.1px;
        color: #ffd700;
        text-transform: uppercase;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .time-badge {
        font-size: 10px;
        font-weight: 800;
        background: rgba(255, 215, 0, 0.18);
        color: #ffd700;
        border: 1px solid rgba(255, 215, 0, 0.4);
        padding: 1px 5px;
        border-radius: 8px;
        letter-spacing: 0.3px;
        flex-shrink: 0;
    }
    .close-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.6);
        width: 18px;
        height: 18px;
        border-radius: 5px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        transition: background 0.12s, color 0.12s;
        flex-shrink: 0;
        padding: 0;
    }
    .close-btn:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
    }

    /* ── Content ── */
    .alert-content {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
    }
    .icon-wrap {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(255, 215, 0, 0.2) 0%, rgba(255, 180, 0, 0.08) 100%);
        border: 1.5px solid rgba(255, 215, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 0 10px rgba(255, 215, 0, 0.2);
    }
    .mic-icon {
        font-size: 16px;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }
    .text-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        overflow: hidden;
    }
    .heading-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .key-prefix {
        font-size: 11px;
        font-weight: 800;
        color: rgba(255, 255, 255, 0.55);
        letter-spacing: 1px;
    }
    .key-name {
        font-size: 22px;
        font-weight: 900;
        color: #ffd700;
        letter-spacing: 0.5px;
        text-shadow: 0 0 12px rgba(255, 215, 0, 0.6);
        line-height: 1;
    }

    /* ── Progress bar ── */
    .countdown-track {
        width: 100%;
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
    }
    .countdown-fill {
        height: 100%;
        background: linear-gradient(90deg, #ffd700 0%, #ff8c00 100%);
        border-radius: 2px;
        animation: drainBar linear forwards;
    }
    @keyframes drainBar {
        from { width: 100%; }
        to { width: 0%; }
    }
</style>

