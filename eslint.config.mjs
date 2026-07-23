import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { disableRule, getEslintConfig, optionsToFilename } from "eslint-config-setup"

const generatedAndBuildIgnores = {
  ignores: [
    "**/dist/**",
    "**/node_modules/**",
    "**/.next/**",
    "**/.claude/**",
    "**/.nitro/**",
    "**/.output/**",
    "**/.tanstack/**",
    "**/.vercel/**",
    "**/.vinxi/**",
    "**/coverage/**",
    "**/target/**",
    "**/.react-router/**",
    "site/build/**",
    "**/*.d.ts",
    "**/*.tsbuildinfo",
    "docs/example-screenshots/**",
  ],
}

const legacyBaselineRules = {
  "@cspell/spellchecker": "off",
  "@typescript-eslint/array-type": "off",
  "@typescript-eslint/consistent-type-definitions": "off",
  "@typescript-eslint/explicit-function-return-type": "off",
  "@typescript-eslint/no-confusing-void-expression": "off",
  "@typescript-eslint/no-dynamic-delete": "off",
  "@typescript-eslint/no-empty-object-type": "off",
  "@typescript-eslint/no-explicit-any": "off",
  "@typescript-eslint/no-invalid-void-type": "off",
  "@typescript-eslint/no-non-null-assertion": "off",
  "@typescript-eslint/no-redundant-type-constituents": "off",
  "@typescript-eslint/no-unnecessary-type-assertion": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-unsafe-type-assertion": "off",
  "@typescript-eslint/prefer-nullish-coalescing": "off",
  "@typescript-eslint/strict-boolean-expressions": "off",
  complexity: "off",
  "import/first": "off",
  "import/no-duplicates": "off",
  "import/no-extraneous-dependencies": "off",
  "import/no-unassigned-import": "off",
  "jsdoc/check-tag-names": "off",
  "jsdoc/require-param": "off",
  "jsdoc/require-param-description": "off",
  "jsdoc/require-returns": "off",
  "jsdoc/require-returns-description": "off",
  "logical-assignment-operators": "off",
  "max-depth": "off",
  "max-lines": "off",
  "max-lines-per-function": "off",
  "max-nested-callbacks": "off",
  "max-params": "off",
  "max-statements": "off",
  "no-await-in-loop": "off",
  "no-empty": "off",
  "no-empty-function": "off",
  "no-magic-numbers": "off",
  "no-negated-condition": "off",
  "no-nested-ternary": "off",
  "no-param-reassign": "off",
  "no-promise-executor-return": "off",
  "no-template-curly-in-string": "off",
  "no-unused-vars": "off",
  "no-useless-assignment": "off",
  "no-useless-return": "off",
  "perfectionist/sort-imports": "off",
  "perfectionist/sort-named-imports": "off",
  "perfectionist/sort-object-types": "off",
  "perfectionist/sort-objects": "off",
  "perfectionist/sort-union-types": "off",
  "prefer-named-capture-group": "off",
  "react/button-has-type": "off",
  "react/jsx-no-useless-fragment": "off",
  "react/no-clone-element": "off",
  "react/only-export-components": "off",
  "react/purity": "off",
  "regexp/require-unicode-sets-regexp": "off",
  "require-atomic-updates": "off",
  "require-unicode-regexp": "off",
  "unicorn/consistent-function-scoping": "off",
  "unicorn/explicit-length-check": "off",
  "unicorn/no-abusive-eslint-disable": "off",
  "unicorn/no-array-callback-reference": "off",
  "unicorn/no-array-for-each": "off",
  "unicorn/no-array-reduce": "off",
  "unicorn/no-await-expression-member": "off",
  "unicorn/no-for-loop": "off",
  "unicorn/prefer-array-find": "off",
  "unicorn/prefer-at": "off",
  "unicorn/prefer-global-this": "off",
  "unicorn/prefer-import-meta-properties": "off",
  "unicorn/prefer-native-coercion-functions": "off",
  "unicorn/prefer-string-replace-all": "off",
  "unicorn/prefer-ternary": "off",
  "unicorn/prefer-top-level-await": "off",
  "unicorn/prevent-abbreviations": "off",
  "unicorn/switch-case-braces": "off",
  "vitest/no-conditional-expect": "off",
  "vitest/no-conditional-in-test": "off",
  "vitest/prefer-strict-equal": "off",
  "vitest/require-top-level-describe": "off",
}

const eslintConfigOptions = {
  react: true,
  node: true,
  ai: true,
  oxlint: true,
}

async function getPortableEslintConfig(options) {
  try {
    return await getEslintConfig(options)
  } catch (error) {
    const packageEntry = fileURLToPath(import.meta.resolve("eslint-config-setup"))
    const configPath = path.join(path.dirname(packageEntry), "configs", optionsToFilename(options))

    try {
      return (await import(pathToFileURL(configPath).href)).default
    } catch {
      throw error
    }
  }
}

const config = await getPortableEslintConfig(eslintConfigOptions)

for (const ruleName of Object.keys(legacyBaselineRules)) {
  disableRule(config, ruleName)
}

for (const block of config) {
  if (!block.rules) {
    continue
  }

  for (const ruleName of Object.keys(block.rules)) {
    if (
      ruleName.startsWith("@typescript-eslint/") ||
      ruleName.startsWith("@cspell/") ||
      ruleName.startsWith("jsdoc/") ||
      ruleName.startsWith("node/") ||
      ruleName.startsWith("perfectionist/") ||
      ruleName.startsWith("regexp/") ||
      ruleName.startsWith("react-hooks/") ||
      ruleName.startsWith("react-refresh/") ||
      ruleName.startsWith("react-you-might-not-need-an-effect/") ||
      ruleName.startsWith("react/") ||
      ruleName.startsWith("security/") ||
      ruleName.startsWith("sonarjs/") ||
      ruleName.startsWith("testing-library/") ||
      ruleName.startsWith("unused-imports/")
    ) {
      block.rules[ruleName] = "off"
    }
  }
}

export default [
  generatedAndBuildIgnores,
  ...config,
  {
    rules: {
      "unicorn/no-for-each": "off",
      "unicorn/prefer-switch": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: false,
        projectService: false,
      },
    },
    rules: legacyBaselineRules,
  },
  {
    files: [
      "examples/solidstart-*/**/*.ts",
      "examples/solidstart-*/**/*.tsx",
      "packages/solid/**/*.ts",
      "packages/solid/**/*.tsx",
    ],
    rules: {
      "react/no-unknown-property": "off",
    },
  },
]
