const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const text = fs.readFileSync(require('node:path').join(__dirname, '../music-free-plugin.js'), 'utf8');
function load(responses, variables = {token: 'test-plugin-key'}) {
  const calls = []; let clock = 0;
  const context = {module: {exports: {}}, env: {getUserVariables: () => variables},
    Date: {now: () => clock}, setTimeout: callback => {clock += 1500; callback();},
    require: name => {assert.equal(name, 'axios'); return async config => {
      calls.push(config); const response = responses.shift(); if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected HTTP call'); return {data: response};
    };}};
  vm.runInNewContext(text, context);
  return {plugin: context.module.exports, calls};
}
test('first play polls an existing job then obtains a fresh signed URL', async () => {
  const {plugin, calls} = load([{id:'j',status:'queued'}, {id:'j',status:'running'},
    {id:'j',status:'completed'}, {status:'ready', url:'https://media.test/song', track:{format:'flac'}}]);
  const result = await plugin.getMediaSource({id:'stable'}, 'standard');
  assert.equal(result.url, 'https://media.test/song'); assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.timeout === 10000));
  assert.ok(calls.every(c => c.headers.Authorization === 'Bearer test-plugin-key'));
});
test('existing files play immediately, without offering other qualities', async () => {
  const {plugin,calls} = load([{status:'ready',url:'https://media.test/song',track:{format:'mp3'}}]);
  assert.equal(await plugin.getMediaSource({id:'a'}, 'super'), null);
  assert.equal(calls.length, 0); await plugin.getMediaSource({id:'a'}, 'standard'); assert.equal(calls.length, 1);
});
test('failed download surfaces server explanation', async () => {
  const {plugin} = load([{status:'failed',error:'容量已满'}]);
  await assert.rejects(plugin.getMediaSource({id:'a'}, 'standard'), /容量已满/);
});
test('secrets are absent from HTTP error messages', async () => {
  const {plugin} = load([new Error('secret test-plugin-key')]);
  await assert.rejects(plugin.getMusicInfo({id:'a'}), error => !error.message.includes('test-plugin-key'));
});
test('search uses stable IDs and only one real quality', async () => {
  const {plugin,calls} = load([{id:'q',status:'queued'}, {status:'completed',items:[{id:'stable',title:'Song',format:'flac'}]}]);
  const result = await plugin.search('Song',1,'music'); assert.equal(result.data[0].id,'stable');
  assert.equal(Object.keys(result.data[0].qualities).join(','),'standard');
  assert.equal((await plugin.search('Song',2,'music')).data.length,0); assert.equal(calls.length,2);
});
test('remote playlist details are refreshed and paginated', async () => {
  const {plugin,calls} = load([{name:'Morning',isEnd:false,items:[]},{name:'Evening',isEnd:true,items:[]}]);
  assert.equal((await plugin.getMusicSheetInfo({id:'list'},1)).sheetItem.title,'Morning');
  assert.equal((await plugin.getMusicSheetInfo({id:'list'},2)).sheetItem.title,'Evening');
  assert.ok(calls[1].url.endsWith('page=2'));
});
test('insecure addresses and missing token fail before network', async () => {
  for (const variables of [{serverURL:'http://example.test',token:'a'}, {}]) {
    const {plugin,calls} = load([],variables); await assert.rejects(plugin.getMusicInfo({id:'a'})); assert.equal(calls.length,0);
  }
});

test('search follows server configuration and ignores legacy local source preferences', async () => {
  for (const value of ['', '网易云', 'invalid']) {
    const {plugin,calls}=load([{status:'completed',items:[]}],{token:'test-plugin-key',source:value});
    await plugin.search('Song',1,'music');assert.equal(calls[0].data.source,undefined);
    assert.equal(plugin.userVariables.map(item => item.key).join(','),'serverURL,token');
  }
});

test('known size is visible in list metadata and native quality data before download', async () => {
  const {plugin}=load([{status:'completed',items:[{id:'song',title:'成都',artist:'Singer',album:'Album',sourceName:'QQ 音乐',size:8123456,format:'mp3',downloaded:false}]}]);
  const item=(await plugin.search('成都',1,'music')).data[0];
  assert.equal(item.qualities.standard.size,8123456);
  assert.equal(item.size,8123456);
  assert.match(item.album,/8\.12 MB/);
  assert.match(item.album,/QQ 音乐/);
  assert.equal(item.originalAlbum,'Album');
  assert.equal(item.title,'成都');
});
test('tracks with the same title retain separate stable server IDs and source names', async () => {
  const {plugin}=load([{status:'completed',items:[{id:'qq-id',title:'Song',sourceName:'QQ 音乐'},{id:'netease-id',title:'Song',sourceName:'网易云音乐'}]}]);
  const result=await plugin.search('Song',1,'music');
  assert.notEqual(result.data[0].id,result.data[1].id);assert.match(result.data[1].description,/网易云音乐/);
});

test('plugin updates come from GitHub while API calls stay on the music server', async () => {
  const {plugin,calls}=load([{id:'track',title:'Song'}]);
  assert.equal(plugin.srcUrl,'https://raw.githubusercontent.com/liuxin2533/music-free-plugin/main/music-free-plugin.js');
  await plugin.getMusicInfo({id:'track'});
  assert.ok(calls[0].url.startsWith('https://music.anrand.tech/api/v1/'));
  const manifest=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../plugins.json'),'utf8'));
  assert.equal(manifest.plugins[0].url,plugin.srcUrl);
  assert.equal(manifest.plugins[0].version,plugin.version);
});
