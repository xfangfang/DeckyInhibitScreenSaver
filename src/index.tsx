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

  let SettingDef = {
    battery_idle: {
      field: 1,
      wireType: 5
    },
    ac_idle: {
      field: 2,
      wireType: 5
    },
    battery_suspend: {
      field: 3,
      wireType: 5
    },
    ac_suspend: {
      field: 4,
      wireType: 5
    },
  }

  const _updateSettings = async (data: string) => {
    await SteamClient.System.UpdateSettings(window.btoa(data))
  }
  let updateIdleSetting = _updateSettings;
  let updateSuspendSetting = _updateSettings;

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

  // SteamClient023 does not have `RegisterForOnSuspendRequest`
  let suspendHandle: any = null
  suspendHandle =
    SteamClient.System.RegisterForOnSuspendRequest && 
    SteamClient.System.RegisterForOnSuspendRequest(clearSuspendTimeout);
  if (!suspendHandle) {
    suspendHandle = SteamClient.User.RegisterForPrepareForSystemSuspendProgress(clearSuspendTimeout);

    // SteamClient023 using new suspend settings
    SettingDef.battery_suspend = {
      field: 24003,
      wireType: 0
    }
    SettingDef.ac_suspend = {
      field: 24004,
      wireType: 0
    }
    updateSuspendSetting = async (data: string) => {
      await SteamClient.Settings.SetSetting(window.btoa(data))
    };
  }

  /**
   * Protobuf setting generation
   * @param field 1:battery_idle; 2:ac_idle; 3/24003:battery_suspend; 4/24004:ac_suspend
   * @param value 0 for disable (seconds)
   * @param wireType 0 for int32, 5 for float
   * @returns settings in binary string
   */
  function genSettings(field: any, value: number) {
    const buf = [];
    
    let key = (field.field << 3) | field.wireType;
    do {
      let b = key & 0x7F;
      key >>>= 7;
      if (key) b |= 0x80;
      buf.push(b);
    } while (key);

    if (field.wireType === 0) {
      do {
        let b = value & 0x7F;
        value >>>= 7;
        if (value) b |= 0x80;
        buf.push(b);
      } while (value);
      return String.fromCharCode(...buf);
    } else if (field.wireType === 5) {
      const valueBytes = new Uint8Array(new Float32Array([value]).buffer);
      return String.fromCharCode(...buf, ...valueBytes);
    } else {
      throw new Error('Unsupported wire type');
    }
  }

  async function updateSetting(battery_idle: number, ac_idle: number, battery_suspend: number, ac_suspend: number) {
    let _battery_idle = genSettings(SettingDef.battery_idle, battery_idle);
    let _ac_idle = genSettings(SettingDef.ac_idle, ac_idle);
    let _battery_suspend = genSettings(SettingDef.battery_suspend, battery_suspend);
    let _ac_suspend = genSettings(SettingDef.ac_suspend, ac_suspend);
    await updateIdleSetting(_battery_idle+_ac_idle);
    await updateSuspendSetting(_battery_suspend+_ac_suspend);
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
        await updateSetting(0, 0, 0, 0);
      } else if (e.type == 'UnInhibit') {
        notify(t("ScreenSaver"), t("UnInhibit"))
        await updateSetting(300, 300, 600, 600);
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
        await updateSetting(300, 300, 600, 600);
      }, 0);
    },
  };
});
