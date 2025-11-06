const pkgVersion =
  (typeof process !== 'undefined' && process.env && process.env.npm_package_version) || 'dev';

const timestamp = new Date();
export const BUILD_VERSION = pkgVersion;
export const BUILD_TIMESTAMP = timestamp.toISOString();
export const BUILD_LABEL = `${pkgVersion}@${BUILD_TIMESTAMP}`;
