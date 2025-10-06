import {
  definePlugin,
  ToggleField,
  PanelSection,
  PanelSectionRow,
  ServerAPI,
  findModuleChild,
  Module,
  staticClasses,
} from "decky-frontend-lib";
import { VFC } from "react";
import { useState } from 'react'
import { GiNightSleep } from "react-icons/gi";
import i18n from './i18n'

let backendRunning = false;
let showNotify     = false;
let language = i18n.getCurrentLanguage()
const t = i18n.useTranslations(language)

const findModule = (property: string) => {
  return findModuleChild((m: Module) => {
    if (typeof m !== "object") return undefined;
    for (let prop in m) {
      try {
        if (m[prop][property]) {
          return m[prop];
        }
      } catch (e) {
        return undefined;
      }
    }
  });
}
const SystemSleep = findModule("InitiateSleep")

const RUN_ON_LOGIN = "run_on_login"
const SHOW_NOTIFY  = "show_notify"

const Content: VFC<{ serverApi: ServerAPI }> = ({serverApi}) => {
  const [running, setRunning] = useState<boolean>(backendRunning);
  const [notify, setNotify] = useState<boolean>(showNotify);

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
    <PanelSection title={t('Settings')}>
      <PanelSectionRow>
      <ToggleField
          label={t('Background Monitor')}
          onChange={async (checked) => {
            setRunning(checked)
            backendRunning = checked
            await setSettings(RUN_ON_LOGIN, checked)
            checked ? await startBackend() : await stopBackend() 
          }}
          checked={running}
          />
      <label>{t('bg_tip')}</label>
      </PanelSectionRow>
      <PanelSectionRow>
      <ToggleField
          label={t('Show Notify')}
          onChange={async (checked) => {
            setNotify(checked)
            showNotify = checked
            await setSettings(SHOW_NOTIFY, checked)
          }}
          checked={notify}
          />
      <label>{t('notify_tip')}</label>
      </PanelSectionRow>
    </PanelSection>
  );
};

export default definePlugin((serverApi: ServerAPI) => {
  let forced_suspend:NodeJS.Timeout;
  let forced_suspend_tip:NodeJS.Timeout;
  let input_changed:boolean = true;

  const clearSuspendTimeout = () => {
    clearTimeout(forced_suspend)
    clearTimeout(forced_suspend_tip)
  }

  // SteamClient version 1759461205 does not have `RegisterForControllerStateChanges`
  let controllerHandle: any = null;
  controllerHandle =
    SteamClient.Input.RegisterForControllerStateChanges &&
    SteamClient.Input.RegisterForControllerStateChanges (
    (changes: any[]) => {
      if (input_changed) return
      for (const inputs of changes) {
        const { ulButtons, sLeftStickX, sLeftStickY, sRightStickX, sRightStickY, } = inputs;
        if (ulButtons != 0) { input_changed = true; }
        if (Math.abs(sLeftStickX) > 5000 || Math.abs(sLeftStickY) > 5000 ||
            Math.abs(sRightStickX) > 5000 || Math.abs(sRightStickY) > 5000) {
              input_changed = true;
        }
      }
      if (input_changed) {
        clearSuspendTimeout()
      }
    }
  );
  if (!controllerHandle) {
    controllerHandle = SteamClient.Input.RegisterForControllerInputMessages(
      () => {
        if (input_changed) return
        input_changed = true
        clearSuspendTimeout()
      }
    );
  }

  // SteamClient version 1759461205 does not have `RegisterForOnSuspendRequest`
  let suspendHandle: any = null
  suspendHandle =
    SteamClient.System.RegisterForOnSuspendRequest && 
    SteamClient.System.RegisterForOnSuspendRequest(clearSuspendTimeout);
  if (!suspendHandle) {
    suspendHandle = SteamClient.User.RegisterForPrepareForSystemSuspendProgress(clearSuspendTimeout);
  }

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

  let timeout:NodeJS.Timeout;
  const notify = (title: string, body: string) => {
    if (!showNotify) return
    clearTimeout(timeout)
    timeout = setTimeout(()=>{
      serverApi.toaster.toast({
        title: title,
        body: body,
        duration: 1_500,
        sound: 1,
        icon: <GiNightSleep />,
      });
    }, 2000)
  }

  let interval = setInterval(async () => {
    let data = await getEvent();
    if(!data.success) return;
    let event = data.result;
    for (let e of event) {
      if (e.type == 'Inhibit') {
        notify(t("ScreenSaver"), t("Inhibit"))
        clearSuspendTimeout()
        await updateSetting(genSettings(1, 0)+genSettings(2, 0)+genSettings(3, 0)+genSettings(4, 0));
      } else if (e.type == 'UnInhibit') {
        notify(t("ScreenSaver"), t("UnInhibit"))
        await updateSetting(genSettings(1, 300)+genSettings(2, 300)+genSettings(3, 600)+genSettings(4, 600));
        // 1. there is no operation for a long period of time (like 15 minutes)
        // 2. the application automatically uninhibit screensaver
        // 3. there is no operation after uninhibit screensaver
        // When these three things happen in sequence, the system will continue to not suspend, even if the time we set has already been reached.
        // In this case, we use a custom timer to suspend system as the workaround.
        clearSuspendTimeout()
        input_changed = false
        forced_suspend = setTimeout(() => {
          forced_suspend_tip = setTimeout(()=>{
            SystemSleep.InitiateSleep()
          }, 5_000)
          serverApi.toaster.toast({
            title: t("suspend_tip_title"),
            body: t("suspend_tip_body"),
            critical: true,
            duration: 5_000,
            playSound: false,
            icon: <GiNightSleep />,
          });
        }, 450_000)
      }
    }
  }, 1000)

  setTimeout(async () => {
    let notify = await getSettings(SHOW_NOTIFY, false)
    if (notify.success) {
      showNotify = notify.result
    }

    let run = await getSettings(RUN_ON_LOGIN, true)
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
      if (controllerHandle) controllerHandle.unregister()
      if (suspendHandle) suspendHandle.unregister()
      setTimeout(async () => {
        await updateSetting(genSettings(1, 300)+genSettings(2, 300)+genSettings(3, 600)+genSettings(4, 600));
      }, 0);
    },
  };
});
