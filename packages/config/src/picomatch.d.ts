declare module "picomatch" {
  type PicomatchOptions = {
    dot?: boolean
  }

  const picomatch: {
    isMatch(input: string, pattern: string, options?: PicomatchOptions): boolean
  }

  export default picomatch
}
