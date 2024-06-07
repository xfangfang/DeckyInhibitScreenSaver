# Decky Screen Saver

[中文说明](./README_ZH.md)

This is a plugin for Decky Loader (A plugin loader for the Steam Deck), it will automatically inhibit screensaver during video playback under SteamOS game mode.

### How to install

1. Install Decky Loader: https://decky.xyz
2. Download `ScreenSaver.zip` from: https://github.com/xfangfang/DeckyInhibitScreenSaver/releases
3. Unzip `ScreenSaver.zip` to the `/home/deck/homebrew/plugins` directory and restart Steam

[Welcome to buy me a cup of coffee](https://www.paypal.me/xfangfang)

### How does this plugin work

In SteamDeck game mode, when using the browser or video player, SteamDeck will automatically suspend in a few minutes. You need to manually modify the relevant system settings to prevent this behavior.

This plugin registers and monitors the missing D-Bus services in game mode, automatically preventing the system from suspending when receiving a request from a application. And restore the default settings when the application closes or cancels the request (dimming: 5 minutes, suspending: 10 minutes)


### Compatible application
- [x] VLC
- [x] Chrome