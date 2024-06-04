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

let backendRunning = true;

const Content: VFC<{ serverApi: ServerAPI }> = ({serverApi}) => {
  const [running, setRunning] = useState<boolean>(backendRunning);
  return (
    <PanelSection title="Settings">
      <PanelSectionRow>
        <ToggleField
          label='Start'
          onChange={async (checked) => {
            setRunning(checked)
            DeckyPluginLoader.toaster.toast({
              title: "视频播放检测",
              body: checked ? "已开启": "已关闭",
              icon: <GiNightSleep />,
            });
            await serverApi.callPluginMethod<any, any>(checked ? "start_backend" : "stop_backend", {});
          }}
          checked={running}
          />
      </PanelSectionRow>
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  console.debug("on Start");
  let requestChanging = 0;
  function onSettingsChanges(buffer: ArrayBuffer) {
    let view        = new DataView(buffer);
    let ac_idle         = view.getFloat32(6, true);
    let battery_idle    = view.getFloat32(1, true);
    let ac_suspend      = view.getFloat32(16, true);
    let battery_suspend = view.getFloat32(11,true)
    console.debug(`${ac_idle}, ${battery_idle}, ${ac_suspend}, ${battery_suspend}`)
    if (requestChanging <= 0 && backendRunning) {
      // 用户手动修改
      // 1. 停止后端运行
      backendRunning = false;
      setTimeout(async () => {
        await serverApi.callPluginMethod<any, any>("stop_backend", {});
      }, 0);

      // 2. 弹出提示
      DeckyPluginLoader.toaster.toast({
        title: "视频播放检测",
        body: "已关闭",
        icon: <GiNightSleep />,
      });
      requestChanging = 0;
    } else {
      requestChanging--;
    }
    
  };

  // 注册回调函数时会触发一次 onSettingsChanges
  requestChanging = 1;
  let handle = SteamClient.System.RegisterForSettingsChanges(onSettingsChanges);

  // index:
  // 1: battery_idle
  // 2: ac_idle
  // 3: battery_suspend
  // 4: ac_suspend
  //
  // data:
  // 0 for disable (seconds)
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

  const getEvent = async () => {
    return await serverApi.callPluginMethod<any, any>("get_event", {});
  }

  const updateSetting = async (data: string) => {
    await SteamClient.System.UpdateSettings(window.btoa(data))
  }

  let interval = setInterval(async () => {
    let data = await getEvent();
    if(!data.result) return;
    console.debug(data)
    let event = data.result;
    for (let e of event) {
      if (e.type == 'Inhibit') {
        requestChanging++;
        await updateSetting(genSettings(1, 0)+genSettings(2, 0)+genSettings(3, 0)+genSettings(4, 0));
      } else if (e.type == 'UnInhibit') {
        // todo: restore
        requestChanging++;
        await updateSetting(genSettings(1, 600)+genSettings(2, 600)+genSettings(3, 600)+genSettings(4, 600));
      } if (e.type == 'brightness') {
        await SteamClient.System.Display.SetBrightness(e.value / 100);
      } else if (e.type == 'idle') {
        requestChanging++;
        await updateSetting(genSettings(e.idle_type, e.value));
      }
    }
  }, 1000)

  setTimeout(async () => {
    await serverApi.callPluginMethod<any, any>("start_backend", {});
  }, 0);

  return {
    title: <div className={staticClasses.Title}>Suspend Manager</div>,
    content: <Content serverApi={serverApi} />,
    icon: <GiNightSleep />,
    onDismount() {
      console.debug("on Dismount");
      clearInterval(interval);
      if (handle) handle.unregister();
    },
  };
});
