export type CliArgs = {
  flags: Set<string>;
  values: Map<string, string>;
};

export function parseArgs(argv: string[]): CliArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const trimmed = arg.slice(2);
    const equalIndex = trimmed.indexOf("=");

    if (equalIndex >= 0) {
      const key = trimmed.slice(0, equalIndex);
      const value = trimmed.slice(equalIndex + 1);
      values.set(key, value);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(trimmed, next);
      index += 1;
    } else {
      flags.add(trimmed);
    }
  }

  return { flags, values };
}

export function getArg(args: CliArgs, key: string) {
  return args.values.get(key)?.trim() ?? "";
}

export function requireArg(args: CliArgs, key: string) {
  const value = getArg(args, key);

  if (!value) {
    throw new Error(`缺少必需参数 --${key}`);
  }

  return value;
}

export function getListArg(args: CliArgs, key: string) {
  const value = getArg(args, key);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function shouldShowHelp(args: CliArgs) {
  return args.flags.has("help") || args.flags.has("h");
}
