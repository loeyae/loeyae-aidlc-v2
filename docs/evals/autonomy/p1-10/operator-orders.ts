/** Historical launcher retired. Original attempts are immutable evidence, not runnable entries. */
import {requireIntegrationGo} from './integration-review-gate.mjs';
import {fileURLToPath} from 'node:url';import {resolve,dirname} from 'node:path';
requireIntegrationGo(resolve(dirname(fileURLToPath(import.meta.url)),'../../../..'));
throw Error('LEGACY_ENTRY_RETIRED: use operator-pilots.ts');
