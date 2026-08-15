import { Logger } from 'tslog';

export const log = new Logger({
  name: 'builder',
  type: 'hidden',
  pretty: {
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
