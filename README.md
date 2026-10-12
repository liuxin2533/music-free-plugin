# 安然音乐 · MusicFree 插件

安卓和 Windows 共用的 CommonJS 插件，连接自己的安然音乐服务器。只接入 QQ 歌曲，歌曲首次播放时先完整下载到服务器，再提供播放地址，后续复用。

## 安装

1. 在 MusicFree「插件管理」中选择从网络安装：`https://music.anrand.tech/plugins/music-free-plugin.js`。
2. 在网站 `https://music.anrand.tech` 的设置页生成插件密钥。
3. 打开「安然音乐」插件设置，填写插件密钥。服务器地址留空即可；自建部署填写 HTTPS 域名。
4. 搜索歌曲，或在推荐歌单中进入服务器歌单。管理后台修改歌单后，重新获取即可看到更新。

订阅地址：`https://music.anrand.tech/plugins/plugins.json`。更新使用 MusicFree 的插件更新功能。密钥不包含在公开插件代码和订阅文件中。

## 行为与边界

- 首次播放按 1.5 秒间隔查询下载任务，单个 HTTP 请求超时 10 秒，等待约 120 秒后提示稍后重试；服务器后台继续任务。
- 只提供 `standard` 这一原始文件入口，实际可能是 FLAC、MP3 等格式，不把同一文件伪装成多个音质。
- 歌曲使用服务器稳定 ID，音频地址有时效，每次播放重新获取。客户端下载功能把服务器文件下载到当前设备。
- 支持搜索、详情、歌词、全部已下载、最近入库和自建服务器歌单。
- 不同步 MusicFree 的原生收藏、最近播放或本地歌单编辑；不修改 MusicFree 客户端。
- 插件密钥只允许读取和请求下载，不能编辑后台、删除文件或获取 QQ Cookie。

## 开发与发布

`node --test` 运行协议测试，不依赖真实账号。MusicFree 自带 `axios` 和 `env`；插件不修改共享 axios 默认设置。

main 推送通过独立 Webhook、Hermes 固定脚本和服务器持久队列发布。版本化文件位于 `/plugins/<版本号>/music-free-plugin.js`，固定更新地址不变。发布时同步修改 JS、package.json 和 plugins.json 中的版本号。

协议依据：[MusicFree 官方插件协议](https://musicfree.catcat.work/plugin/protocol.html)。安卓和 Windows 实机播放需分别验收，Node 测试不替代实机验收。

2026-10-12 已在 Windows MusicFree 0.0.8 实测插件 0.1.1：网络安装、变量配置、QQ 搜索、首次完整下载后播放、进度跳转、下载到电脑、服务端歌单及排序刷新、插件更新均通过。安卓实机尚待验收。Windows 的服务器歌单入口为「热门歌单 → 安然音乐」。
