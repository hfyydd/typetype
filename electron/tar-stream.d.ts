declare module 'tar-stream' {
  export interface Headers {
    name: string;
    mode?: number;
    size?: number;
    mtime?: Date;
    type?: string;
  }

  export interface Extract {
    on(event: 'entry', callback: (headers: Headers, stream: NodeJS.ReadableStream, next: () => void) => void): this;
    on(event: 'finish' | 'end', callback: () => void): this;
    on(event: 'error', callback: (err: Error) => void): this;
    end(data?: Buffer): void;
  }

  export function extract(): Extract;
}