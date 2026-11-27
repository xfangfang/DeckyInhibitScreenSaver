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
import i18n from './i18n'

let backendRunning = false;
let showNotify     = false;
let language = i18n.getCurrentLanguage()
const t = i18n.useTranslations(language)

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

  let previous_inhibit_state: boolean | null = null

  const callPluginBackend = async (method: string, args: any = {}) => {
    const res = await serverApi.callPluginMethod<any, any>(method, args)
    return res.success ? res.result : null
  }

  const getSettings = async (key: string, defaults: any) => {
    return await serverApi.callPluginMethod<any, any>("get_settings", {key: key, defaults: defaults});
  }

  const startBackend = async () => {
    return await serverApi.callPluginMethod<any, any>("start_backend", {});
  }

  const showToast = (body: string) => {
    serverApi.toaster.toast({
      title: t("ScreenSaver"),
      body: body,
      duration: 1_500,
      sound: 1,
      icon: <GiNightSleep />,
    });
  }

  let release_notification_timer:NodeJS.Timeout;
  const notifyInhibitState = (inhibited: boolean) => {
    if (!showNotify) return
    clearTimeout(release_notification_timer)
    if (inhibited) showToast(t("Inhibit"))
    else release_notification_timer = setTimeout(() => showToast(t("UnInhibit")), 2_000)
  }

  let inhibit_poll_interval = setInterval(async () => {
    const currently_inhibited = await callPluginBackend("is_inhibited") === true
    if (previous_inhibit_state !== null && currently_inhibited !== previous_inhibit_state) {
      notifyInhibitState(currently_inhibited)
    }
    previous_inhibit_state = currently_inhibited
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
      if (inhibit_poll_interval) clearInterval(inhibit_poll_interval);
    },
  };
});
