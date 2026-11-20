/** Uses the generated design-token preset from M1.4 (design/tailwind-preset.cjs). */
module.exports = {
  presets: [require("../../design/tailwind-preset.cjs")],
  content: ["./src/**/*.{ts,tsx}"],
};
