# Decky Screen Saver

[English](./README.md)

这是一个适用于 Decky Loader (SteamDeck插件加载器) 的插件，在使用 SteamDeck 游戏模式播放视频时，这个插件会自动禁用系统锁屏，让用户有一个舒适的观影体验。

### 如何安装

1. 安装 Decky Loader: https://decky.xyz
2. 下载 `ScreenSaver.zip`: https://github.com/xfangfang/DeckyInhibitScreenSaver/releases
2. 解压 `ScreenSaver.zip` 到 `/home/deck/homebrew/plugins` 目录下，重启 Steam

<p>
感谢大家的赞助，这将大大支持我制作更多更好的开源应用
<details >
<summary id="sponsorships"><b>捐助二维码:（点击展开）</b></summary>
<img  width="400" src="https://xfangfang.github.io/Macast/sponsorships.png" />
</details>
</p>

### 这个插件是如何工作的

在SteamDeck游戏模式下，当使用浏览器或视频播放器时，SteamDeck将在几分钟后自动暂停。您需要手动修改相关的系统设置以防止这种行为。

本插件在游戏模式下注册并监控缺失的 D-Bus 服务，在收到应用程序的请求时自动防止系统挂起。并在应用程序关闭或取消请求时恢复默认设置（调暗：5分钟，休眠：10分钟）

### 兼容的软件
- [x] VLC
- [x] Chrome
- [x] mpv (支持 Flathub 商店版，其余需要安装 [mpv_inhibit_gnome](https://github.com/Guldoman/mpv_inhibit_gnome))
- [x] wiliwili