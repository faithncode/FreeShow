<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import { Main } from "../../../../types/IPC/Main"
    import { requestMain } from "../../../IPC/main"
    import { special } from "../../../stores"
    import { detectNumpad, stopNumpadDetection } from "../../actions/hid"
    import { reconnectNumpad } from "../../actions/numpad"
    import T from "../../helpers/T.svelte"
    import Title from "../../input/Title.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import MaterialDropdown from "../../inputs/MaterialDropdown.svelte"
    import MaterialToggleSwitch from "../../inputs/MaterialToggleSwitch.svelte"

    let devices: any[] = []
    let loaded = false
    let detecting = false

    function requestDevices(callback?: () => void) {
        // only keyboard devices can be used as a numpad
        requestMain(Main.GET_HID_DEVICES, undefined, (data) => {
            devices = (data || []).filter((a) => a.rawInput)
            loaded = true
            reconnectNumpad(devices)
            callback?.()
        })
    }

    onMount(() => {
        if ($special.numpad?.enabled) requestDevices()
    })
    onDestroy(stopNumpadDetection)

    $: numpad = $special.numpad || {}
    $: missing = loaded && numpad.device && !devices.some((d) => d.path === numpad.device)

    function update(values: any) {
        special.update((a) => ({ ...a, numpad: { ...a.numpad, ...values } }))
    }

    function toggle(enabled: boolean) {
        update({ enabled })
        if (enabled) requestDevices()
        else cancelDetection()
    }

    // some numpads have names like "2.4G Receiver", so pressing a key is the safest way to pick one
    function toggleDetection() {
        if (detecting) return cancelDetection()

        detecting = true
        // list again, in case it was just plugged in
        requestDevices(() => {
            if (!detecting) return

            detectNumpad(
                devices.map((d) => d.path),
                (device) => {
                    detecting = false
                    update({ device })
                }
            )
        })
    }

    function cancelDetection() {
        detecting = false
        stopNumpadDetection()
    }

    const deviceName = (d: any) => `${d.product || d.manufacturer || "HID Device"} (${hex(d.vendorId)}:${hex(d.productId)})`
    const hex = (value: number) => (value || 0).toString(16).padStart(4, "0")
</script>

<Title label="hid.numpad" icon="keyboard" />

<MaterialToggleSwitch label="hid.numpad_enable" checked={numpad.enabled} defaultValue={false} on:change={(e) => toggle(e.detail)} />

{#if numpad.enabled}
    <MaterialDropdown label="settings.device" value={numpad.device || ""} options={devices.map((d) => ({ value: d.path, label: deviceName(d) }))} on:change={(e) => update({ device: e.detail })} />

    <MaterialButton icon="keyboard" on:click={toggleDetection}>
        <T id={detecting ? "hid.numpad_detecting" : "hid.numpad_detect"} />
    </MaterialButton>

    {#if missing && !detecting}
        <p class="note"><T id="hid.numpad_missing" /></p>
    {/if}

    <p class="note"><T id="hid.numpad_tip" /></p>
{/if}

<style>
    .note {
        font-size: 0.7em;
        opacity: 0.8;
        white-space: normal;
        padding: 10px 0;
    }
</style>
