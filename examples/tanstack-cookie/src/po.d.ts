declare module "*.po" {
  export const messages: Record<string, string>

  const catalog: {
    messages: Record<string, string>
  }

  export default catalog
}
