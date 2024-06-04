import os
import decky_plugin
from aiohttp import web
import queue
import asyncio

def get_plugin_dir():
    from pathlib import Path
    return Path(__file__).parent.resolve()

def add_plugin_to_path():
    import sys

    plugin_dir = get_plugin_dir()
    decky_plugin.logger.info(f'plugin dir: {plugin_dir}')
    directories = [["./"], ["dbus_next"], ["lib"], ["py_modules", "dbus_next"], ["py_modules", "lib"]]
    for dir in directories:
        sys.path.insert(0, str(plugin_dir.joinpath(*dir)))

def setup_environ_vars():
    os.environ['XDG_RUNTIME_DIR'] = '/run/user/1000'
    os.environ['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=/run/user/1000/bus'
    os.environ['HOME'] = '/home/deck'

add_plugin_to_path()
setup_environ_vars()

import x.etree.ElementTree as ET

debug = False
event_queue = queue.Queue()

async def index(request: web.Request) -> web.StreamResponse:
    global event_queue
    query_parameters = request.rel_url.query
    brightness = query_parameters.get('brightness', None)
    if brightness is not None:
        event_queue.put({"type": "brightness", "value": int(brightness)})
    idle = query_parameters.get('idle', None)
    idle_type = query_parameters.get('idle_type', None)
    if idle is not None:
        event_queue.put({"type": "idle", "value": int(idle), "idle_type": int(idle_type)})
    return web.Response(text="hello world")

app = web.Application()
app.router.add_route("GET", "/", index)
runner = None
site = None

async def stop_web():
    global site
    global runner
    if site is None:
        return
    await site.stop()
    await runner.cleanup()
    runner = None
    site = None

async def start_web():
    global site
    global runner
    await stop_web()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8776)
    await site.start()

from dbus_next.aio import MessageBus
from dbus_next import Message, MessageType
from dbus_next.service import (ServiceInterface, method, dbus_property, signal)

bus = None

class AppRequest:
    def __init__(self, sender, cookie, application, reason):
        self.sender = sender
        self.cookie = cookie
        self.application = application
        self.reason = reason
    
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
    ignore_application = ["Steam", "./steamwebhelper"]
    request_map = {}
    cookie = 0

    def __init__(self, service):
        super().__init__(service)

    @method()
    async def Inhibit(self, application: 's', reason: 's') -> 'u':
        if application in BaseInterface.ignore_application: return 0
        decky_plugin.logger.info(f'called Inhibit with application={application} and reason={reason}')
        event_queue.put({"type": "Inhibit"})
        sender = ServiceInterface.last_msg.sender
        BaseInterface.cookie += 1
        BaseInterface.request_map[BaseInterface.cookie] = AppRequest(sender, BaseInterface.cookie, application, reason)
        return BaseInterface.cookie

    @method()
    def UnInhibit(self, cookie: 'u'):
        if cookie == 0: return
        decky_plugin.logger.info(f'called UnInhibit with cookie={cookie}')
        if BaseInterface.request_map.pop(cookie, None) is None:
            decky_plugin.logger.info(f'cannot find cookie={cookie}')
        if len(BaseInterface.request_map) == 0:
            event_queue.put({"type": "UnInhibit"})

class InhibitInterface(BaseInterface):
    def __init__(self):
        super().__init__('org.freedesktop.ScreenSaver')

class PMInhibitInterface(BaseInterface):
    def __init__(self):
        super().__init__('org.freedesktop.PowerManagement.Inhibit')

class PortalInhibitInterface(BaseInterface):
    def __init__(self):
        super().__init__('org.freedesktop.portal.Inhibit')

async def stop_dbus():
    global bus
    try:
        if bus is not None:
            bus.disconnect()
        bus = None
    except Exception as e:
        decky_plugin.logger.info(f"error: {e}")

async def start_dbus():
    global bus
    await stop_dbus()
    try:
        bus = await MessageBus().connect()
        interface = InhibitInterface()
        pm_interface = PMInhibitInterface()
        portal_interface = PortalInhibitInterface()
        bus.export('/ScreenSaver', interface) # vlc
        bus.export('/org/freedesktop/ScreenSaver', interface) # chrome
        bus.export('/org/freedesktop/PowerManagement/Inhibit', pm_interface) # wiliwili
        # bus.export('/org/freedesktop/portal/desktop', portal_interface) # firefox
        await bus.request_name('org.freedesktop.PowerManagement')
        await bus.request_name('org.freedesktop.ScreenSaver')
        # await bus.request_name('org.freedesktop.portal.Desktop')
    except Exception as e:
        decky_plugin.logger.info(f"error: {e}")

class Plugin:

    async def start_backend(self):
        decky_plugin.logger.info("Start backend server")
        if debug:
            await start_web()
        else:
            await start_dbus()

    async def stop_backend(self):
        decky_plugin.logger.info("Stop backend server")
        if debug:
            await stop_web()
        else:
            await stop_dbus()
        event_queue.queue.clear()

    async def get_event(self):
        res = []
        while not event_queue.empty():
            try:
                res.append(event_queue.get_nowait())
            except queue.Empty:
                continue
        if len(res) > 0:
            return res
        # check closed dbus connection
        cookies = list(BaseInterface.request_map.keys())
        clear = False
        for c in cookies:
            connected = await BaseInterface.request_map[c].is_connected()
            if not connected:
                BaseInterface.request_map.pop(c)
                clear = True
        if clear and len(BaseInterface.request_map) == 0:
            return [{"type": "UnInhibit"}]
        return []

    async def _main(self):
        decky_plugin.logger.info("Hello World!")

    async def _unload(self):
        decky_plugin.logger.info("Goodnight World!")
        if debug:
            stop_web()
        else:
            stop_dbus()

    async def _uninstall(self):
        pass

    async def _migration(self):
        pass