declare module 'webm-muxer-local' {
  export class ArrayBufferTarget {
    buffer: ArrayBuffer;
  }

  export class Muxer {
    constructor(options: {
      target: ArrayBufferTarget;
      video?: { codec: string; width: number; height: number; frameRate?: number };
      type?: 'webm' | 'matroska';
    });
    addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
    finalize(): void;
    target: ArrayBufferTarget;
  }
}
