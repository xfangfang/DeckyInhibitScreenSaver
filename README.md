# Decky Screen Saver

Inhibit screensaver during video playback

### How does this plugin work

In SteamDeck game mode, when using the browser or video player, SteamDeck will automatically suspend in a few minutes. You need to manually modify the relevant system settings to prevent this behavior.

This plugin registers and monitors the missing D-Bus services in game mode, automatically preventing the system from suspending when receiving a request from a application. And restore the default settings when the application closes or cancels the request (dimming: 5 minutes, suspending: 10 minutes)


### Compatible application
- [x] VLC
- [x] Chrome