'use strict';
/* a disabled Alt+T menu button must look disabled: its rule carries the same :not chain as the base button rule (else the base rule wins) */
const assert=require('assert'),fs=require('fs'),path=require('path');
const s=fs.readFileSync(path.join(__dirname,'..','web','reader','modules','controls-b.js'),'utf8');
const chain=':not(.tomoyo-menu-tabs button):not(.tome-color-swatch):not(.tome-menu-close):not(.megulit-ruby-row-chip):not([type=submit]):not(.tome-reset-row>button)';
assert(s.includes('.tomoyo-cn-dialog button'+chain+':disabled'),'disabled rule needs the base rule\'s :not chain');
assert(/:disabled\{border-style:dashed!important[^}]*opacity:\.55!important/.test(s));
console.log('menu-disabled-button ok');
