#!/usr/bin/env node
// Patches node-routeros/dist/Channel.js to handle !empty replies gracefully.
// RouterOS returns !empty when a command produces zero results (e.g. bridge
// with no VLANs configured). The original code throws RosException('UNKNOWNREPLY')
// inside an EventEmitter listener, which bypasses Promise chains and crashes Node.
// This patch makes !empty fall through to !done, resolving the write Promise with [].
//
// Run automatically via npm postinstall, or manually: node scripts/patch-routeros.js

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

const _require = typeof require !== 'undefined' ? require : createRequire(import.meta.url);

let channelPath;
try {
  channelPath = join(dirname(_require.resolve('node-routeros')), 'Channel.js');
} catch (e) {
  console.log('[patch-routeros] node-routeros not found — skipping patch');
  process.exit(0);
}

const src = readFileSync(channelPath, 'utf8');

if (src.includes("case '!empty':")) {
  console.log('[patch-routeros] Channel.js already patched — nothing to do');
  process.exit(0);
}

const patched = src.replace(
  /case '!done':/,
  "case '!empty':\n            case '!done':"
);

if (patched === src) {
  console.warn('[patch-routeros] Could not find patch target in Channel.js — manual check needed');
  process.exit(0);
}

writeFileSync(channelPath, patched, 'utf8');
console.log('[patch-routeros] Channel.js patched — !empty is now handled as !done');
