import os
import shutil

import decky_plugin
import subprocess
from settings import SettingsManager

def import_third_party_lib():
    import sys
    from pathlib import Path
    plugin_dir = Path(__file__).parent.resolve()
    decky_plugin.logger.info(f'plugin dir: {plugin_dir}')
    sys.path.insert(0, str(plugin_dir))
    sys.path.insert(0, str(plugin_dir.joinpath("lib")))

def setup_environ_vars():
    runtime_dir = f'/run/user/{os.getuid()}'
    os.environ['XDG_RUNTIME_DIR'] = runtime_dir
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path={runtime_dir}/bus'

import_third_party_lib()
setup_environ_vars()
settings_dir = decky_plugin.DECKY_PLUGIN_SETTINGS_DIR
settings = SettingsManager(name="settings", settings_directory=settings_dir)

from dbus_next.aio import MessageBus
from dbus_next import Message, MessageType
from dbus_next.service import ServiceInterface, method
from dbus_next.constants import RequestNameReply
bus = None

owns_screensaver_name = False


async def dbus_call(destination, path, interface, member, signature='', body=None):
    if bus is None:
        return None
    try:
        reply = await bus.call(Message(
            destination=destination,
            path=path,
            interface=interface,
            member=member,
            signature=signature,
            body=body or []))
        if reply.message_type != MessageType.ERROR and reply.body:
            return reply.body[0]
    except Exception as e:
        decky_plugin.logger.info(f'{interface}.{member} failed: {e}')
    return None


async def forward_to_screensaver_service(member, signature, body):
    if owns_screensaver_name:
        return None
    return await dbus_call('org.freedesktop.ScreenSaver', '/ScreenSaver',
                           'org.freedesktop.ScreenSaver', member, signature, body)

PORTAL_INTERFACE_NAME = 'org.freedesktop.impl.portal.Inhibit'
PORTAL_DBUS_NAME = 'org.freedesktop.impl.portal.inhibitdecky'
PORTAL_INSTALL_DIR = '~/.local/share/decky-portals'
PORTAL_DROPIN_DIR = '~/.config/systemd/user/xdg-desktop-portal.service.d'
PORTAL_BACKEND_FILE_NAME = '50-inhibit-decky.portal'
PORTAL_DROPIN_FILE_NAME = '20-decky-portals.conf'
SHIPPED_PORTAL_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'portal')


def portal_file_targets():
    return ((PORTAL_BACKEND_FILE_NAME, PORTAL_INSTALL_DIR),
            (PORTAL_DROPIN_FILE_NAME, PORTAL_DROPIN_DIR))


def restart_portal():
    decky_plugin.logger.info('restarting xdg-desktop-portal to apply the change')
    for command in (['systemctl', '--user', 'daemon-reload'],
                    ['systemctl', '--user', '--no-block', 'restart', 'xdg-desktop-portal']):
        try:
            subprocess.run(command, check=False, timeout=10)
        except Exception as e:
            decky_plugin.logger.info(f'{" ".join(command)} failed: {e}')


async def portal_daemon_environment():
    """Environment of the running xdg-desktop-portal.

    That daemon is the process which reads XDG_DESKTOP_PORTAL_DIR, and its copy is
    authoritative: the plugin is started without the session's own variables.
    """
    owner = await dbus_call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                            'GetNameOwner', 's', ['org.freedesktop.portal.Desktop'])
    portal_pid = await dbus_call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
                                 'GetConnectionUnixProcessID', 's', [owner]) if owner else None
    if portal_pid is None:
        return {}
    try:
        with open(f'/proc/{portal_pid}/environ', 'rb') as handle:
            raw_environment = handle.read()
    except OSError as e:
        decky_plugin.logger.info(f'could not read the portal environment: {e}')
        return {}
    return dict(entry.decode('utf-8', 'replace').split('=', 1)
                for entry in raw_environment.split(b'\x00') if b'=' in entry)


async def install_portal_files():
    """Copy the shipped portal files into place for this session.

    A gamescope session exports XDG_DESKTOP_PORTAL_DIR empty, which leaves
    xdg-desktop-portal with no portal files at all. Point it at a directory we own
    so applications can inhibit through the portal again.
    """
    if (await portal_daemon_environment()).get('XDG_DESKTOP_PORTAL_DIR', None) != '':
        decky_plugin.logger.info('portal backend not installed: the portal is not missing its search path')
        return
    changed_file_names = []
    for file_name, target_dir in portal_file_targets():
        target_path = os.path.join(os.path.expanduser(target_dir), file_name)
        try:
            with open(os.path.join(SHIPPED_PORTAL_DIR, file_name)) as handle:
                shipped_content = handle.read()
            installed_content = open(target_path).read() if os.path.exists(target_path) else None
            if installed_content != shipped_content:
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, 'w') as handle:
                    handle.write(shipped_content)
                changed_file_names.append(file_name)
        except OSError as e:
            decky_plugin.logger.info(f'portal backend not installed: {e}')
            return
    if changed_file_names:
        decky_plugin.logger.info(f'installed portal files ({", ".join(changed_file_names)})')
        restart_portal()


def remove_portal_files():
    removed = []
    dropin_path = os.path.join(os.path.expanduser(PORTAL_DROPIN_DIR), PORTAL_DROPIN_FILE_NAME)
    try:
        os.remove(dropin_path)
        os.rmdir(os.path.dirname(dropin_path))
        removed.append(PORTAL_DROPIN_FILE_NAME)
    except OSError:
        pass
    try:
        shutil.rmtree(os.path.expanduser(PORTAL_INSTALL_DIR))
        removed.append(PORTAL_INSTALL_DIR)
    except OSError:
        pass
    decky_plugin.logger.info(f'removed portal files: {", ".join(removed) or "none"}')
    if removed:
        restart_portal()


class PortalRequest(ServiceInterface):
    def __init__(self, backend, handle):
        super().__init__('org.freedesktop.impl.portal.Request')
        self._backend = backend
        self._handle = handle

    @method()
    async def Close(self):
        await self._backend.close(self._handle)


class PortalInhibitBackend(ServiceInterface):
    def __init__(self):
        super().__init__(PORTAL_INTERFACE_NAME)
        self._cookies_by_handle = {}

    @method()
    async def Inhibit(self, handle: 'o', app_id: 's', window: 's', flags: 'u', options: 'a{sv}'):
        inhibit_reason = getattr(options.get('reason'), 'value', 'inhibit')
        screensaver_cookie = await forward_to_screensaver_service('Inhibit', 'ss', [app_id, inhibit_reason])
        if handle not in self._cookies_by_handle:
            self._cookies_by_handle[handle] = []
            bus.export(handle, PortalRequest(self, handle))
        self._cookies_by_handle[handle].append(screensaver_cookie)
        decky_plugin.logger.info(f'portal inhibit: {app_id} ({inhibit_reason}) {handle} -> screensaver cookie {screensaver_cookie}')

    async def close(self, handle):
        screensaver_cookies = self._cookies_by_handle.pop(handle, [])
        if not screensaver_cookies:
            return
        try:
            bus.unexport(handle)
        except Exception:
            pass
        for screensaver_cookie in screensaver_cookies:
            if screensaver_cookie is not None:
                await forward_to_screensaver_service('UnInhibit', 'u', [screensaver_cookie])
        decky_plugin.logger.info(f'portal inhibit released: {handle} ({len(screensaver_cookies)} cookie(s))')


portal_inhibit_backend = PortalInhibitBackend()


class AppRequest:
    def __init__(self, sender):
        self.sender = sender
        self.steam_cookie = None
    
    async def is_connected(self):
        global bus
        message = Message(
            destination='org.freedesktop.DBus',
            path='/org/freedesktop/DBus',
            interface='org.freedesktop.DBus',
            member='GetConnectionUnixProcessID',
            signature='s',
            body=[self.sender]
        )
        reply = await bus.call(message)
        return reply.message_type != MessageType.ERROR

class BaseInterface(ServiceInterface):
    proxy_to_screensaver = False
    ignore_application = ["Steam", "./steamwebhelper"]
    request_map = {}
    cookie = 0

    def __init__(self, service):
        super().__init__(service)

    async def _proxy_inhibit(self, application, reason):
        if not self.proxy_to_screensaver:
            return None
        return await forward_to_screensaver_service('Inhibit', 'ss', [application, reason])

    async def _proxy_uninhibit(self, steam_cookie):
        if not self.proxy_to_screensaver or steam_cookie is None:
            return
        await forward_to_screensaver_service('UnInhibit', 'u', [steam_cookie])

    async def _inhibit_impl(self, application, reason):
        if application in BaseInterface.ignore_application: return 0
        decky_plugin.logger.info(f'called Inhibit with application={application} and reason={reason}')
        sender = ServiceInterface.last_msg.sender
        BaseInterface.cookie += 1
        request = AppRequest(sender)
        request.steam_cookie = await self._proxy_inhibit(application, reason)
        BaseInterface.request_map[BaseInterface.cookie] = request
        return BaseInterface.cookie

    async def _un_inhibit_impl(self, cookie):
        if cookie == 0: return
        decky_plugin.logger.info(f'called UnInhibit with cookie={cookie}')
        request = BaseInterface.request_map.pop(cookie, None)
        if request is None:
            decky_plugin.logger.info(f'cannot find cookie={cookie}')
            return
        await self._proxy_uninhibit(request.steam_cookie)

class InhibitInterface(BaseInterface):
    def __init__(self):
        super().__init__('org.freedesktop.ScreenSaver')

    @method()
    async def Inhibit(self, application: 's', reason: 's') -> 'u':
        return await self._inhibit_impl(application, reason)

    @method()
    async def UnInhibit(self, cookie: 'u'):
        return await self._un_inhibit_impl(cookie)

class PMInhibitInterface(BaseInterface):
    proxy_to_screensaver = True

    def __init__(self):
        super().__init__('org.freedesktop.PowerManagement.Inhibit')

    @method()
    async def Inhibit(self, application: 's', reason: 's') -> 'u':
        return await self._inhibit_impl(application, reason)

    @method()
    async def UnInhibit(self, cookie: 'u'):
        return await self._un_inhibit_impl(cookie)

class GnomeInterface(BaseInterface):
    proxy_to_screensaver = True

    def __init__(self):
        super().__init__('org.gnome.SessionManager')

    @method()
    async def Inhibit(self, application: 's', xid: 'u', reason: 's', flags: 'u') -> 'u':
        return await self._inhibit_impl(application, reason)

    @method()
    async def Uninhibit(self, cookie: 'u'):
        return await self._un_inhibit_impl(cookie)

async def stop_dbus():
    global bus
    try:
        if bus is not None:
            bus.disconnect()
        bus = None
    except Exception as e:
        decky_plugin.logger.info(f"error: {e}")

async def start_dbus():
    global bus, owns_screensaver_name
    await stop_dbus()
    try:
        bus = await MessageBus().connect()
        interface = InhibitInterface()
        pm_interface = PMInhibitInterface()
        gnome_interface = GnomeInterface()
        bus.export('/ScreenSaver', interface) # vlc
        bus.export('/org/freedesktop/ScreenSaver', interface) # chrome
        bus.export('/org/freedesktop/PowerManagement/Inhibit', pm_interface) # wiliwili
        bus.export('/org/gnome/SessionManager', gnome_interface) # mpv with https://github.com/Guldoman/mpv_inhibit_gnome installed
        await bus.request_name('org.freedesktop.PowerManagement')
        reply = await bus.request_name('org.freedesktop.ScreenSaver')
        owns_screensaver_name = reply in (RequestNameReply.PRIMARY_OWNER, RequestNameReply.ALREADY_OWNER)
        if not owns_screensaver_name:
            decky_plugin.logger.info(f'org.freedesktop.ScreenSaver is provided by another service ({reply}), proxying to it')
        bus.export('/org/freedesktop/portal/desktop', portal_inhibit_backend)
        await bus.request_name(PORTAL_DBUS_NAME)
        await install_portal_files()
        await bus.request_name('org.gnome.SessionManager')
    except Exception as e:
        decky_plugin.logger.info(f"error: {e}")

class Plugin:

    async def start_backend(self):
        decky_plugin.logger.info("Start backend server")
        await start_dbus()

    async def stop_backend(self):
        decky_plugin.logger.info("Stop backend server")
        for request in list(BaseInterface.request_map.values()):
            if request.steam_cookie is not None:
                await forward_to_screensaver_service('UnInhibit', 'u', [request.steam_cookie])
        BaseInterface.request_map.clear()
        for screensaver_cookies in list(portal_inhibit_backend._cookies_by_handle.values()):
            for screensaver_cookie in screensaver_cookies:
                if screensaver_cookie is not None:
                    await forward_to_screensaver_service('UnInhibit', 'u', [screensaver_cookie])
        portal_inhibit_backend._cookies_by_handle.clear()
        await stop_dbus()

    async def is_inhibited(self):
        global bus
        if bus is None:
            return False
        for app_cookie in list(BaseInterface.request_map):
            request = BaseInterface.request_map[app_cookie]
            if await request.is_connected():
                continue
            BaseInterface.request_map.pop(app_cookie, None)
            if request.steam_cookie is not None:
                await forward_to_screensaver_service('UnInhibit', 'u', [request.steam_cookie])
        return bool(BaseInterface.request_map) or bool(portal_inhibit_backend._cookies_by_handle)

    async def get_settings(self, key: str, defaults):
        decky_plugin.logger.info('[settings] get {}'.format(key))
        return settings.getSetting(key, defaults)

    async def set_settings(self, key: str, value):
        decky_plugin.logger.info('[settings] set {}: {}'.format(key, value))
        return settings.setSetting(key, value)

    async def _main(self):
        decky_plugin.logger.info("Hello World!")

    async def _unload(self):
        decky_plugin.logger.info("Goodnight World!")
        await stop_dbus()

    async def _uninstall(self):
        remove_portal_files()

    async def _migration(self):
        pass