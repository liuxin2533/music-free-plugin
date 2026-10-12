# 安然音乐 · MusicFree 插件

当前版本 **0.4.1**，通过 GitHub 安装和更新。

安卓和 Windows 共用 CommonJS 插件。一次搜索服务器上所有启用渠道，只返回音频可解析、大小已确认且在统一上限内的结果。QQ、网易云、酷狗、酷我、咪咕均可在 Web UI 启停。

## 安装与设置

1. MusicFree → 插件管理 → 从网络安装：`https://raw.githubusercontent.com/liuxin2533/music-free-plugin/main/music-free-plugin.js`。
2. 在 `https://music.anrand.tech` 的设置页获取插件密钥，填入插件设置；服务器地址留空即可。
3. **Web UI → 设置 → 每首歌曲大小上限**：默认 10 MB，可修改，所有启用渠道共用；无需配置音质档位。各渠道可选 Cookie 单独保存。
4. 搜索或打开「服务器歌单」，首次播放先完整下载到服务器，后续复用已有音频。MusicFree 下载功能保存到当前设备。

订阅地址：`https://raw.githubusercontent.com/liuxin2533/music-free-plugin/main/plugins.json`。插件与订阅仅通过 GitHub 分发，服务器不托管插件。旧服务器地址安装的插件需从 GitHub 重新安装一次，以后用 MusicFree 插件更新功能更新。

## 大小显示与行为

MusicFree 歌曲列表没有独立大小栏。插件在专辑说明中显示 `5.25 MB · 咪咕音乐 · 专辑名`，同时提供 size 与 qualities.standard.size；originalAlbum 保留原专辑名，歌曲标题、歌手、稳定 ID 不改。每首歌只提供一份原始文件，不虚构四档音质。

搜索会解析和检查候选音频，收到首批合格结果就显示，不等所有渠道结束；每批最多 20 首。列表触底或加载更多时，继续读取同一个搜索任务的后续结果。插件按稳定 ID 记录已经显示的歌曲，避免迟到渠道造成重复或遗漏；刷新搜索会重新开始。没有新增结果且任务仍在进行时继续等待，直到有新结果或任务结束。

每页最多等待约 65 秒，单次请求超时 10 秒。搜索状态只保存在插件内存中，最多保留 20 个查询；重启客户端或状态失效后重新搜索。服务器五分钟内复用相同查询与配置的任务；上限、渠道启用或 Cookie 改动后重新搜索会生效。超限、未知大小或不可用的音频不展示。各渠道同名歌曲仍独立，点击后不会换成别的平台歌曲。

首次播放约每 1.5 秒轮询任务，等待上限约 120 秒，之后后台继续；可稍后再次播放。音源可能在搜索后失效，完整音频检查也可能失败；MusicFree 可能不显示插件抛出的详细错误，可在 Web UI 下载任务查看。

已有服务器曲库文件保留，不因上限变小而删除；仍能从曲库或歌单播放。服务器歌单重新获取时读取最新内容。不修改 MusicFree，不同步其原生收藏、最近播放或本地歌单编辑。

## 验证

`node --test` 运行 20 项协议测试，覆盖首批提前返回、乱序增量结果、短页继续加载、重复/并发页请求、失败重试与桌面端跳页。官方 Android/Windows 搜索 hook 的分页状态与累加逻辑已在隔离测试中执行验证。实际 MusicFree 新版安装、Android/Windows 播放及列表呈现仍待实机验收；代码测试不能替代实机验收。

参考：[MusicFree 官方插件协议](https://musicfree.catcat.work/plugin/protocol.html)、[安卓列表](https://github.com/maotoumao/MusicFree/blob/master/src/components/mediaItem/musicItem.tsx)、[桌面列表](https://github.com/maotoumao/MusicFreeDesktop/blob/master/src/renderer/components/MusicList/index.tsx)。
