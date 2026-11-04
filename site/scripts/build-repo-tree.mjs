// Regenerates src/data/repoTree.json: the real sqlglot tree the WINDOW bug started from (the parent of its
// fix commit), as [path, bytes]. Needs the GitHub CLI. The site only reads the committed result.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BASE = '7e7cf8b06397ed440921d079a39112e073bcfa80';
const out = execFileSync('gh', ['api', `repos/tobymao/sqlglot/git/trees/${BASE}?recursive=1`, '--jq', '[.tree[]|select(.type=="blob")|[.path,.size]]'], { encoding: 'utf8', maxBuffer: 1 << 26 });
const files = JSON.parse(out).filter(([p]) => !/\.(png|gif|jpe?g|svg|ico)$/i.test(p));
writeFileSync('src/data/repoTree.json', `${JSON.stringify({ commit: BASE, files })}\n`);
console.log(files.length, 'files');
