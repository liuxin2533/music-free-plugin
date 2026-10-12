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

async function request(path, method, data, connection) {
  const config = connection || configuration();
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
  const size = Number.isFinite(track.size) && track.size > 0 ? track.size : undefined;
  const summary = [size ? (size / 1000000).toFixed(2) + ' MB' : '', track.sourceName, track.album].filter(Boolean).join(' · ');
  return {id: track.id, title: track.title, artist: track.artist, album: summary,
    originalAlbum: track.album, size,
    duration: track.duration || undefined, artwork: track.artwork || undefined,
    qualities: {standard: {size}},
    description: summary + (track.format ? ' · ' + track.format.toUpperCase() : ' · 首次播放会先下载到服务器')};
}

// A search is a growing set, not a fixed array: slower channels can insert songs
// ahead of previously displayed ones. Track IDs, rather than offsets, define pages.
const searches = new Map();
const SEARCH_PAGE_SIZE = 20;

async function searchPage(state, page) {
  const deadline = Date.now() + 65000;
  let result = page === 1
    ? await request('/searches', 'POST', {query: state.query}, state.connection)
    : await request('/searches/' + encodeURIComponent(state.id), 'GET', undefined, state.connection);
  state.id = result.id;
  while (true) {
    if (result.status === 'failed') throw new Error(result.error || '搜索失败，请重新搜索');
    const pending = result.status === 'queued' || result.status === 'running';
    const unique = new Set(state.seen);
    const fresh = (result.items || []).filter(track => {
      if (unique.has(track.id)) return false;
      unique.add(track.id);
      return true;
    });
    if (fresh.length || !pending) {
      const batch = fresh.slice(0, SEARCH_PAGE_SIZE);
      const value = {isEnd: !pending && fresh.length <= SEARCH_PAGE_SIZE, data: batch.map(music)};
      batch.forEach(track => state.seen.add(track.id));
      return value;
    }
    if (Date.now() >= deadline) throw new Error('搜索仍在处理，请稍后重试；已显示的歌曲可以播放');
    await sleep(1000);
    result = await request('/searches/' + encodeURIComponent(state.id), 'GET', undefined, state.connection);
  }
}

async function search(query, page, type) {
  if (type && type !== 'music') return {isEnd: true, data: []};
  const number = Math.max(1, Math.floor(Number(page) || 1));
  const connection = configuration();
  const normalized = String(query || '').trim();
  const key = JSON.stringify([connection.base, connection.token, normalized]);
  let state = searches.get(key);
  if (number === 1 && !(state && state.pending.has(1))) {
    state = {query: normalized, connection, seen: new Set(), pages: new Map(), pending: new Map(), ended: false};
    searches.delete(key);
    searches.set(key, state);
    // Bound memory without persisting queries or credentials on the device.
    while (searches.size > 20) searches.delete(searches.keys().next().value);
  }
  if (!state) throw new Error('搜索已过期，请重新搜索');
  if (state.pages.has(number)) return state.pages.get(number);
  if (state.pending.has(number)) return state.pending.get(number);
  if (state.ended) return {isEnd: true, data: []};
  // Desktop can advance the page number after a failed request. IDs are the
  // cursor, so that retry must still fetch all unseen songs. Serialize different
  // pages too, while duplicate calls for one page share their promise above.
  const preceding = Array.from(state.pending.values());
  const task = Promise.all(preceding.map(value => value.catch(() => undefined)))
    .then(() => state.ended ? {isEnd: true, data: []} : searchPage(state, number)).then(value => {
    state.pages.set(number, value);
    state.ended = value.isEnd;
    return value;
  });
  state.pending.set(number, task);
  try {
    return await task;
  } finally {
    state.pending.delete(number);
  }
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
  platform: '安然音乐', author: 'liuxin2533', version: '0.4.1',
  srcUrl: 'https://raw.githubusercontent.com/liuxin2533/music-free-plugin/main/music-free-plugin.js', primaryKey: ['id'],
  cacheControl: 'no-store', supportedSearchType: ['music'],
  userVariables: [{key: 'serverURL', name: '服务器地址（留空使用 music.anrand.tech）', title: '服务器地址（留空使用 music.anrand.tech）'},
    {key: 'token', name: '插件密钥（网站设置页生成）', title: '插件密钥（网站设置页生成）'}],
  search,
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

