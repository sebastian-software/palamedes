"use strict";

const { transformPalamedesMacros } = require("@palamedes/transform");

module.exports = function palamedesLoader(source, inputSourceMap) {
  const callback = this.async ? this.async() : null;
  const options = typeof this.getOptions === "function" ? this.getOptions() : {};

  try {
    const result = transformPalamedesMacros(String(source), this.resourcePath, {
      runtimeModule: options.runtimeModule,
      sourceMap: this.sourceMap,
    });

    if (callback) {
      callback(null, result.code, result.map ?? inputSourceMap ?? null);
      return;
    }

    return result.code;
  } catch (error) {
    if (callback) {
      callback(error);
      return;
    }

    throw error;
  }
};
