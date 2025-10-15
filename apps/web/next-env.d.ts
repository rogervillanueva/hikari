/// <reference types="next" />
/// <reference types="next/types/global" />
/// <reference types="next/image-types/global" />

declare module '*.svg' {
  const content: string;
  export default content;
}

// NOTE: This file should not be edited
