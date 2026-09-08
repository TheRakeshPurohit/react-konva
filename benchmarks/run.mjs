import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? listFiles(resolve(directory, entry.name), name)
      : [name];
  });
}

const baseline = process.argv[2] || 'HEAD';
mkdirSync('.bench-tools', { recursive: true });
const directory = mkdtempSync(resolve('.bench-tools/events-'));
const fromDirectory = existsSync(resolve(baseline, 'src'));
const report = {
  measuredAt: new Date().toISOString(),
  baseline,
  commit: fromDirectory
    ? null
    : execFileSync('git', ['rev-parse', baseline], { encoding: 'utf8' }).trim(),
  node: process.version,
  cpu: cpus()[0].model,
  os: `${platform()} ${release()}`,
  runs: [],
};
try {
  if (fromDirectory)
    cpSync(resolve(baseline, 'src'), resolve(directory, 'baseline/src'), {
      recursive: true,
    });
  else {
    const files = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', baseline, 'src'],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n');
    for (const file of files) {
      const target = resolve(directory, 'baseline', file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        execFileSync('git', ['show', `${baseline}:${file}`]),
      );
    }
  }
  cpSync('src', resolve(directory, 'current/src'), { recursive: true });
  report.sourceHashes = {};
  report.konvaBuilds = {};
  const konvaDirectories = {
    baseline: resolve('node_modules/konva'),
    current: resolve('node_modules/konva'),
  };
  for (const variant of ['baseline', 'current']) {
    const hash = createHash('sha256');
    const sourceDirectory = resolve(directory, variant, 'src');
    for (const file of listFiles(sourceDirectory).sort()) {
      hash.update(file).update(readFileSync(resolve(sourceDirectory, file)));
    }
    report.sourceHashes[variant] = hash.digest('hex');
    const konvaHash = createHash('sha256');
    for (const file of listFiles(
      resolve(konvaDirectories[variant], 'lib'),
    ).sort()) {
      konvaHash
        .update(file)
        .update(readFileSync(resolve(konvaDirectories[variant], 'lib', file)));
    }
    report.konvaBuilds[variant] = {
      version: JSON.parse(
        readFileSync(
          resolve(konvaDirectories[variant], 'package.json'),
          'utf8',
        ),
      ).version,
      libHash: konvaHash.digest('hex'),
    };
  }
  for (let round = 0; round < 3; round++) {
    for (const variant of round % 2
      ? ['current', 'baseline']
      : ['baseline', 'current']) {
      console.log(`Round ${round + 1}: ${variant}`);
      execFileSync(
        process.execPath,
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          '--config',
          'benchmarks/vitest.config.mts',
        ],
        {
          env: {
            ...process.env,
            NODE_ENV: 'production',
            BENCH_SOURCE: resolve(directory, variant, 'src'),
            BENCH_OUTPUT: resolve(directory, 'run.json'),
          },
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      report.runs.push({
        round,
        variant,
        ...JSON.parse(readFileSync(resolve(directory, 'run.json'), 'utf8')),
      });
    }
  }
  writeFileSync(
    process.env.BENCH_OUTPUT || '.bench-tools/events-results.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  for (const scenario of report.runs[0].results) {
    const row = { scenario: scenario.name };
    for (const variant of ['baseline', 'current']) {
      const samples = report.runs
        .filter((r) => r.variant === variant)
        .flatMap(
          (r) => r.results.find((s) => s.name === scenario.name).samples,
        );
      for (const key of [
        'dispatchMs',
        'settledMs',
        'ownerEffects',
        'transformerUpdates',
        'inlineSteps',
        'settledStaleReads',
      ]) {
        const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
        row[`${variant} ${key}`] = Number(
          sorted[Math.floor(sorted.length / 2)].toFixed(3),
        );
      }
    }
    console.log(row);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
