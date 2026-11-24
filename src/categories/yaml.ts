import type { BuiltinCategory } from "../builtins/category.js";
import { yamlBuiltins } from "../builtins/yaml.js";

/** The `yaml` built-ins: yaml(); the only category that bundles the yaml package. */
export const yaml: BuiltinCategory = {
  name: "yaml",
  filters: {
    ...yamlBuiltins,
  },
};
