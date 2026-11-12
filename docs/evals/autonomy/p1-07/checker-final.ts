import {observationCheckerDigest} from '../../../../core/tools/aidlc-observation-inputs';
console.log(JSON.stringify({checker_digest:observationCheckerDigest(),node:process.version,platform:process.platform,arch:process.arch}));
