/* global env */
// CommonJS; the MusicFree runtime supplies axios and env on both platforms.
const axios = require('axios');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function configuration() {
  const values = env.getUserVariables() || {};
  const base = String(values.serverURL || 'https://music.anrand.tech').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/?#@]+(?::\d+)?$/.test(base)) throw new Error('服务器地址须为 HTTPS 域名，不带路径');
  const token = String(values.token || '').trim();
  if (!token) throw new Error('请先在插件设置中填写插件密钥（在网站设置页生成）');
  return {base, token};
}

async function request(path, method, data) {
  const config = configuration();
  try {
    const response = await axios({url: config.base + '/api/v1' + path, method: method || 'GET',
      data, timeout: 10000, headers: {Authorization: 'Bearer ' + config.token}});
    return response.data;
  } catch (error) {
    const detail = error.response && error.response.data && error.response.data.detail;
    // Do not propagate axios config: it contains the private plugin token.
    throw new Error(typeof detail === 'string' ? detail : '音乐服务器暂时无法连接，请稍后重试');
  }
}

function music(track) {
  return {id: track.id, title: track.title, artist: track.artist, album: track.album,
    duration: track.duration || undefined, artwork: track.artwork || undefined,
    qualities: {standard: {size: track.size || undefined}},
    description: (track.sourceName ? track.sourceName + ' · ' : '') + (track.format ? '原始文件 · ' + track.format.toUpperCase() : '首次播放会先下载到服务器')};
}

async function source(item, quality) {
  if (quality && quality !== 'standard') return null;
  const deadline = Date.now() + 120000;
  let result = await request('/tracks/' + encodeURIComponent(item.id) + '/download', 'POST');
  while (Date.now() < deadline) {
    if (result.status === 'ready') return {url: result.url, type: result.track.format};
    if (result.status === 'failed' || result.status === 'cancelled') throw new Error(result.error || '下载未完成，请在网站任务页重试');
    if (result.status === 'completed') {
      result = await request('/tracks/' + encodeURIComponent(item.id) + '/download', 'POST');
      continue;
    }
    await sleep(1500);
    result = await request('/downloads/' + encodeURIComponent(result.id));
  }
  throw new Error('服务器仍在下载，请稍后再次播放；任务会在后台继续');
}

module.exports = {
  platform: '安然音乐', author: 'liuxin2533', version: '0.3.0',
  srcUrl: 'https://raw.githubusercontent.com/liuxin2533/music-free-plugin/main/music-free-plugin.js', primaryKey: ['id'],
  cacheControl: 'no-store', supportedSearchType: ['music'],
  userVariables: [{key: 'serverURL', name: '服务器地址（留空使用 music.anrand.tech）', title: '服务器地址（留空使用 music.anrand.tech）'},
    {key: 'token', name: '插件密钥（网站设置页生成）', title: '插件密钥（网站设置页生成）'}],
  async search(query, page, type) {
    if (page > 1 || (type && type !== 'music')) return {isEnd: true, data: []};
    let result = await request('/searches', 'POST', {query});
    const deadline = Date.now() + 65000;
    while (result.status === 'queued' || result.status === 'running') {
      if (Date.now() >= deadline) throw new Error('搜索仍在处理，请稍后重试');
      await sleep(1000);
      result = await request('/searches/' + encodeURIComponent(result.id));
    }
    if (result.status === 'failed') throw new Error(result.error || '该渠道搜索失败');
    return {isEnd: true, data: result.items.map(music)};
  },
  getMediaSource: source,
  async getMusicInfo(item) {return music(await request('/tracks/' + encodeURIComponent(item.id)));},
  async getLyric(item) {
    const result = await request('/tracks/' + encodeURIComponent(item.id));
    return {rawLrc: result.lyric || ''};
  },
  async getRecommendSheetTags() {return {pinned: [{id: 'server', title: '服务器歌单'}], data: []};},
  async getRecommendSheetsByTag(tag, page) {
    if (page > 1) return {isEnd: true, data: []};
    const result = await request('/playlists');
    return {isEnd: true, data: [{id: 'library', title: '全部已下载'}, {id: 'recent', title: '最近入库'}]
      .concat(result.items.map(row => ({id: row.id, title: row.name, worksNum: row.count}))) };
  },
  async getMusicSheetInfo(sheet, page) {
    const number = Math.max(1, Number(page) || 1);
    const virtual = sheet.id === 'library' || sheet.id === 'recent';
    const path = virtual ? '/library?sort=' + (sheet.id === 'library' ? 'title' : 'recent') + '&page_size=100&page=' + number
      : '/playlists/' + encodeURIComponent(sheet.id) + '?page=' + number;
    const result = await request(path);
    return {isEnd: result.isEnd, musicList: result.items.map(music),
      sheetItem: {title: virtual ? (sheet.id === 'library' ? '全部已下载' : '最近入库') : result.name}};
  }
};

