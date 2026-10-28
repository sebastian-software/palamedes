declare module "picomatch" {
  type PicomatchOptions = {
    dot?: boolean;
  };

  type Picomatch = {
    (pattern: string, options?: PicomatchOptions): (input: string) => boolean;
    isMatch(input: string, pattern: string, options?: PicomatchOptions): boolean;
  };

  const picomatch: Picomatch;

  export default picomatch;
}
