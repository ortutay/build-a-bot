import { BaseLogger, fullCoreFeatures, Logger, LogLevel, type ISettingsParam } from 'tslog';

class SourceMappedLogger extends BaseLogger<Record<string, unknown>> {
  constructor(settings: ISettingsParam<Record<string, unknown>>) {
    super(settings, undefined, new Logger().runtime, 5, fullCoreFeatures);
  }

  debug(...args: unknown[]) {
    return super.log(LogLevel.DEBUG, 'DEBUG', ...args);
  }

  error(...args: unknown[]) {
    return super.log(LogLevel.ERROR, 'ERROR', ...args);
  }

  info(...args: unknown[]) {
    return super.log(LogLevel.INFO, 'INFO', ...args);
  }

  warn(...args: unknown[]) {
    return super.log(LogLevel.WARN, 'WARN', ...args);
  }
}

export const log = new SourceMappedLogger({
  name: 'builder',
  type: 'hidden',
  pretty: {
    style: true,
    template: '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}}\t{{logLevelName}}\t{{name}}\t',
  },
  stack: { capture: 'lazy' },
  attachedTransports: [
    {
      format: 'pretty',
      write: (record, line) => {
        const source = record._logMeta.path?.filePathWithLine;
        process.stdout.write(`${line}${source == null ? '' : `\t${source}`}\n`);
      },
    },
  ],
});
