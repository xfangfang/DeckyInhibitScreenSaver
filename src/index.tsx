import {
  definePlugin,
  ToggleField,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  staticClasses,
} from "decky-frontend-lib";
import { VFC } from "react";
import { useState } from 'react'
import { GiNightSleep } from "react-icons/gi";

let backendRunning = false;

const Content: VFC<{ serverApi: ServerAPI }> = ({serverApi}) => {
  const [running, setRunning] = useState<boolean>(backendRunning);

  const startBackend = async () => {
    return await serverApi.callPluginMethod<any, any>("start_backend", {});
  }

  const stopBackend = async () => {
    return await serverApi.callPluginMethod<any, any>("stop_backend", {});
  }

  const setSettings = async (key: string, value: any) => {
    return await serverApi.callPluginMethod<any, any>("set_settings", {key: key, value: value});
  }
  
  return (
    <PanelSection title="Settings">
      <PanelSectionRow>
      <ToggleField
          label='Start'
          onChange={async (checked) => {
            setRunning(checked)
            backendRunning = checked
            await setSettings("run_on_login", checked)
            checked ? await startBackend() : await stopBackend() 
          }}
          checked={running}
          />
      </PanelSectionRow>
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  function onSettingsChanges(buffer: ArrayBuffer) {
    let view        = new DataView(buffer);
    let ac_idle         = view.getFloat32(6, true);
    let battery_idle    = view.getFloat32(1, true);
    let ac_suspend      = view.getFloat32(16, true);
    let battery_suspend = view.getFloat32(11,true)
    console.debug(`${ac_idle}, ${battery_idle}, ${ac_suspend}, ${battery_suspend}`)
  };
  let handle = SteamClient.System.RegisterForSettingsChanges(onSettingsChanges);

  /**
   * Protobuf setting generation
   * @param index 1:battery_idle; 2:ac_idle; 3:battery_suspend; 4:ac_suspend
   * @param data 0 for disable (seconds)
   * @returns settings in binary string
   */
  function genSettings(index: number, data: number) {
    let buffer = new ArrayBuffer(5);
    let view = new DataView(buffer);
    view.setUint8(0, index << 3 | 5);
    view.setFloat32(1, data, true);
    let binary = '';
    let bytes = new Uint8Array(buffer);
    let len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
  }

  const updateSetting = async (data: string) => {
    await SteamClient.System.UpdateSettings(window.btoa(data))
  }
  
  const getEvent = async () => {
    return await serverApi.callPluginMethod<any, any>("get_event", {});
  }

  const getSettings = async (key: string, defaults: any) => {
    return await serverApi.callPluginMethod<any, any>("get_settings", {key: key, defaults: defaults});
  }

  const startBackend = async () => {
    return await serverApi.callPluginMethod<any, any>("start_backend", {});
  }

  const stopBackend = async () => {
    return await serverApi.callPluginMethod<any, any>("stop_backend", {});
  }

  let interval = setInterval(async () => {
    let data = await getEvent();
    if(!data.result) return;
    console.debug(data)
    let event = data.result;
    for (let e of event) {
      if (e.type == 'Inhibit') {
        await updateSetting(genSettings(1, 0)+genSettings(2, 0)+genSettings(3, 0)+genSettings(4, 0));
      } else if (e.type == 'UnInhibit') {
        await updateSetting(genSettings(1, 300)+genSettings(2, 300)+genSettings(3, 600)+genSettings(4, 600));
      }
    }
  }, 1000)

  setTimeout(async () => {
    let run = await getSettings("run_on_login", true)
    console.debug("run_on_login", run)
    if (run.success && run.result) {
      backendRunning = true
      await startBackend()
    }
  }, 0);

  return {
    title: <div className={staticClasses.Title}>Suspend Manager</div>,
    content: <Content serverApi={serverApi} />,
    icon: <GiNightSleep />,
    onDismount() {
      if (interval) clearInterval(interval);
      if (handle) handle.unregister();
      setTimeout(async () => {
        await stopBackend()
        await updateSetting(genSettings(1, 300)+genSettings(2, 300)+genSettings(3, 600)+genSettings(4, 600));
      }, 0);
    },
  };
});
