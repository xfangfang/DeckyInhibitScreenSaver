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

ignore_application = ["Steam", "./steamwebhelper"]
bus = None

class InhibitInterface(ServiceInterface):
    def __init__(self):
        super().__init__('org.freedesktop.ScreenSaver')

    @method()
    def Inhibit(self, application: 's', reason: 's') -> 'u':
        if application in ignore_application: return 2
        decky_plugin.logger.info(f'called Inhibit with application={application} and reason={reason}')
        event_queue.put({"type": "Inhibit"})
        return 1

    @method()
    def UnInhibit(self, cookie: 'u'):
        if cookie != 1: return
        decky_plugin.logger.info(f'called UnInhibit with cookie={cookie}')
        event_queue.put({"type": "UnInhibit"})

class PMInhibitInterface(ServiceInterface):
    def __init__(self):
        super().__init__('org.freedesktop.PowerManagement.Inhibit')

    @method()
    async def Inhibit(self, application: 's', reason: 's') -> 'u':
        if application in ignore_application: return 2
        decky_plugin.logger.info(f'called Inhibit with application={application} and reason={reason}')
        event_queue.put({"type": "Inhibit"})

        # sender = self.last_msg.sender
        # decky_plugin.logger.info(f'Sender: {sender}')
        # reply = await bus.call(Message(
        #     destination='org.freedesktop.DBus',
        #     path='/org/freedesktop/DBus',
        #     interface='org.freedesktop.DBus',
        #     member='GetConnectionUnixProcessID',
        #     signature='s',
        #     body=[sender]
        # ))
        # if reply.message_type == MessageType.ERROR:
        #     decky_plugin.logger.info(f'error: {reply.body[0]}')
        # else:
        #     decky_plugin.logger.info(f'Process ID: {reply.body[0]} - {type(reply.body[0])}')

        return 1

    @method()
    def UnInhibit(self, cookie: 'u'):
        if cookie != 1: return
        decky_plugin.logger.info(f'called UnInhibit with cookie={cookie}')
        event_queue.put({"type": "UnInhibit"})

class PortalInhibitInterface(ServiceInterface):
    def __init__(self):
        super().__init__('org.freedesktop.portal.Inhibit')

    @method()
    def Inhibit(self, application: 's', reason: 's') -> 'u':
        if application in ignore_application: return 2
        print(f'called Inhibit with application={application} and reason={reason}')
        event_queue.put({"type": "Inhibit"})
        return 1

    @method()
    def UnInhibit(self, cookie: 'u'):
        if cookie != 1: return
        print(f'called UnInhibit with cookie={cookie}')
        event_queue.put({"type": "UnInhibit"})

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
        bus.export('/org/freedesktop/portal/desktop', portal_interface) # firefox
        await bus.request_name('org.freedesktop.PowerManagement')
        await bus.request_name('org.freedesktop.ScreenSaver')
        await bus.request_name('org.freedesktop.portal.Desktop')
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
        return res

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