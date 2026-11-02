// Publiczne API design tokens: wartości (web, mobile, testy kontrastu) i generator motywu
// Tailwind CSS 4. Aplikacja web importuje gotowy motyw: `@import "@biddy/design-tokens/theme.css"`.
export {
  contrastRatio,
  isInSrgbGamut,
  oklchToLinearRgb,
  parseOklch,
  relativeLuminance,
  toHex,
  type LinearRgb,
  type Oklch,
} from './color.js';
export { fontFaceVariable, themeCss } from './theme-css.js';
export {
  TEXT_CONTRAST_PAIRS,
  UI_CONTRAST_PAIRS,
  containers,
  palette,
  radius,
  semanticColors,
  shadows,
  typography,
  type ColorScale,
  type PaletteStep,
  type SemanticColor,
  type TextStyle,
} from './tokens.js';
