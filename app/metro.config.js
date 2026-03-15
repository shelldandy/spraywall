const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Exclude .mjs to avoid import.meta errors from packages like zustand v5
config.resolver.sourceExts = config.resolver.sourceExts.filter(
  (ext) => ext !== "mjs",
);

module.exports = config;
