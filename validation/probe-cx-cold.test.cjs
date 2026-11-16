// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const test=require('node:test'),assert=require('node:assert');
const {classify}=require('../services/adapter-probe-core.cjs');
const inv={archives:[],scripts:0};
test('a cold KiriKiri cx cache is "preparing", not a failure or a timeout',()=>{
 assert.strictEqual(classify({engines:[],inventory:inv,unsupported:null,preparing:'unpack'}).step,'preparing');
 assert.strictEqual(classify({engines:[],inventory:inv,unsupported:null,preparing:'capture'}).step,'decrypt-failed');
});
