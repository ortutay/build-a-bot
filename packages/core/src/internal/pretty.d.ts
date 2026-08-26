declare module 'pretty' {
  interface PrettyOptions {
    indent_size?: number;
    ocd?: boolean;
  }

  export default function pretty(html: string, options?: PrettyOptions): string;
}
