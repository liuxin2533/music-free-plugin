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
