import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const databaseName = process.argv[2] ?? 'foreign_radar_analytics';
const sqlFile = process.argv[3] ?? 'work/jobs/sap-china-import.sql';
const isRemote = process.argv.includes('--remote');
const batchSizeArg = process.argv.find((arg) => arg.startsWith('--batch-size='));
const batchSize = Math.max(Number(batchSizeArg?.split('=')[1] ?? 40), 1);
const sql = fs.readFileSync(sqlFile, 'utf8');
const statements = sql
  .split(/;\s*(?:\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean)
  .filter((statement) => !['BEGIN TRANSACTION', 'COMMIT'].includes(statement));

console.log(`Importing ${statements.length} statements into ${databaseName}${isRemote ? ' remote' : ' local'} from ${sqlFile} with batch size ${batchSize}`);

for (let index = 0; index < statements.length; index += batchSize) {
  const batch = statements.slice(index, index + batchSize);
  const command = batch.map((statement) => `${statement};`).join('\n');
  const args = ['d1', 'execute', databaseName, '--command', command];
  if (isRemote) args.splice(3, 0, '--remote');
  const result = spawnSync('./node_modules/.bin/wrangler', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 });
  if (result.status !== 0) {
    console.error(`Failed batch starting at statement ${index + 1}/${statements.length}`);
    console.error(command.slice(0, 2000));
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  console.log(`Imported ${Math.min(index + batch.length, statements.length)}/${statements.length}`);
}
