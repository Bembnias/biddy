import { createConfig } from '@biddy/config/eslint';

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname, node: true }),
  {
    languageOptions: {
      parserOptions: {
        // Importy klas używanych w konstruktorach (DI NestJS) muszą zostać importami wartości,
        // inaczej SWC usunie je i zabraknie metadanych `design:paramtypes`.
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
  },
];
