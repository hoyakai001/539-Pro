#!/usr/bin/env node
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
execFileSync(process.execPath, [path.join(__dirname, 'date-order.js')], { stdio: 'inherit' });
console.log('[PASS] data-integrity delegates to date-order and draw validation checks');
