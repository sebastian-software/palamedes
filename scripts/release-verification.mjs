export const NATIVE_TARBALL_MIN_UNPACKED_SIZE = 1_000_000

export function nativeTarballFailure(packageInfo, unpackedSize) {
  if (!packageInfo.nativeArtifact) {
    return null
  }

  const size = Number(unpackedSize)
  if (Number.isFinite(size) && size >= NATIVE_TARBALL_MIN_UNPACKED_SIZE) {
    return null
  }

  return `${packageInfo.name}@${packageInfo.version} has native artifact ${packageInfo.nativeArtifact}, but its npm tarball is only ${String(unpackedSize)} bytes unpacked (expected at least ${NATIVE_TARBALL_MIN_UNPACKED_SIZE}).`
}
