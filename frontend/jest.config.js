module.exports = {
  testEnvironment: "jsdom",
  roots: ["<rootDir>/src"],
  setupFilesAfterEnv: ["<rootDir>/src/test/setup.ts"],
  moduleNameMapper: {
    "\\.(css|scss)$": "identity-obj-proxy",
    "\\.(svg)$": "<rootDir>/src/test/fileMock.js",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
    "node_modules/.+\\.jsx?$": ["ts-jest", {
      tsconfig: { allowJs: true },
      diagnostics: false,
    }],
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(@openedx/paragon|@openedx/paragon/icons|dompurify|marked)/)",
  ],
};
