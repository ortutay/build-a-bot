#!/usr/bin/env node

import { spawn, type ChildProcess } from 'node:child_process';
import { watch } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer, type StudioServer } from '@build-a-bot/studio/server';
import { Command, InvalidArgumentError } from 'commander';

const configFileName = 'build-a-bot-project.json';
const defaultEntries = ['src/build-a-bot/index.ts', 'src/build-a-bot/index.js'];

type ProjectConfig = {
  entry?: string;
};

type DevOptions = {
  apiPort?: number;
  studioPort?: number;
};

type ApiWorker = {
  child: ChildProcess;
  port: number;
};

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readProjectConfig = async (projectRoot: string): Promise<ProjectConfig> => {
  const configPath = path.join(projectRoot, configFileName);

  if (!(await exists(configPath))) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${configFileName}: ${(e as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${configFileName} must contain a JSON object.`);
  }

  const entry = (parsed as ProjectConfig).entry;

  if (entry !== undefined && (typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error(`${configFileName}.entry must be a non-empty string.`);
  }

  return { entry };
};

const resolveEntry = async (projectRoot: string): Promise<string> => {
  const config = await readProjectConfig(projectRoot);

  if (config.entry) {
    const entryPath = path.resolve(projectRoot, config.entry);

    if (!(await exists(entryPath))) {
      throw new Error(`Configured entry does not exist: ${config.entry}`);
    }

    return entryPath;
  }

  for (const entry of defaultEntries) {
    const entryPath = path.join(projectRoot, entry);

    if (await exists(entryPath)) {
      return entryPath;
    }
  }

  throw new Error(
    `No entry found. Add \"entry\" to ./${configFileName}, or create ${defaultEntries.join(' or ')}.`
  );
};

const writeIfMissing = async (filePath: string, contents: string): Promise<boolean> => {
  try {
    await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }

    throw e;
  }
};

const initializeProject = async (projectRoot: string): Promise<void> => {
  const entryDirectory = path.join(projectRoot, 'src/build-a-bot');
  await mkdir(entryDirectory, { recursive: true });

  const created = await Promise.all([
    writeIfMissing(
      path.join(projectRoot, configFileName),
      `${JSON.stringify({ entry: defaultEntries[0] }, null, 2)}\n`
    ),
    writeIfMissing(
      path.join(entryDirectory, 'index.ts'),
      "import { BuildABot } from '@build-a-bot/core';\n\nexport const buildABot = new BuildABot();\n"
    ),
    writeIfMissing(
      path.join(projectRoot, '.env.example'),
      'OPENAI_API_KEY=\nOPENROUTER_API_KEY=\n'
    ),
  ]);

  const createdFiles = [configFileName, 'src/build-a-bot/index.ts', '.env.example'].filter(
    (_file, index) => created[index]
  );

  if (createdFiles.length === 0) {
    console.log('Build-A-Bot project files already exist; nothing was overwritten.');
  } else {
    console.log(`Created ${createdFiles.join(', ')}.`);
  }

  console.log('Install @build-a-bot/core and build-a-bot, then run: npx build-a-bot dev');
};

const getTsxLoaderPath = (): string => fileURLToPath(import.meta.resolve('tsx'));

const exitDescription = (code: number | null | undefined): string =>
  code === null || code === undefined ? '' : ` (code ${code})`;

const startApiWorker = async (
  entryPath: string,
  projectRoot: string,
  port?: number
): Promise<ApiWorker> => {
  const cliDirectory = path.dirname(fileURLToPath(import.meta.url));
  const workerPath = path.join(cliDirectory, 'worker.js');
  const child = spawn(
    process.execPath,
    ['--import', getTsxLoaderPath(), workerPath, entryPath, port === undefined ? '' : String(port)],
    {
      cwd: projectRoot,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    }
  );

  return new Promise<ApiWorker>((resolve, reject) => {
    const cleanup = () => {
      child.off('error', onError);
      child.off('message', onMessage);
      child.off('exit', onExit);
    };
    const onError = (e: Error) => {
      cleanup();
      reject(e);
    };
    const onMessage = (message: unknown) => {
      const value = message as { type?: string; port?: unknown };

      if (value?.type !== 'ready' || !Number.isInteger(value.port)) {
        return;
      }

      cleanup();
      resolve({ child, port: value.port as number });
    };
    const onExit = (code?: number | null) => {
      cleanup();
      reject(new Error(`Build-A-Bot API exited before startup${exitDescription(code)}.`));
    };

    child.once('error', onError);
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
};

const stopChild = async (child: ChildProcess | undefined): Promise<void> => {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
};

const runDevServer = async (projectRoot: string, options: DevOptions): Promise<void> => {
  let entryPath = await resolveEntry(projectRoot);
  let apiWorker = await startApiWorker(entryPath, projectRoot, options.apiPort);
  let studio: StudioServer | undefined;
  let isShuttingDown = false;
  let isRestarting = false;
  let restartTimer: NodeJS.Timeout | undefined;
  let watcher: ReturnType<typeof watch> | undefined;

  const stop = async (exitCode = 0): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    watcher?.close();
    await Promise.all([stopChild(apiWorker.child), studio?.close()]);
    process.exitCode = exitCode;
  };

  const handleApiExit = (code?: number | null) => {
    if (!isShuttingDown && !isRestarting) {
      console.error(`Build-A-Bot API stopped unexpectedly${exitDescription(code)}.`);
      void stop(1);
    }
  };

  apiWorker.child.once('exit', handleApiExit);

  try {
    studio = await startStudioServer({
      apiUrl: `http://localhost:${apiWorker.port}`,
      port: options.studioPort,
    });
  } catch (e) {
    isShuttingDown = true;
    await stopChild(apiWorker.child);
    throw e;
  }
  console.log(`Build-A-Bot Studio: http://localhost:${studio.port}`);

  const restartApi = async (): Promise<void> => {
    if (isShuttingDown || isRestarting) {
      return;
    }

    isRestarting = true;
    console.log('Build-A-Bot source changed; restarting API.');
    await stopChild(apiWorker.child);

    try {
      entryPath = await resolveEntry(projectRoot);
      apiWorker = await startApiWorker(entryPath, projectRoot, apiWorker.port);
      apiWorker.child.once('exit', handleApiExit);
    } catch (e) {
      console.error((e as Error).message);
    } finally {
      isRestarting = false;
    }
  };

  watcher = watch(projectRoot, { recursive: true }, (_event, fileName) => {
    const changedPath = fileName?.toString();

    if (
      !changedPath ||
      changedPath.startsWith('node_modules/') ||
      changedPath.startsWith('.git/')
    ) {
      return;
    }

    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => void restartApi(), 100);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void stop());
  }
};

const parsePort = (value: string): number => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError('must be an integer between 1 and 65535.');
  }

  return port;
};

const program = new Command();

program.name('build-a-bot').description('Build-A-Bot development tools.');

program
  .command('init')
  .description('Create the Build-A-Bot client project files in the current directory.')
  .action(() => initializeProject(process.cwd()));

program
  .command('dev')
  .description('Start the Build-A-Bot API and Studio.')
  .option('--api-port <port>', 'Require the API to use this port.', parsePort)
  .option('--studio-port <port>', 'Require Studio to use this port.', parsePort)
  .action((options: DevOptions) => runDevServer(process.cwd(), options));

try {
  await program.parseAsync();
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
