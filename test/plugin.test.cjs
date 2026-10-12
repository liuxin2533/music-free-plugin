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

const song = id => ({id,title:id,size:5000000,format:'mp3'});

test('first page returns verified partial results while slow sources are still running', async () => {
  const {plugin,calls}=load([{id:'job',status:'queued',items:[]},
    {id:'job',status:'running',items:[song('fast')]}]);
  const result=await plugin.search('Song',1,'music');
  assert.equal(result.data[0].id,'fast');
  assert.equal(result.isEnd,false);
  assert.equal(calls.length,2,'No further polling after a usable batch is available');
});

test('later sources may reorder results without duplicates or missing songs across pages', async () => {
  const {plugin,calls}=load([
    {id:'job',status:'running',items:[song('migu')]},
    {id:'job',status:'running',items:[song('qq'),song('migu')]},
    {id:'job',status:'completed',items:[song('qq'),song('netease'),song('migu')]},
  ]);
  const first=await plugin.search('Song',1,'music');
  const second=await plugin.search('Song',2,'music');
  assert.equal((await plugin.search('Song',2,'music')).data[0].id,'qq');
  const third=await plugin.search('Song',3,'music');
  assert.equal([...first.data,...second.data,...third.data].map(x=>x.id).join(','),'migu,qq,netease');
  assert.equal(third.isEnd,true);
  assert.equal(calls.length,3);
  assert.equal(calls.filter(x=>x.method==='POST').length,1,'Continue the original server job');
});

test('loading more waits for new matches, rather than ending on a temporarily empty batch', async () => {
  const {plugin}=load([{id:'job',status:'running',items:[song('a')]},
    {id:'job',status:'running',items:[song('a')]},
    {id:'job',status:'running',items:[song('a'),song('b')]},
    {id:'job',status:'completed',items:[song('a'),song('b')]}]);
  await plugin.search('Song',1,'music');
  assert.equal((await plugin.search('Song',2,'music')).data[0].id,'b');
  const last=await plugin.search('Song',3,'music');
  assert.equal(last.isEnd,true);assert.equal(last.data.length,0);
});

test('cached complete searches paginate all tracks in batches of at most twenty', async () => {
  const items=Array.from({length:45},(_,i)=>song(String(i)));
  const {plugin}=load(Array.from({length:3},()=>({id:'job',status:'completed',items})));
  const pages=[];
  for(let page=1;page<=3;page++)pages.push(await plugin.search('Song',page,'music'));
  assert.equal(pages.map(p=>p.data.length).join(','),'20,20,5');
  assert.equal(pages.map(p=>p.isEnd).join(','),'false,false,true');
  assert.equal(new Set(pages.flatMap(p=>p.data.map(s=>s.id))).size,45);
});

test('different queries keep independent page state and refreshing page one starts over', async () => {
  const {plugin,calls}=load([{id:'a',status:'running',items:[song('a1')]},
    {id:'b',status:'completed',items:[song('b1')]},
    {id:'a',status:'completed',items:[song('a1'),song('a2')]},
    {id:'new-a',status:'completed',items:[song('a2')]}]);
  await plugin.search('A',1,'music');await plugin.search('B',1,'music');
  assert.equal((await plugin.search('A',2,'music')).data[0].id,'a2');
  assert.ok(calls[2].url.endsWith('/searches/a'));
  assert.equal((await plugin.search('A',1,'music')).data[0].id,'a2');
  assert.equal(calls[3].method,'POST');
});

test('concurrent requests for the same next page share one request and a failed page can retry', async () => {
  const {plugin,calls}=load([{id:'job',status:'running',items:[song('a')]},new Error('network'),
    {id:'job',status:'completed',items:[song('a'),song('b')]}]);
  await plugin.search('Song',1,'music');
  await assert.rejects(plugin.search('Song',2,'music'));
  const [a,b]=await Promise.all([plugin.search('Song',2,'music'),plugin.search('Song',2,'music')]);
  assert.equal(a.data[0].id,'b');assert.equal(b.data[0].id,'b');assert.equal(calls.length,3);
});

test('a changed server or token cannot reuse another connection search session', async () => {
  const variables={token:'first'};
  const {plugin,calls}=load([{id:'old',status:'running',items:[song('a')]}],variables);
  await plugin.search('Song',1,'music');variables.token='second';
  await assert.rejects(plugin.search('Song',2,'music'),/重新搜索/);
  assert.equal(calls.length,1);
});

test('desktop retry may increment the failed page number without skipping songs', async () => {
  const {plugin}=load([{id:'job',status:'running',items:[song('a')]},new Error('network'),
    {id:'job',status:'completed',items:[song('a'),song('b')]}]);
  await plugin.search('Song',1,'music');
  await assert.rejects(plugin.search('Song',2,'music'));
  const retry=await plugin.search('Song',3,'music');
  assert.equal(retry.data[0].id,'b');assert.equal(retry.isEnd,true);
});

test('overlapping different page calls serialize consumption of the growing result set', async () => {
  const {plugin}=load([{id:'job',status:'running',items:[song('a')]},
    {id:'job',status:'running',items:[song('a'),song('b')]},
    {id:'job',status:'completed',items:[song('c'),song('a'),song('b')]}]);
  await plugin.search('Song',1,'music');
  const pages=await Promise.all([plugin.search('Song',2,'music'),plugin.search('Song',3,'music')]);
  assert.equal(pages.flatMap(p=>p.data.map(s=>s.id)).join(','),'b,c');
});
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
