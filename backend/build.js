import { build } from 'esbuild';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const outdir = join(process.cwd(), 'dist', 'lambdas');

if (!existsSync(outdir)) {
  mkdirSync(outdir, { recursive: true });
}

// Write package.json with type: module to dist/lambdas so Lambda runs them as ES Modules
writeFileSync(
  join(outdir, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2)
);

// Copy provinces.json to dist/lambdas/data/provinces.json
const datadir = join(outdir, 'data');
if (!existsSync(datadir)) {
  mkdirSync(datadir, { recursive: true });
}
copyFileSync(join(process.cwd(), 'data', 'provinces.json'), join(datadir, 'provinces.json'));

const entryPoints = [
  {
    in: 'src/lambdas/firmsIngestion.handler.ts',
    out: 'firmsIngestion'
  },
  {
    in: 'src/lambdas/api.ts',
    out: 'api'
  },
  {
    in: 'src/lambdas/riskCalculation.handler.ts',
    out: 'riskCalculation'
  },
  {
    in: 'src/lambdas/notificationDispatcher.handler.ts',
    out: 'notificationDispatcher'
  }
];

async function runBuild() {
  console.log('Building backend lambdas in ES Module format...');
  for (const entry of entryPoints) {
    try {
      console.log(`Bundling ${entry.in} -> ${entry.out}.js`);
      await build({
        entryPoints: [entry.in],
        bundle: true,
        platform: 'node',
        target: 'node20',
        external: ['@aws-sdk/*'],
        outfile: join(outdir, `${entry.out}.js`),
        format: 'esm',
        banner: {
          js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
        }
      });
    } catch (err) {
      console.error(`Error bundling ${entry.in}:`, err);
      process.exit(1);
    }
  }
  console.log('Backend lambdas build completed successfully!');
}

runBuild();
