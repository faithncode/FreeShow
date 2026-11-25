<script lang="ts">
    import { onMount } from "svelte"
    import { Main } from "../../../../types/IPC/Main"
    import { requestMain } from "../../../IPC/main"
    import { special } from "../../../stores"
    import T from "../../helpers/T.svelte"
    import Title from "../../input/Title.svelte"
    import MaterialDropdown from "../../inputs/MaterialDropdown.svelte"
    import MaterialToggleSwitch from "../../inputs/MaterialToggleSwitch.svelte"

    let devices: any[] = []
    function requestDevices() {
        // only keyboard devices can be used as a numpad
        requestMain(Main.GET_HID_DEVICES, undefined, (data) => (devices = (data || []).filter((a) => a.rawInput)))
    }

    onMount(() => {
        if ($special.numpad?.enabled) requestDevices()
    })

    $: numpad = $special.numpad || {}

    function update(values: any) {
        special.update((a) => ({ ...a, numpad: { ...a.numpad, ...values } }))
    }

    function toggle(enabled: boolean) {
        update({ enabled })
        if (enabled) requestDevices()
    }

    const deviceName = (d: any) => `${d.product || d.manufacturer || "HID Device"} (${hex(d.vendorId)}:${hex(d.productId)})`
    const hex = (value: number) => (value || 0).toString(16).padStart(4, "0")
</script>

<Title label="hid.numpad" icon="keyboard" />

<MaterialToggleSwitch label="hid.numpad_enable" checked={numpad.enabled} defaultValue={false} on:change={(e) => toggle(e.detail)} />

{#if numpad.enabled}
    <MaterialDropdown label="settings.device" value={numpad.device || ""} options={devices.map((d) => ({ value: d.path, label: deviceName(d) }))} on:change={(e) => update({ device: e.detail })} />

    <p style="font-size: 0.7em;opacity: 0.8;white-space: normal;padding: 10px 0;"><T id="hid.numpad_tip" /></p>
{/if}
