declare module 'bzip2' {
  export function array(bytes: Uint8Array | Buffer): (n: number) => number;
  export function simple(bits: (n: number) => number): Uint8Array;
  export function decompress(bits: (n: number) => number, size?: number, len?: number): Uint8Array | number;
}