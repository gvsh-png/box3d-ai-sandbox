declare module 'mp4-muxer-local' {
  export class ArrayBufferTarget {
    buffer: ArrayBuffer;
  }

  export class Muxer {
    constructor(options: {
      target: ArrayBufferTarget;
      video?: { codec: string; width: number; height: number; frameRate?: number };
      fastStart?: string;
    });
    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
    finalize(): void;
    target: ArrayBufferTarget;
  }
}
