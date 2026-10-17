// snapcn UI Core · snapcn — https://snapcn.dev/docs/components
export interface Step<S extends string = string> {
  at: number;
  state: S;
  duration?: number;
}
